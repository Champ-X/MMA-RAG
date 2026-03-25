import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { chatApi } from '@/services/api_client';
import { collectUserAttachmentIds, deleteAttachmentBlobs } from '@/lib/chatAttachmentBlobStore';

/** 用户消息携带的附件展示信息；previewUrl 为内存 Object URL，仅当前页有效；thumbDataUrl 为小图 JPEG data URL，可随会话持久化 */
export interface ChatMessageAttachment {
  id: string
  kind: 'image' | 'audio'
  name: string
  size: number
  previewUrl?: string
  /** 持久化缩略图（data:image/jpeg;base64,...），用于刷新/重启后仍显示用户上传图 */
  thumbDataUrl?: string
}

export interface ThoughtData {
  intent_type?: string;
  original_query?: string;
  refined_query?: string;
  is_complex?: boolean;
  visual_intent?: 'explicit_demand' | 'implicit_enrichment' | 'unnecessary';
  visual_reasoning?: string;
  audio_intent?: 'explicit_demand' | 'implicit_enrichment' | 'unnecessary';
  audio_reasoning?: string;
  video_intent?: 'explicit_demand' | 'implicit_enrichment' | 'unnecessary';
  video_reasoning?: string;
  sub_queries?: string[];
  current_sub_step?: number;
  target_kbs?: Array<{ id: string; name: string; score: number }>;
  fallback_search?: boolean;
  visual_activated?: boolean;
  sparse_keywords?: string[];
  search_strategies?: { dense: boolean; sparse: boolean; visual: boolean };
  /** 检索结果数量（后端 total_found，粗排后的候选数量） */
  total_found?: number;
  /** 重排后保留的数量（后端 reranked_count） */
  reranked_count?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** 思考过程数据（流式结束后写入，供 ThinkingCapsule 展示） */
  thinking?: ThoughtData | {
    stage: 'intent' | 'routing' | 'retrieval' | 'generation';
    status: 'processing' | 'completed' | 'failed';
    message: string;
    data?: any;
    duration?: number;
  }[];
  /** 用户上传的附件（用于气泡上方预览；回答过程中仍显示） */
  attachments?: ChatMessageAttachment[]
  citations?: Array<{
    id: number | string;
    type?: 'doc' | 'image' | 'audio' | 'video';
    file_name?: string;
    file_path?: string;
    content?: string;
    img_url?: string;
    audio_url?: string | null;
    video_url?: string | null;
    scores?: { dense?: number; sparse?: number; visual?: number; rerank?: number };
    debug_info?: { chunk_id?: string; kb_id?: string; context_window?: { prev: string; next: string } };
    url?: string;
    title?: string;
    snippet?: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>;
  error?: string;
}

/** 释放 blob: 预览 URL，并删除 IndexedDB 中的附件二进制（删会话 / 覆盖历史时用） */
function cleanupMessageAttachments(messages: Message[] | undefined) {
  if (!messages?.length) return
  for (const m of messages) {
    for (const a of m.attachments ?? []) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    }
  }
  const ids = collectUserAttachmentIds(messages)
  if (ids.length) void deleteAttachmentBlobs(ids)
}

export type KbMode = 'auto' | 'all' | 'manual'

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  knowledgeBaseIds: string[];
  /** 检索模式：智能路由 / 全部知识库 / 指定知识库 */
  kbMode?: KbMode;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

export interface ThinkingState {
  currentStage: string;
  stages: {
    intent: 'idle' | 'processing' | 'completed' | 'failed';
    routing: 'idle' | 'processing' | 'completed' | 'failed';
    retrieval: 'idle' | 'processing' | 'completed' | 'failed';
    generation: 'idle' | 'processing' | 'completed' | 'failed';
  };
  progress: number;
  currentMessage?: string;
  thoughtData?: ThoughtData;
}

interface ChatStore {
  // 状态
  sessions: ChatSession[];
  activeSessionId: string | null;
  /** 当前正在接收流式回复的会话 id，用于切换标签时仍显示该会话的思考过程 */
  streamingSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  thinking: ThinkingState;

  // 操作
  createSession: (options?: {
    title?: string;
    knowledgeBaseIds?: string[];
  }) => string;

  createSessionFromApi: (options?: {
    title?: string;
    knowledgeBaseIds?: string[];
  }) => Promise<string>;
  
  switchSession: (sessionId: string) => void;
  
  deleteSession: (sessionId: string) => void;
  
  updateSessionTitle: (sessionId: string, title: string) => void;

  updateSessionKnowledgeBases: (sessionId: string, knowledgeBaseIds: string[], kbMode?: KbMode) => void;

  loadSessionHistory: (sessionId: string) => Promise<void>;

  addMessage: (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
  
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  
  setLoading: (loading: boolean) => void;
  
  setError: (error: string | null) => void;
  
  clearError: () => void;
  
  setThinking: (thinking: Partial<ThinkingState>) => void;
  
  clearThinking: () => void;
  
  setStreamingSessionId: (sessionId: string | null) => void;
  
  // 获取器
  getActiveSession: () => ChatSession | null;
  
  getSessionById: (sessionId: string) => ChatSession | null;
  
  getAllMessages: () => Message[];
}

const initialThinking: ThinkingState = {
  currentStage: '',
  stages: {
    intent: 'idle',
    routing: 'idle',
    retrieval: 'idle',
    generation: 'idle',
  },
  progress: 0,
  currentMessage: undefined,
};

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      // 初始状态
      sessions: [],
      activeSessionId: null,
      streamingSessionId: null,
      isLoading: false,
      error: null,
      thinking: initialThinking,

      // 创建新会话
      createSession: (options = {}) => {
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        
        const newSession: ChatSession = {
          id: sessionId,
          title: options.title || `新对话 ${new Date().toLocaleString()}`,
          messages: [],
          knowledgeBaseIds: options.knowledgeBaseIds || [],
          kbMode: 'auto',
          createdAt: now,
          updatedAt: now,
          isActive: true,
        };

        set((state) => {
          // 将其他会话设为非活跃状态
          const updatedSessions = state.sessions.map(s => ({ ...s, isActive: false }));
          
          return {
            sessions: [...updatedSessions, newSession],
            activeSessionId: sessionId,
          };
        });

        return sessionId;
      },

      createSessionFromApi: async (options = {}) => {
        try {
          const res = await chatApi.createSession({
            title: options.title,
            knowledgeBaseIds: options.knowledgeBaseIds,
          }) as { sessionId?: string; success?: boolean };
          const sessionId = res?.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const now = Date.now();
          const newSession: ChatSession = {
            id: sessionId,
            title: options.title || `新对话 ${new Date().toLocaleString()}`,
            messages: [],
            knowledgeBaseIds: options.knowledgeBaseIds || [],
            kbMode: 'auto',
            createdAt: now,
            updatedAt: now,
            isActive: true,
          };
          set((state) => {
            const updatedSessions = state.sessions.map(s => ({ ...s, isActive: false }));
            return {
              sessions: [...updatedSessions, newSession],
              activeSessionId: sessionId,
            };
          });
          return sessionId;
        } catch {
          return get().createSession(options);
        }
      },

      // 切换会话（不重置 thinking，避免正在流式的会话思考过程被清空）
      switchSession: (sessionId) => {
        set((state) => ({
          sessions: state.sessions.map(s => ({
            ...s,
            isActive: s.id === sessionId,
          })),
          activeSessionId: sessionId,
          error: null,
        }));
      },

      // 删除会话（若删光则自动新建一个，保证始终有会话）
      deleteSession: (sessionId) => {
        set((state) => {
          const doomed = state.sessions.find((s) => s.id === sessionId)
          cleanupMessageAttachments(doomed?.messages)

          const updatedSessions = state.sessions.filter(s => s.id !== sessionId);
          let newActiveId = state.activeSessionId;
          let sessions = updatedSessions;

          if (sessionId === state.activeSessionId) {
            newActiveId = updatedSessions.length > 0 ? updatedSessions[0].id : null;
          }

          if (sessions.length === 0) {
            const now = Date.now();
            const newSession: ChatSession = {
              id: `session_${now}_${Math.random().toString(36).substr(2, 9)}`,
              title: `新对话 ${new Date().toLocaleString()}`,
              messages: [],
              knowledgeBaseIds: [],
              kbMode: 'auto',
              createdAt: now,
              updatedAt: now,
              isActive: true,
            };
            sessions = [newSession];
            newActiveId = newSession.id;
          }

          return {
            sessions,
            activeSessionId: newActiveId,
          };
        });
      },

      // 更新会话标题
      updateSessionTitle: (sessionId, title) => {
        set((state) => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId ? { ...s, title, updatedAt: Date.now() } : s
          ),
        }));
      },

      // 更新会话关联的知识库与检索模式
      updateSessionKnowledgeBases: (sessionId, knowledgeBaseIds, kbMode) => {
        set((state) => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId
              ? { ...s, knowledgeBaseIds, ...(kbMode != null && { kbMode }), updatedAt: Date.now() }
              : s
          ),
        }));
      },

      // 从后端加载会话历史
      loadSessionHistory: async (sessionId) => {
        try {
          const res = await chatApi.getChatHistory(sessionId) as {
            success?: boolean;
            messages?: Array<{ role: string; content: string; timestamp?: string; citations?: unknown[] }>;
          };
          if (res?.success && Array.isArray(res.messages)) {
            const messages: Message[] = res.messages.map((m, i) => ({
              id: `msg_loaded_${sessionId}_${i}`,
              role: m.role as 'user' | 'assistant',
              content: m.content || '',
              timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
              citations: m.citations as Message['citations'],
            }));
            set((state) => {
              const prev = state.sessions.find((s) => s.id === sessionId)
              cleanupMessageAttachments(prev?.messages)
              return {
                sessions: state.sessions.map(s =>
                  s.id === sessionId ? { ...s, messages, updatedAt: Date.now() } : s
                ),
              }
            });
          }
        } catch {
          // 忽略加载失败（如会话不存在）
        }
      },

      // 添加消息
      addMessage: (sessionId, messageData) => {
        const message: Message = {
          ...messageData,
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
        };

        set((state) => ({
          sessions: state.sessions.map(s => 
            s.id === sessionId 
              ? {
                  ...s,
                  messages: [...s.messages, message],
                  updatedAt: Date.now(),
                }
              : s
          ),
        }));
      },

      // 更新消息
      updateMessage: (sessionId, messageId, updates) => {
        set((state) => ({
          sessions: state.sessions.map(s => 
            s.id === sessionId 
              ? {
                  ...s,
                  messages: s.messages.map(m => 
                    m.id === messageId ? { ...m, ...updates } : m
                  ),
                  updatedAt: Date.now(),
                }
              : s
          ),
        }));
      },

      // 设置加载状态
      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      // 设置错误
      setError: (error) => {
        set({ error });
      },

      // 清除错误
      clearError: () => {
        set({ error: null });
      },

      // 设置思维状态
      setThinking: (thinkingUpdates) => {
        set((state) => ({
          thinking: { ...state.thinking, ...thinkingUpdates },
        }));
      },

      // 清除思维状态
      clearThinking: () => {
        set({ thinking: initialThinking });
      },

      setStreamingSessionId: (sessionId) => {
        set({ streamingSessionId: sessionId });
      },

      // 获取活跃会话
      getActiveSession: () => {
        const state = get();
        return state.sessions.find(s => s.id === state.activeSessionId) || null;
      },

      // 根据ID获取会话
      getSessionById: (sessionId) => {
        const state = get();
        return state.sessions.find(s => s.id === sessionId) || null;
      },

      // 获取所有消息
      getAllMessages: () => {
        const state = get();
        const activeSession = state.sessions.find(s => s.id === state.activeSessionId);
        return activeSession?.messages || [];
      },
    }),
    {
      name: 'chat-store',
      partialize: (state) => ({
        sessions: state.sessions.map((s) => ({
          ...s,
          messages: s.messages.map((m) => ({
            ...m,
            attachments: m.attachments?.map(({ previewUrl: _p, ...rest }) => rest),
          })),
        })),
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);