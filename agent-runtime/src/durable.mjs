import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Harness, createRegistry, defineDoc, defineExtension, defineTool, hook, section,
  GenerationTask, ToolTask, LiveDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createRuntime } from './runtime.mjs';

const context = BACKGROUND_CONTEXT;
const RuntimeDoc = defineDoc({ kind: 'tessmora.runtime', version: 1, scope: 'conversation',
  history: 'latest', fork: 'initial', initial: () => ({ policy: {}, rounds: [], inputs: {}, applied: [], cancelled: false }),
  checkpointWhen: () => true });

// Pi Durable owns model/tool intent and transcript commits. This adapter keeps
// Tessmora's existing evidence, context projection and stopping policy in one
// place, rather than implementing a second retrieval agent.
class DurableAgent {
  constructor(options, policy, config, emit) {
    this.options = options;
    this.policy = policy;
    this.config = config;
    this.emit = emit;
    this.listeners = [];
    this.appliedEmitted = new Set();
    this.state = { messages: [] };
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    policy.persist = () => this.persist();
  }

  subscribe(listener) { this.listeners.push(listener); }
  async publish(event) { for (const listener of this.listeners) await listener(event); }

  async persist(extra = {}) {
    if (!this.root || this.closing) return;
    await this.root.commit(async tx => {
      const doc = await tx.doc(RuntimeDoc, this.root.id);
      doc.policy = this.policy.snapshot();
      Object.assign(doc, extra);
    }, context);
  }

  stream(model, request, streamOptions) {
    const output = createAssistantMessageEventStream();
    (async () => {
      try {
        const messages = await this.options.transformContext([...request.messages]);
        this.state.messages = [...messages];
        const upstream = await this.options.streamFn(model, { ...request, messages }, streamOptions);
        for await (const event of upstream) {
          if (event.type === 'done' || event.type === 'error') {
            const message = event.type === 'done' ? event.message : event.error;
            this.state.messages.push(message);
            await this.publish({ type: 'message_end', message });
          } else await this.publish({ type: 'message_update', assistantMessageEvent: event });
          output.push(event);
        }
      } catch (error) {
        const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          timestamp: Date.now(), stopReason: streamOptions?.signal?.aborted ? 'aborted' : 'error', errorMessage: String(error.message),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        this.state.messages.push(message);
        output.push({ type: 'error', reason: message.stopReason, error: message });
      }
    })();
    return output;
  }

  async finishRound(key, message, toolResults) {
    const saved = await this.harness.snapshot(RuntimeDoc, this.root.id, context);
    if (saved.rounds.includes(key)) return saved.continuations?.[key];
    const before = this.state.messages.length;
    const decision = await this.options.finishTurn({ message, toolResults });
    const continuation = decision?.action === 'continue' ? this.state.messages.slice(before).findLast(item => item.role === 'user')?.content : undefined;
    await this.root.commit(async tx => {
      const doc = await tx.doc(RuntimeDoc, this.root.id);
      doc.policy = this.policy.snapshot();
      if (!doc.rounds.includes(key)) doc.rounds.push(key);
      if (continuation) { doc.continuations ??= {}; doc.continuations[key] = continuation; }
    }, context);
    return continuation;
  }

  async beforeRequest(api) {
    const live = await this.harness.snapshot(LiveDoc, this.root.id, context);
    const doc = await this.harness.snapshot(RuntimeDoc, this.root.id, context);
    const applied = (live?.run?.inputs || []).filter(id => doc.inputs[id] && !this.appliedEmitted.has(id));
    const following = applied.map(id => doc.inputs[id]).find(input => input.mode === 'follow_up');
    if (following && this.policy.snapshot().finalResult) this.policy.restore(this.policy.snapshot(), { freshSubmission: true });
    if (applied.length) {
      await this.persist({ applied: [...new Set([...doc.applied, ...applied])] });
      for (const id of applied) {
        await this.emit('input.applied', { ...doc.inputs[id], new_submission: !!following });
        this.appliedEmitted.add(id);
      }
    }
  }

  async open() {
    await mkdir(dirname(this.config.storage_path), { recursive: true, mode: 0o700 });
    const registry = createRegistry();
    const tools = this.options.initialState.tools.map(tool => defineTool({
      name: tool.name, description: tool.description, parameters: tool.parameters,
      prepareArguments: tool.prepareArguments, executionMode: tool.executionMode,
      // Host call IDs are durable operation keys. The host returns a previously
      // committed result, or classifies an indeterminate external effect.
      replay: 'safe', callers: ['model'],
      outputLimits: { maxBytes: Number.MAX_SAFE_INTEGER, maxLines: Number.MAX_SAFE_INTEGER },
      execute: async (args, api, callContext) => {
        const result = await tool.execute(api.callId, args, callContext.abortSignal);
        return { output: result.content, details: result.details || {}, isError: !!result.isError,
          ...(result.terminate ? { control: { terminate: true } } : {}) };
      },
    }));
    registry.install(defineExtension({ name: 'tessmora', tools,
      sections: [section('tessmora', () => this.options.initialState.systemPrompt, { tag: false })],
      hooks: [hook(GenerationTask, {
        beforeRequest: async (_request, api) => this.beforeRequest(api),
        afterResponse: async (message, api) => {
          if (['length', 'error', 'aborted'].includes(message.stopReason)) await this.finishRound(`response:${api.taskId}`, message, []);
        },
        onYield: async (message, api) => {
          const continuation = await this.finishRound(`yield:${api.taskId}`, message, []);
          return continuation ? { continue: continuation } : undefined;
        },
        afterTools: async (assistant, results, api, callContext) => {
          const message = (await api.entry(assistant, callContext))?.model?.[0];
          const toolResults = (await Promise.all(results.map(id => api.entry(id, callContext)))).flatMap(entry => entry?.model || []);
          if (message) await this.finishRound(`tools:${assistant}`, message, toolResults);
        },
      }), hook(ToolTask, {
        beforeTool: async () => {
          const result = await this.options.beforeToolCall();
          return result?.block ? { block: result.reason } : undefined;
        },
        afterTool: async (call, result) => {
          if (result.isError) await this.publish({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name,
            isError: true, result: { ...result, content: result.output || [] } });
          return this.policy.snapshot().finalResult ? { ...result, control: { ...result.control, terminate: true } } : result;
        },
      })],
    }));
    const model = this.options.initialState.model;
    const models = Object.assign(createModels(), { getModel: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
      streamSimple: (requested, request, options) => this.stream(requested, request, options) });
    this.harness = await Harness.open(await openNodeSqliteStorage(this.config.storage_path), { models, registry,
      identity: { attribution: { name: 'Tessmora' } },
      settings: { compaction: { enabled: false }, retry: { enabled: true, maxRetries: 2, baseDelayMs: 250, maxAgentDelayMs: 5000 },
        stream: { maxRetries: 0 }, toolExecution: 'parallel', steeringMode: 'all', followUpMode: 'one-at-a-time' },
      onReport: report => { if (!this.closing) void this.emit('runtime.diagnostic', { code: report.kind || 'durable_report',
        message: String(report.error?.message || 'Durable reported a task error').slice(0, 1000) }); },
    }, context);
    this.root = await this.harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id },
      thinkingLevel: this.options.initialState.thinkingLevel }, init: async (tx, id) => { await tx.doc(RuntimeDoc, id); } });
    const stored = await this.harness.snapshot(RuntimeDoc, this.root.id, context);
    this.policy.restore(stored.policy);
    this.cancelled = stored.cancelled;
    if (stored.submissionKey && !stored.policy.finalResult)
      await this.emit('answer.reset', { reason: 'runtime_resumed' });
    // A client may have disconnected after the durable applied marker but
    // before receiving its event. Re-emit receipts on reopen; the host dedupes
    // them by request_id, without admitting the user's message again.
    for (const id of stored.applied) if (stored.inputs[id]) {
      await this.emit('input.applied', { ...stored.inputs[id], new_submission: false });
      this.appliedEmitted.add(id);
    }
    const key = this.config.submission_id || this.config.run_id;
    if (!stored.cancelled && stored.submissionKey && stored.submissionKey !== key) {
      // Finish a previously accepted terminal tool before starting a reply. Its
      // host operation key reuses the result if its transcript commit was lost.
      if (stored.policy.finalResult) { this.harness.resume(); await this.root.waitForIdle(context); }
      this.policy.restore(this.policy.snapshot(), { freshSubmission: true });
    }
    await this.persist({ submissionKey: key });
  }

  async prompt(prompt) {
    try {
      await this.open();
      if (this.closing || this.policy.snapshot().finalResult) { this.resolveReady(); return; }
      const submission = await this.admit({ message: prompt, request_id: this.config.submission_id || this.config.run_id,
        mode: this.config.input_mode || 'initial' });
      // The host can resend queued inputs immediately after start. Release
      // them only after initial admission made this conversation busy.
      this.resolveReady();
      this.harness.resume();
      await submission.wait(context);
      await this.root.waitForIdle(context);
    } catch (error) {
      this.rejectReady(error);
      if (!this.closing) throw error;
    } finally {
      if (this.harness) { this.closing = true; await this.harness.close(context); }
    }
  }

  async input(input) {
    await this.ready;
    if (this.closing) throw new Error('The worker is closing');
    if (this.cancelled) throw new Error('This run was permanently cancelled');
    await this.admit(input);
  }

  async admit(input) {
    if (typeof input.request_id !== 'string' || !input.request_id || typeof input.message !== 'string' || !input.message.trim())
      throw new Error('Input requires a request_id and nonempty message');
    const id = await this.root.commit(async tx => {
      const doc = await tx.doc(RuntimeDoc, this.root.id);
      const id = await this.root.submit(tx, { type: 'input', content: input.message, requestId: input.request_id,
        whenBusy: input.mode === 'steer' ? 'steer' : 'followUp',
        ...(input.mode === 'steer' ? { whenIdle: 'reject' } : {}) });
      doc.inputs[id] = { request_id: input.request_id, mode: input.mode };
      return id;
    }, context);
    await this.emit('input.accepted', { request_id: input.request_id, mode: input.mode });
    this.harness.resume();
    return this.harness.submission(id, context);
  }

  async abort() {
    await this.ready;
    if (this.closing) return;
    this.cancelled = true;
    this.policy.restore({ ...this.policy.snapshot(), finalResult: { terminal: 'cancelled', code: 'user_cancelled' } });
    await this.persist({ cancelled: true });
    await this.root.abort(context);
  }

  async shutdown() {
    this.closing = true;
    await this.ready.catch(() => {});
    await this.harness?.close(context);
  }
}

export function createDurableRuntime(config, dependencies) {
  if (!config.storage_path) throw new Error('Durable runtime requires a host-owned storage_path');
  return createRuntime(config, { ...dependencies,
    agentFactory: (options, policy) => new DurableAgent(options, policy, config, dependencies.emit) });
}
