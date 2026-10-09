import { apiClient } from './api_client';
const getBaseURL = () => apiClient.getBaseURL();
import type {
  ThoughtEvent,
  CitationEvent,
  MessageEvent,
  SSEEventType,
  ThoughtPhase,
  CompleteEvent,
} from '@/types/sse';
import type { AgentMode, ChatScopeFile } from '@/store/useChatStore'
import type { ChatMention } from '@/lib/chatReferences'
import { referenceFilesFromMentions } from '@/lib/chatReferenceScope'

export type { ThoughtEvent, CitationEvent, MessageEvent };

export interface SSEEvent {
  type: SSEEventType;
  data: ThoughtEvent | CitationEvent | MessageEvent | Record<string, unknown>;
  timestamp: number;
}

export interface StreamChatCallbacks {
  onThought?: (event: ThoughtEvent) => void;
  onCitation?: (event: CitationEvent) => void;
  onMessage?: (event: MessageEvent) => void;
  onComplete?: (event: CompleteEvent) => void;
  onError?: (error: unknown) => void;
}

export interface StreamChatOptions {
  message: string;
  knowledgeBaseIds?: string[];
  sessionId?: string;
  model?: string;
  files?: File[];
  selectedFiles?: ChatScopeFile[];
  mentions?: ChatMention[];
  attachmentIds?: string[];
  agentMode?: AgentMode;
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function serializeSelectedFiles(selectedFiles: ChatScopeFile[]) {
  return selectedFiles.map((file) => ({
    kb_id: file.kbId,
    file_id: file.fileId,
    name: file.name,
    ...(file.type ? { type: file.type } : {}),
    ...(file.kbName ? { kb_name: file.kbName } : {}),
  }))
}

function dispatchSseJsonPayload(raw: Record<string, unknown>, callbacks: StreamChatCallbacks): void {
  const eventType = (raw.event ?? raw.type) as SSEEventType | undefined;
  const payload = (raw.data ?? raw) as Record<string, unknown>;

  const evType = eventType as string;
  switch (evType) {
    case 'thought':
      callbacks.onThought?.(payload as unknown as ThoughtEvent);
      break;
    case 'thinking': {
      const r = raw as { stage?: string; message?: string };
      callbacks.onThought?.({
        type: (r.stage as ThoughtPhase) || 'generation',
        data: { message: r.message },
      });
      break;
    }
    case 'citation':
      callbacks.onCitation?.(payload as unknown as CitationEvent);
      break;
    case 'message': {
      const msg = payload as MessageEvent | { delta?: string; content?: string };
      const delta =
        'delta' in msg ? msg.delta : (msg as { content?: string }).content ?? (msg as MessageEvent).delta;
      if (delta != null) {
        callbacks.onMessage?.({
          delta: typeof delta === 'string' ? delta : '',
          isComplete: (msg as MessageEvent).isComplete,
        });
      }
      break;
    }
    case 'complete':
    case 'done':
      callbacks.onComplete?.(payload as CompleteEvent);
      break;
    case 'error':
      callbacks.onError?.(payload);
      break;
    default:
      if (typeof (payload as { delta?: string }).delta === 'string') {
        callbacks.onMessage?.({
          delta: (payload as { delta: string }).delta,
          isComplete: (payload as { isComplete?: boolean }).isComplete,
        });
      } else if (typeof (raw as { content?: string }).content === 'string') {
        callbacks.onMessage?.({ delta: (raw as { content: string }).content, isComplete: false });
      }
  }
}

class SSEStreamManager {
  private eventSource: EventSource | null = null;

  streamChat(
    options: StreamChatOptions,
    callbacks: StreamChatCallbacks
  ): { close: () => void; get isClosed(): boolean } {
    this.close();

    if (options.files?.length || options.selectedFiles?.length || options.mentions?.length || options.conversationContext) {
      return this._streamChatMultipart(options, callbacks);
    }

    const params = new URLSearchParams({
      message: options.message,
      ...(options.knowledgeBaseIds?.length && {
        knowledgeBaseIds: options.knowledgeBaseIds.join(','),
      }),
      ...(options.sessionId && { sessionId: options.sessionId }),
      ...(options.model && { model: options.model }),
      ...(options.agentMode != null && { agentMode: String(options.agentMode) }),
    });
    if (options.selectedFiles?.length) {
      params.set('selectedFiles', JSON.stringify(serializeSelectedFiles(options.selectedFiles)))
    }

    const url = `${getBaseURL()}/chat/stream?${params}`;
    const source = new EventSource(url);
    this.eventSource = source;
    let closed = false;
    const isCurrent = () => !closed && this.eventSource === source;
    const closeSource = () => {
      if (closed) return;
      closed = true;
      source.onmessage = null;
      source.onerror = null;
      source.close();
      if (this.eventSource === source) this.eventSource = null;
    };
    const fail = (error: unknown) => {
      if (!isCurrent()) return;
      closeSource();
      callbacks.onError?.(error);
    };

    source.onmessage = (ev: { data: string }) => {
      if (!isCurrent()) return;
      let raw: Record<string, unknown>;
      try {
        const parsed = JSON.parse(ev.data) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('无效的 SSE 响应');
        raw = parsed as Record<string, unknown>;
      } catch (err) {
        fail(err);
        return;
      }
      if (['complete', 'done', 'error'].includes(String(raw.event ?? raw.type))) closeSource();
      dispatchSseJsonPayload(raw, callbacks);
    };

    source.onerror = () => {
      // This endpoint starts a new chat operation and has no event-resume
      // protocol. Native automatic reconnection would repeat the whole query.
      fail(new Error('连接在回答完成前中断，请重试。'));
    };

    return {
      close: closeSource,
      get isClosed() {
        return closed || source.readyState === EventSource.CLOSED;
      },
    };
  }

  private _multipartAbort: AbortController | null = null;

  private _streamChatMultipart(
    options: StreamChatOptions,
    callbacks: StreamChatCallbacks
  ): { close: () => void; get isClosed(): boolean } {
    const ac = new AbortController();
    this._multipartAbort = ac;

    const form = new FormData();
    form.append('message', options.message || '');
    // Multipart string fields normalize LF to CRLF. JSON escapes preserve the
    // exact text against which UTF-16 mention offsets were calculated.
    form.append('messageJson', JSON.stringify(options.message || ''));
    if (options.conversationContext) form.append('conversationContext', JSON.stringify(options.conversationContext));
    // Always send the independent field, including [], to disambiguate legacy clients.
    form.append('referenceFiles', JSON.stringify(serializeSelectedFiles(referenceFilesFromMentions(options.mentions))));
    if (options.knowledgeBaseIds?.length) {
      form.append('knowledgeBaseIds', options.knowledgeBaseIds.join(','));
    }
    if (options.sessionId) {
      form.append('sessionId', options.sessionId);
    }
    if (options.model) {
      form.append('model', options.model);
    }
    if (options.agentMode != null) {
      form.append('agentMode', String(options.agentMode));
    }
    if (options.selectedFiles?.length) {
      form.append('selectedFiles', JSON.stringify(serializeSelectedFiles(options.selectedFiles)));
    }
    for (const f of options.files ?? []) {
      form.append('files', f);
    }
    if (options.mentions?.length) form.append('mentions', JSON.stringify(options.mentions));
    if (options.attachmentIds?.length) form.append('attachmentIds', JSON.stringify(options.attachmentIds));

    const run = async () => {
      let terminalReceived = false;
      try {
        const headers: HeadersInit = {};
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(`${getBaseURL()}/chat/stream`, {
          method: 'POST',
          body: form,
          headers,
          signal: ac.signal,
        });
        if (!res.ok) {
          const t = await res.text();
          callbacks.onError?.(new Error(t || res.statusText || `HTTP ${res.status}`));
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          callbacks.onError?.(new Error('响应无正文'));
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            for (const line of part.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const jsonStr = line.replace(/^data:\s?/, '').trim();
              if (!jsonStr) continue;
              try {
                const raw = JSON.parse(jsonStr) as Record<string, unknown>;
                if (raw.type === 'connected') continue;
                if (['complete', 'done', 'error'].includes(String(raw.type ?? raw.event))) terminalReceived = true;
                dispatchSseJsonPayload(raw, callbacks);
              } catch (e) {
                console.error('SSE chunk parse error', e, jsonStr);
              }
            }
          }
        }
        if (!terminalReceived && !ac.signal.aborted) {
          callbacks.onError?.(new Error('连接在回答完成前中断，请重试。'));
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        callbacks.onError?.(e);
      } finally {
        if (this._multipartAbort === ac) {
          this._multipartAbort = null;
        }
      }
    };

    void run();

    const self = this;
    return {
      close: () => {
        ac.abort();
        if (self._multipartAbort === ac) {
          self._multipartAbort = null;
        }
      },
      get isClosed() {
        return ac.signal.aborted;
      },
    };
  }

  close(): void {
    if (this.eventSource) {
      this.eventSource.onmessage = null;
      this.eventSource.onerror = null;
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this._multipartAbort) {
      this._multipartAbort.abort();
      this._multipartAbort = null;
    }
  }
}

export const sseStreamManager = new SSEStreamManager();

export function createChatStream(
  message: string,
  callbacks: StreamChatCallbacks,
  opts?: Omit<StreamChatOptions, 'message'>
) {
  return sseStreamManager.streamChat(
    {
      message,
      knowledgeBaseIds: opts?.knowledgeBaseIds,
      sessionId: opts?.sessionId,
      model: opts?.model,
      files: opts?.files,
      selectedFiles: opts?.selectedFiles,
      agentMode: opts?.agentMode,
      mentions: opts?.mentions,
      attachmentIds: opts?.attachmentIds,
      conversationContext: opts?.conversationContext,
    },
    callbacks
  );
}
