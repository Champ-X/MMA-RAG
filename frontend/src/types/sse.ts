/**
 * SSE 事件类型与前后端交互契约
 * 对应后端 One-Pass 意图识别、动态路由、两阶段重排等能力
 */

import type { DecisionDiagnostics } from './decision'

// ---------- 1. 思考阶段事件 (用于更新 ThinkingCapsule) ----------
export type ThoughtPhase = 'intent' | 'routing' | 'retrieval' | 'generation' | 'attachment';

/** Durations are measured with the server's monotonic clock, in milliseconds. */
export interface StageTiming {
  started_at: number;
  duration_ms: number;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  substage_durations_ms?: Record<string, number>;
  /** Local monotonic receipt time, only used while this stream is active. */
  _received_at?: number;
  _local_snapshot?: boolean;
}
export type StageTimings = Partial<Record<ThoughtPhase, StageTiming>>;
export interface CompleteEvent {
  stage_timings?: StageTimings;
  thinking?: Record<string, unknown>;
  diagnostics?: DecisionDiagnostics;
}

export interface AgentRoundTrace {
  round: number;
  action: 'search';
  status: 'processing' | 'completed' | 'failed';
  reason: string;
  queries: string[];
  result_count: number;
  new_evidence_count: number;
  total_evidence_count: number;
  target_kbs: Array<{ id: string; name: string; score: number }>;
  duration_seconds: number;
  error?: string;
}

export interface ThoughtEvent {
  type: ThoughtPhase;
  data: {
    stage_timing?: StageTiming;
    stage_timings?: StageTimings;
    message?: string;
    stage_status?: 'processing' | 'completed' | 'failed';
    status?: string;
    agent_status?: 'planning' | 'searching' | 'evaluating' | 'completed';
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
    /** Agent 每一轮的完整快照，按执行顺序排列。 */
    agent_rounds?: AgentRoundTrace[];
  };
}

// ---------- 2. 引用预加载 (用于 Sidebar Inspector 和 Popover) ----------
export interface CitationScore {
  dense?: number | null;
  sparse?: number | null;
  visual?: number | null;
  rerank?: number | null;
  final?: number | null;
}

export interface CitationDebugInfo {
  /** 向量库 point id，用于 context_window 查询 */
  chunk_id?: string;
  /** 知识库 id，检查器展示用 */
  kb_id?: string;
  /** 仅供兼容旧会话：该图片是否由视频关键帧生成。关键帧不应作为回答插图渲染。 */
  from_video_keyframe?: boolean;
  context_window?: { prev: string; next: string };
}

export interface CitationReference {
  id: number;
  /** Omitted on older knowledge-base citations. Local originals resolve only by attachment_id. */
  source?: 'knowledge' | 'attachment';
  attachment_id?: string;
  /** Pi originals are durable and owner-checked, independent of browser blobs. */
  pi_run_id?: string;
  /** Original identity within the Pi run; multiple evidence IDs may share it. */
  source_id?: string;
  media_info?: { duration_seconds?: number; width?: number; height?: number; sampled_seconds?: number[]; audio_status?: string };
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
  /** 历史会话兼容字段：视频关键帧不会在回答中默认展示。 */
  key_frames?: Array<{
    timestamp?: number;
    description?: string;
    frame_image_path?: string;
    img_url?: string;
  }>;
  /** v2 保留真实分路分数；旧版 rerank 实际保存的是综合排序分。 */
  score_version?: number;
  scores?: CitationScore;
  debug_info?: CitationDebugInfo;
}

export interface CitationEvent {
  references: CitationReference[];
  /** 最终正文的来源集合；空数组也必须覆盖预加载候选。 */
  replace?: boolean;
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
