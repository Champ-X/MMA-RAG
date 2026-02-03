import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { systemApi } from '@/services/api_client';

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  enabled: boolean;
}

export interface SystemConfig {
  models: ModelConfig[];
  defaultKnowledgeBaseIds: string[];
  maxContextLength: number;
  enableCitations: boolean;
  enableThinking: boolean;
  theme: 'light' | 'dark' | 'system';
  language: 'zh-CN' | 'en-US';
}

export interface ModelsByProvider {
  chat: string[];
  vision: string[];
  reranker: string[];
}

export interface AvailableModels {
  providers: string[];
  models_by_provider?: Record<string, ModelsByProvider>;
  chat_models: string[];
  vision_models: string[];
  reranker_models: string[];
}

interface ConfigStore {
  // 状态
  config: SystemConfig;
  availableModels: AvailableModels;
  isLoading: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;

  // 操作
  updateModelConfig: (modelId: string, updates: Partial<ModelConfig>) => void;
  
  updateSystemConfig: (updates: Partial<SystemConfig>) => void;
  
  resetModelConfig: (modelId: string) => void;
  
  resetAllConfig: () => void;
  
  saveConfig: () => Promise<void>;
  
  loadConfig: () => Promise<void>;
  
  setLoading: (loading: boolean) => void;
  
  setError: (error: string | null) => void;
  
  markAsChanged: () => void;
  
  markAsSaved: () => void;

  // 获取器
  getModelConfig: (modelId: string) => ModelConfig | undefined;
  
  getEnabledModels: () => ModelConfig[];
  
  getConfigSummary: () => {
    totalModels: number;
    enabledModels: number;
    hasChanges: boolean;
  };
}

const defaultConfig: SystemConfig = {
  models: [
    {
      id: 'chat',
      name: '对话模型',
      provider: 'siliconflow',
      model: 'deepseek-chat',
      maxTokens: 4096,
      temperature: 0.7,
      topP: 0.9,
      enabled: true,
    },
    {
      id: 'embedding',
      name: '嵌入模型',
      provider: 'siliconflow',
      model: 'BAAI/bge-large-zh-v1.5',
      maxTokens: 512,
      temperature: 0.1,
      topP: 0.8,
      enabled: true,
    },
    {
      id: 'rerank',
      name: '重排模型',
      provider: 'siliconflow',
      model: 'BAAI/bge-reranker-large',
      maxTokens: 256,
      temperature: 0.1,
      topP: 0.8,
      enabled: true,
    },
    {
      id: 'caption',
      name: '图像描述模型',
      provider: 'siliconflow',
      model: 'gpt-4o-mini',
      maxTokens: 1024,
      temperature: 0.3,
      topP: 0.9,
      enabled: true,
    },
  ],
  defaultKnowledgeBaseIds: [],
  maxContextLength: 8000,
  enableCitations: true,
  enableThinking: true,
  theme: 'system',
  language: 'zh-CN',
};

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      // 初始状态
      config: defaultConfig,
      availableModels: { providers: [], models_by_provider: {}, chat_models: [], vision_models: [], reranker_models: [] },
      isLoading: false,
      error: null,
      hasUnsavedChanges: false,

      // 更新模型配置
      updateModelConfig: (modelId, updates) => {
        set((state) => ({
          config: {
            ...state.config,
            models: state.config.models.map(model =>
              model.id === modelId ? { ...model, ...updates } : model
            ),
          },
          hasUnsavedChanges: true,
        }));
      },

      // 更新系统配置
      updateSystemConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
          hasUnsavedChanges: true,
        }));
      },

      // 重置单个模型配置
      resetModelConfig: (modelId) => {
        const defaultModel = defaultConfig.models.find(m => m.id === modelId);
        if (defaultModel) {
          set((state) => ({
            config: {
              ...state.config,
              models: state.config.models.map(model =>
                model.id === modelId ? { ...defaultModel } : model
              ),
            },
            hasUnsavedChanges: true,
          }));
        }
      },

      // 重置所有配置
      resetAllConfig: () => {
        set(() => ({
          config: defaultConfig,
          hasUnsavedChanges: true,
        }));
      },

      // 保存配置（后端暂无写入接口，仅本地持久化）
      saveConfig: async () => {
        set({ isLoading: true, error: null });

        try {
          await systemApi.updateModelConfig(get().config);
          set({ hasUnsavedChanges: false, isLoading: false });
        } catch (error) {
          set({ hasUnsavedChanges: false, isLoading: false });
        }
      },

      // 加载配置（从 /chat/models 获取当前配置与可用模型列表）
      loadConfig: async () => {
        set({ isLoading: true, error: null });

        try {
          const data = await systemApi.getModelConfig() as {
            providers?: string[];
            models_by_provider?: Record<string, { chat: string[]; vision: string[]; reranker: string[] }>;
            chat_models?: string[];
            vision_models?: string[];
            reranker_models?: string[];
            current_config?: Record<string, { model: string; provider: string }>;
          };
          const availableModels = {
            providers: data.providers ?? [],
            models_by_provider: data.models_by_provider ?? {},
            chat_models: data.chat_models ?? [],
            vision_models: data.vision_models ?? [],
            reranker_models: data.reranker_models ?? [],
          };
          const cc = data.current_config ?? {};
          set((state) => {
            const models = state.config.models.map((m) => {
              if (m.id === 'chat' && cc.final_generation) {
                return { ...m, model: cc.final_generation.model, provider: cc.final_generation.provider };
              }
              if (m.id === 'caption' && cc.image_captioning) {
                return { ...m, model: cc.image_captioning.model, provider: cc.image_captioning.provider };
              }
              if (m.id === 'rerank' && cc.reranking) {
                return { ...m, model: cc.reranking.model, provider: cc.reranking.provider };
              }
              return m;
            });
            return {
              config: { ...state.config, models },
              availableModels,
              isLoading: false,
            };
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : '加载配置失败',
            isLoading: false,
          });
        }
      },

      // 设置加载状态
      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      // 设置错误
      setError: (error) => {
        set({ error });
      },

      // 标记为已更改
      markAsChanged: () => {
        set({ hasUnsavedChanges: true });
      },

      // 标记为已保存
      markAsSaved: () => {
        set({ hasUnsavedChanges: false });
      },

      // 获取模型配置
      getModelConfig: (modelId) => {
        const state = get();
        return state.config.models.find(model => model.id === modelId);
      },

      // 获取启用的模型
      getEnabledModels: () => {
        const state = get();
        return state.config.models.filter(model => model.enabled);
      },

      // 获取配置摘要
      getConfigSummary: () => {
        const state = get();
        return {
          totalModels: state.config.models.length,
          enabledModels: state.config.models.filter(model => model.enabled).length,
          hasChanges: state.hasUnsavedChanges,
        };
      },
    }),
    {
      name: 'config-store',
      partialize: (state) => ({
        config: state.config,
      }),
    }
  )
);