import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { chatApi } from '@/services/api_client';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  thinking?: {
    stage: 'intent' | 'routing' | 'retrieval' | 'generation';
    status: 'processing' | 'completed' | 'failed';
    message: string;
    data?: any;
    duration?: number;
  }[];
  citations?: Array<{
    id: number | string;
    type?: 'doc' | 'image';
    file_name?: string;
    content?: string;
    img_url?: string;
    scores?: { dense?: number; sparse?: number; visual?: number; rerank?: number };
    debug_info?: { chunk_id?: string; context_window?: { prev: string; next: string } };
    url?: string;
    title?: string;
    snippet?: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>;
  error?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  knowledgeBaseIds: string[];
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

export interface ThoughtData {
  intent_type?: string;
  original_query?: string;
  refined_query?: string;
  is_complex?: boolean;
  needs_visual?: boolean;
  sub_queries?: string[];
  current_sub_step?: number;
  target_kbs?: Array<{ id: string; name: string; score: number }>;
  fallback_search?: boolean;
  visual_activated?: boolean;
  sparse_keywords?: string[];
  search_strategies?: { dense: boolean; sparse: boolean; visual: boolean };
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

  updateSessionKnowledgeBases: (sessionId: string, knowledgeBaseIds: string[]) => void;

  loadSessionHistory: (sessionId: string) => Promise<void>;

  addMessage: (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
  
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  
  setLoading: (loading: boolean) => void;
  
  setError: (error: string | null) => void;
  
  clearError: () => void;
  
  setThinking: (thinking: Partial<ThinkingState>) => void;
  
  clearThinking: () => void;
  
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

      // 切换会话
      switchSession: (sessionId) => {
        set((state) => ({
          sessions: state.sessions.map(s => ({
            ...s,
            isActive: s.id === sessionId,
          })),
          activeSessionId: sessionId,
          error: null,
          thinking: initialThinking,
        }));
      },

      // 删除会话
      deleteSession: (sessionId) => {
        set((state) => {
          const updatedSessions = state.sessions.filter(s => s.id !== sessionId);
          let newActiveId = state.activeSessionId;
          
          // 如果删除的是当前活跃会话，选择第一个可用的会话
          if (sessionId === state.activeSessionId) {
            newActiveId = updatedSessions.length > 0 ? updatedSessions[0].id : null;
          }

          return {
            sessions: updatedSessions,
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

      // 更新会话关联的知识库
      updateSessionKnowledgeBases: (sessionId, knowledgeBaseIds) => {
        set((state) => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId ? { ...s, knowledgeBaseIds, updatedAt: Date.now() } : s
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
            set((state) => ({
              sessions: state.sessions.map(s =>
                s.id === sessionId ? { ...s, messages, updatedAt: Date.now() } : s
              ),
            }));
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
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);