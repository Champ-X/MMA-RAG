import type { Message } from '../store/useChatStore'
import type { PiRun } from '../types/pi'
import { initialPiTrace, mergePiInputs } from './piTrace'

/** Merge immutable server runs without overwriting newer local stream state.
 * Traces replay from zero; no model request is restarted during recovery. */
export function restorePiMessages(existing: Message[], runs: PiRun[]): Message[] {
  let updated = existing
  const known = new Set(existing.flatMap(message => message.pi ? [message.pi.runId] : []))
  const added: Message[] = []
  for (const run of runs) {
    if (known.has(run.id)) {
      const current = updated.find(message => message.pi?.runId === run.id)
      if (current?.pi && (run.seq > current.pi.seq || !current.pi.runtime && run.config.runtime)) {
        updated = updated.map(message => message !== current ? message : { ...message, pi: { ...current.pi!,
          runtime: run.config.runtime || current.pi!.runtime || 'core',
          runtimePaused: run.seq >= current.pi!.seq ? run.state.runtime_paused === true : current.pi!.runtimePaused,
          replayThrough: Math.max(current.pi!.replayThrough || 0, run.seq), connectionError: undefined,
          inputs: run.seq >= current.pi!.seq ? mergePiInputs(current.pi!.inputs, run.state.inputs) : current.pi!.inputs } })
      }
      continue
    }
    known.add(run.id)
    const timestamp = run.created_at * 1000
    added.push({ id: `pi_user_${run.id}`, role: 'user', executionEngine: 'pi',
      content: run.request.message, timestamp, mentions: run.request.mentions, scopeVersion: 2,
      scopeFiles: run.request.selected_files?.map(file => ({ kbId: file.kb_id, fileId: file.file_id,
        name: file.name, type: file.type, kbName: file.kb_name })),
      attachments: run.request.attachments?.map(file => ({ id: file.id, name: file.name, kind: file.modality, size: file.size })) },
    { id: `pi_answer_${run.id}`, role: 'assistant', executionEngine: 'pi', timestamp: timestamp + .01,
      content: run.state.answer || '', citations: run.state.citations || [], pi: initialPiTrace(run) })
  }
  return added.length ? [...updated, ...added].sort((a, b) => a.timestamp - b.timestamp) : updated
}
