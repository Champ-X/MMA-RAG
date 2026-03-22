/**
 * SSE 事件类型与前后端交互契约
 * 对应后端 One-Pass 意图识别、动态路由、两阶段重排等能力
 */

// ---------- 1. 思考阶段事件 (用于更新 ThinkingCapsule) ----------
export type ThoughtPhase = 'intent' | 'routing' | 'retrieval' | 'generation' | 'attachment';

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
    /** 检索结果数量（粗排后的候选数量） */
    total_found?: number;
    /** 重排后保留的数量 */
    reranked_count?: number;
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
  /** 向量库 point id，用于 context_window 查询 */
  chunk_id?: string;
  /** 知识库 id，检查器展示用 */
  kb_id?: string;
  context_window?: { prev: string; next: string };
}

export interface CitationReference {
  id: number;
  type: 'doc' | 'image' | 'audio' | 'video';
  file_name: string;
  file_path?: string;
  content: string;
  img_url?: string;
  /** 音频播放地址（预签名 URL），仅 type 为 audio 时有值 */
  audio_url?: string | null;
  /** 视频播放地址（预签名 URL），仅 type 为 video 时有值 */
  video_url?: string | null;
  /** 视频片段起始时间（秒），仅 type 为 video 时可选，用于跳转到指定时间点 */
  start_sec?: number;
  /** 视频片段结束时间（秒），仅 type 为 video 时可选 */
  end_sec?: number;
  /** 视频关键帧列表（仅 type 为 video 时），含缩略图 URL 与描述，用于在回答中展示 */
  key_frames?: Array<{
    timestamp?: number;
    description?: string;
    frame_image_path?: string;
    img_url?: string;
  }>;
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
