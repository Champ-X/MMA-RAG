/**
 * SSE 事件类型与前后端交互契约
 * 对应后端 One-Pass 意图识别、动态路由、两阶段重排等能力
 */

// ---------- 1. 思考阶段事件 (用于更新 ThinkingCapsule) ----------
export type ThoughtPhase = 'intent' | 'routing' | 'retrieval' | 'generation';

export interface ThoughtEvent {
  type: ThoughtPhase;
  data: {
    message?: string;
    intent_type?: string;
    original_query?: string;
    refined_query?: string;
    is_complex?: boolean;
    sub_queries?: string[];
    current_sub_step?: number;
    target_kbs?: Array<{ id: string; name: string; score: number }>;
    fallback_search?: boolean;
    visual_activated?: boolean;
    sparse_keywords?: string[];
    search_strategies?: {
      dense: boolean;
      sparse: boolean;
      visual: boolean;
    };
  };
}

// ---------- 2. 引用预加载 (用于 Sidebar Inspector 和 Popover) ----------
export interface CitationScore {
  dense: number;
  sparse: number;
  visual?: number;
  rerank: number;
}

export interface CitationDebugInfo {
  chunk_id: string;
  context_window?: { prev: string; next: string };
}

export interface CitationReference {
  id: number;
  type: 'doc' | 'image';
  file_name: string;
  content: string;
  img_url?: string;
  scores: CitationScore;
  debug_info?: CitationDebugInfo;
}

export interface CitationEvent {
  references: CitationReference[];
}

// ---------- 3. 消息流 (用于打字机) ----------
export interface MessageEvent {
  delta: string;
  isComplete?: boolean;
}

// ---------- 4. SSE 统一事件 (EventSource 解析用) ----------
export type SSEEventType = 'thought' | 'citation' | 'message' | 'complete' | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: ThoughtEvent | CitationEvent | MessageEvent | Record<string, unknown>;
  timestamp?: number;
}
