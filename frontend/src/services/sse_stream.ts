import { apiClient } from './api_client';
const getBaseURL = () => apiClient.getBaseURL();
import type {
  ThoughtEvent,
  CitationEvent,
  MessageEvent,
  SSEEventType,
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

    const params = new URLSearchParams({
      message: options.message,
      ...(options.knowledgeBaseIds?.length && {
        knowledgeBaseIds: options.knowledgeBaseIds.join(','),
      }),
      ...(options.sessionId && { sessionId: options.sessionId }),
    });

    const url = `${getBaseURL()}/chat/stream?${params}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.eventSource.onmessage = (ev: { data: string }) => {
      try {
        const raw = JSON.parse(ev.data) as {
          type?: string;
          event?: string;
          data?: unknown;
          delta?: string;
          references?: unknown;
        };

        const eventType = (raw.event ?? raw.type) as SSEEventType | undefined;
        const payload = raw.data ?? raw;

        const sseEvent: SSEEvent = {
          type: eventType || 'message',
          data: payload as any,
          timestamp: Date.now(),
        };

        switch (sseEvent.type) {
          case 'thought':
            callbacks.onThought?.(sseEvent.data as ThoughtEvent);
            break;
          case 'citation':
            callbacks.onCitation?.(sseEvent.data as CitationEvent);
            break;
          case 'message': {
            const msg = sseEvent.data as MessageEvent | { delta?: string };
            const delta = 'delta' in msg ? msg.delta : (msg as MessageEvent).delta;
            if (delta != null) {
              callbacks.onMessage?.({
                delta: typeof delta === 'string' ? delta : '',
                isComplete: (msg as MessageEvent).isComplete,
              });
            }
            break;
          }
          case 'complete':
            callbacks.onComplete?.();
            break;
          case 'error':
            callbacks.onError?.(sseEvent.data);
            break;
          default:
            if (typeof (sseEvent.data as any)?.delta === 'string') {
              callbacks.onMessage?.({
                delta: (sseEvent.data as any).delta,
                isComplete: (sseEvent.data as any).isComplete,
              });
            }
        }
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

  close(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.reconnectAttempts = 0;
  }
}

export const sseStreamManager = new SSEStreamManager();

export function createChatStream(
  message: string,
  callbacks: StreamChatCallbacks,
  opts?: { knowledgeBaseIds?: string[]; sessionId?: string }
) {
  return sseStreamManager.streamChat(
    {
      message,
      knowledgeBaseIds: opts?.knowledgeBaseIds,
      sessionId: opts?.sessionId,
    },
    callbacks
  );
}
