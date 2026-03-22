import { apiClient } from './api_client';
const getBaseURL = () => apiClient.getBaseURL();
import type {
  ThoughtEvent,
  CitationEvent,
  MessageEvent,
  SSEEventType,
  ThoughtPhase,
} from '@/types/sse';

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
  onComplete?: () => void;
  onError?: (error: unknown) => void;
}

export interface StreamChatOptions {
  message: string;
  knowledgeBaseIds?: string[];
  sessionId?: string;
  model?: string;
  files?: File[];
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
      callbacks.onComplete?.();
      break;
    case 'error':
      callbacks.onError?.(
        typeof (raw as { message?: string }).message === 'string'
          ? new Error((raw as { message: string }).message)
          : payload
      );
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
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;

  streamChat(
    options: StreamChatOptions,
    callbacks: StreamChatCallbacks
  ): { close: () => void; get isClosed(): boolean } {
    this.close();

    if (options.files && options.files.length > 0) {
      return this._streamChatMultipart(options, callbacks);
    }

    const params = new URLSearchParams({
      message: options.message,
      ...(options.knowledgeBaseIds?.length && {
        knowledgeBaseIds: options.knowledgeBaseIds.join(','),
      }),
      ...(options.sessionId && { sessionId: options.sessionId }),
      ...(options.model && { model: options.model }),
    });

    const url = `${getBaseURL()}/chat/stream?${params}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.eventSource.onmessage = (ev: { data: string }) => {
      try {
        const raw = JSON.parse(ev.data) as Record<string, unknown>;
        dispatchSseJsonPayload(raw, callbacks);
      } catch (err) {
        console.error('SSE parse error:', err, ev.data);
        callbacks.onError?.(err);
      }
    };

    this.eventSource.onerror = () => {
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay =
            this.reconnectDelay *
            Math.pow(2, this.reconnectAttempts - 1);
          setTimeout(() => this.streamChat(options, callbacks), delay);
        } else {
          callbacks.onError?.(new Error('SSE 连接失败，已达最大重试次数'));
        }
      }
    };

    const self = this;
    return {
      close: () => self.close(),
      get isClosed() {
        return !self.eventSource || self.eventSource.readyState === EventSource.CLOSED;
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
    if (options.knowledgeBaseIds?.length) {
      form.append('knowledgeBaseIds', options.knowledgeBaseIds.join(','));
    }
    if (options.sessionId) {
      form.append('sessionId', options.sessionId);
    }
    if (options.model) {
      form.append('model', options.model);
    }
    for (const f of options.files ?? []) {
      form.append('files', f);
    }

    const run = async () => {
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
                dispatchSseJsonPayload(raw, callbacks);
              } catch (e) {
                console.error('SSE chunk parse error', e, jsonStr);
              }
            }
          }
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
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this._multipartAbort) {
      this._multipartAbort.abort();
      this._multipartAbort = null;
    }
    this.reconnectAttempts = 0;
  }
}

export const sseStreamManager = new SSEStreamManager();

export function createChatStream(
  message: string,
  callbacks: StreamChatCallbacks,
  opts?: { knowledgeBaseIds?: string[]; sessionId?: string; model?: string; files?: File[] }
) {
  return sseStreamManager.streamChat(
    {
      message,
      knowledgeBaseIds: opts?.knowledgeBaseIds,
      sessionId: opts?.sessionId,
      model: opts?.model,
      files: opts?.files,
    },
    callbacks
  );
}
