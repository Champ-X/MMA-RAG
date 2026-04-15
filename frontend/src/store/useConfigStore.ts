import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { systemApi } from '@/services/api_client';

export type AvailableModelType = 'chat' | 'embedding' | 'vision' | 'reranker' | 'audio' | 'video';
export type TaskBoundModelId =
  | 'intent'
  | 'rewrite'
  | 'caption'
  | 'chat'
  | 'rerank'
  | 'audio'
  | 'video'
  | 'portrait';

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

export interface TaskModelBinding {
  taskKey: string;
  category: AvailableModelType;
  name: string;
}

export const TASK_MODEL_BINDINGS: Record<TaskBoundModelId, TaskModelBinding> = {
  intent: { taskKey: 'intent_recognition', category: 'chat', name: '意图识别模型' },
  rewrite: { taskKey: 'query_rewriting', category: 'chat', name: '查询改写模型' },
  caption: { taskKey: 'image_captioning', category: 'vision', name: '图像描述模型' },
  chat: { taskKey: 'final_generation', category: 'chat', name: '对话模型' },
  rerank: { taskKey: 'reranking', category: 'reranker', name: '重排模型' },
  audio: { taskKey: 'audio_transcription', category: 'audio', name: '音频转写模型' },
  video: { taskKey: 'video_parsing', category: 'video', name: '视频解析模型' },
  portrait: { taskKey: 'kb_portrait_generation', category: 'chat', name: '知识库画像模型' },
};

export interface SystemConfig {
  models: ModelConfig[];
  defaultKnowledgeBaseIds: string[];
  maxContextLength: number;
  enableCitations: boolean;
  enableThinking: boolean;
  theme: 'light' | 'dark' | 'system';
  language: 'zh-CN' | 'en-US';
}

function mergeWithDefaultModels(models: ModelConfig[]): ModelConfig[] {
  const base = defaultConfig.models.map((defaultModel) => {
    const current = models.find((m) => m.id === defaultModel.id)
    return current ? { ...defaultModel, ...current } : { ...defaultModel }
  })
  const knownIds = new Set(base.map((m) => m.id))
  const extras = models.filter((m) => !knownIds.has(m.id))
  return [...base, ...extras]
}

export interface ModelsByProvider {
  chat: string[];
  embedding: string[];
  vision: string[];
  reranker: string[];
  audio: string[];
  video: string[];
}

export interface AvailableModels {
  providers: string[];
  models_by_provider?: Record<string, ModelsByProvider>;
  chat_models: string[];
  embedding_models: string[];
  vision_models: string[];
  reranker_models: string[];
  audio_models: string[];
  video_models: string[];
}

function getProviderModels(
  availableModels: AvailableModels,
  provider: string,
  category: AvailableModelType
): string[] {
  return availableModels.models_by_provider?.[provider]?.[category] ?? [];
}

function getProvidersForCategory(
  availableModels: AvailableModels,
  category: AvailableModelType
): string[] {
  if (!availableModels.models_by_provider) return [];
  return Object.entries(availableModels.models_by_provider)
    .filter(([, models]) => (models?.[category] ?? []).length > 0)
    .map(([provider]) => provider);
}

function normalizeTaskBoundModel(model: ModelConfig, availableModels: AvailableModels): ModelConfig {
  const binding = TASK_MODEL_BINDINGS[model.id as TaskBoundModelId];
  if (!binding) return model;

  const providers = getProvidersForCategory(availableModels, binding.category);
  if (providers.length === 0) {
    return { ...model, provider: '', model: '' };
  }

  const provider = providers.includes(model.provider) ? model.provider : providers[0];
  const candidates = getProviderModels(availableModels, provider, binding.category);
  const selectedModel = candidates.includes(model.model) ? model.model : (candidates[0] ?? '');

  return {
    ...model,
    provider,
    model: selectedModel,
  };
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
      id: 'intent',
      name: '意图识别模型',
      provider: 'aliyun_bailian',
      model: 'aliyun_bailian:qwen3-max',
      maxTokens: 1024,
      temperature: 0.1,
      topP: 0.9,
      enabled: true,
    },
    {
      id: 'rewrite',
      name: '查询改写模型',
      provider: 'aliyun_bailian',
      model: 'aliyun_bailian:qwen3.5-flash',
      maxTokens: 1024,
      temperature: 0.1,
      topP: 0.9,
      enabled: true,
    },
    {
      id: 'chat',
      name: '对话模型',
      provider: 'siliconflow',
      model: 'Pro/moonshotai/Kimi-K2.5',
      maxTokens: 4096,
      temperature: 0.7,
      topP: 0.9,
      enabled: true,
    },
    {
      id: 'embedding',
      name: '嵌入模型',
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-Embedding-8B',
      maxTokens: 512,
      temperature: 0.1,
      topP: 0.8,
      enabled: true,
    },
    {
      id: 'rerank',
      name: '重排模型',
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-Reranker-8B',
      maxTokens: 256,
      temperature: 0.1,
      topP: 0.8,
      enabled: true,
    },
    {
      id: 'caption',
      name: '图像描述模型',
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
      maxTokens: 1024,
      temperature: 0.3,
      topP: 0.9,
      enabled: true,
    },
    {
      id: 'audio',
      name: '音频转写模型',
      provider: 'aliyun_bailian',
      model: 'aliyun_bailian:qwen3-omni-flash',
      maxTokens: 1024,
      temperature: 0.2,
      topP: 0.9,
      enabled: true,
    },
    {
      id: 'video',
      name: '视频解析模型',
      provider: 'aliyun_bailian',
      model: 'aliyun_bailian:qwen3.5-plus-2026-02-15',
      maxTokens: 2048,
      temperature: 0.2,
      topP: 0.9,
      enabled: true,
    },
    {
      id: 'portrait',
      name: '知识库画像模型',
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
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
      availableModels: {
        providers: [],
        models_by_provider: {},
        chat_models: [],
        embedding_models: [],
        vision_models: [],
        reranker_models: [],
        audio_models: [],
        video_models: [],
      },
      isLoading: false,
      error: null,
      hasUnsavedChanges: false,

      // 更新模型配置
      updateModelConfig: (modelId, updates) => {
        set((state) => {
          const existing = state.config.models.find((model) => model.id === modelId)
          const fallback = defaultConfig.models.find((model) => model.id === modelId)
          const nextModels = existing
            ? state.config.models.map((model) =>
                model.id === modelId ? { ...model, ...updates } : model
              )
            : [
                ...state.config.models,
                {
                  ...(fallback ?? {
                    id: modelId,
                    name: modelId,
                    provider: 'siliconflow',
                    model: '',
                    maxTokens: 1024,
                    temperature: 0.3,
                    topP: 0.9,
                    enabled: true,
                  }),
                  ...updates,
                },
              ]

          return {
            config: {
              ...state.config,
              models: mergeWithDefaultModels(nextModels),
            },
            hasUnsavedChanges: true,
          }
        });
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

      // 保存配置（后端运行时更新并持久化）
      saveConfig: async () => {
        set({ isLoading: true, error: null });

        try {
          const taskSelections = Object.entries(TASK_MODEL_BINDINGS).reduce<Record<string, { model: string; provider?: string }>>(
            (acc, [modelId, binding]) => {
              const model = get().config.models.find((item) => item.id === modelId);
              if (!model?.model) return acc;
              acc[binding.taskKey] = {
                model: model.model,
                provider: model.provider || undefined,
              };
              return acc;
            },
            {}
          );
          await systemApi.updateModelConfig({ tasks: taskSelections });
          set({ hasUnsavedChanges: false, isLoading: false });
        } catch (error) {
          set({
            hasUnsavedChanges: true,
            isLoading: false,
            error: error instanceof Error ? error.message : '保存配置失败',
          });
          throw error;
        }
      },

      // 加载配置（从 /chat/models 获取当前配置与可用模型列表）
      loadConfig: async () => {
        set({ isLoading: true, error: null });

        try {
          const data = await systemApi.getModelConfig() as {
            providers?: string[];
            models_by_provider?: Record<string, ModelsByProvider>;
            chat_models?: string[];
            embedding_models?: string[];
            vision_models?: string[];
            reranker_models?: string[];
            audio_models?: string[];
            video_models?: string[];
            current_config?: Record<string, { model: string; provider: string }>;
          };
          const availableModels = {
            providers: data.providers ?? [],
            models_by_provider: data.models_by_provider ?? {},
            chat_models: data.chat_models ?? [],
            embedding_models: data.embedding_models ?? [],
            vision_models: data.vision_models ?? [],
            reranker_models: data.reranker_models ?? [],
            audio_models: data.audio_models ?? [],
            video_models: data.video_models ?? [],
          };
          const cc = data.current_config ?? {};
          set((state) => {
            const models = mergeWithDefaultModels(state.config.models).map((m) => {
              const binding = TASK_MODEL_BINDINGS[m.id as TaskBoundModelId];
              if (!binding) return m;
              const current = cc[binding.taskKey];
              const nextModel = current
                ? { ...m, model: current.model, provider: current.provider }
                : m;
              return normalizeTaskBoundModel(nextModel, availableModels);
            });
            return {
              config: { ...state.config, models },
              availableModels,
              error: null,
              isLoading: false,
              hasUnsavedChanges: false,
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