import { create } from 'zustand'
import { knowledgeApi } from '@/services/api_client'

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  tags?: string[]
  created_at?: string
  updated_at?: string
  stats?: {
    documents: number
    chunks: number
    images: number
  }
}

interface KnowledgeStore {
  // 状态
  knowledgeBases: KnowledgeBase[]
  loading: boolean
  error: string | null
  selectedKB: KnowledgeBase | null

  // 操作
  fetchKnowledgeBases: () => Promise<void>
  createKnowledgeBase: (data: { name: string; description: string; tags?: string[] }) => Promise<void>
  updateKnowledgeBase: (id: string, data: Partial<KnowledgeBase>) => Promise<void>
  deleteKnowledgeBase: (id: string) => Promise<void>
  selectKnowledgeBase: (kb: KnowledgeBase | null) => void
  getKnowledgeBase: (id: string) => KnowledgeBase | undefined
}

export const useKnowledgeStore = create<KnowledgeStore>((set, get) => ({
  // 初始状态
  knowledgeBases: [],
  loading: false,
  error: null,
  selectedKB: null,

  // 获取知识库列表
  fetchKnowledgeBases: async () => {
    set({ loading: true, error: null })
    try {
      const data = await knowledgeApi.getKnowledgeBases()
      set({ knowledgeBases: data.knowledge_bases || [], loading: false })
    } catch (error: any) {
      set({ 
        error: error.message || '获取知识库列表失败', 
        loading: false 
      })
    }
  },

  // 创建知识库
  createKnowledgeBase: async (data) => {
    set({ loading: true, error: null })
    try {
      const newKB = await knowledgeApi.createKnowledgeBase(data)
      set((state) => ({
        knowledgeBases: [...state.knowledgeBases, newKB],
        loading: false
      }))
    } catch (error: any) {
      set({ 
        error: error.message || '创建知识库失败', 
        loading: false 
      })
      throw error
    }
  },

  // 更新知识库
  updateKnowledgeBase: async (id, data) => {
    set({ loading: true, error: null })
    try {
      const updatedKB = await knowledgeApi.updateKnowledgeBase(id, data)
      set((state) => ({
        knowledgeBases: state.knowledgeBases.map((kb) =>
          kb.id === id ? { ...kb, ...updatedKB } : kb
        ),
        loading: false
      }))
    } catch (error: any) {
      set({ 
        error: error.message || '更新知识库失败', 
        loading: false 
      })
      throw error
    }
  },

  // 删除知识库
  deleteKnowledgeBase: async (id) => {
    set({ loading: true, error: null })
    try {
      await knowledgeApi.deleteKnowledgeBase(id)
      set((state) => ({
        knowledgeBases: state.knowledgeBases.filter((kb) => kb.id !== id),
        selectedKB: state.selectedKB?.id === id ? null : state.selectedKB,
        loading: false
      }))
    } catch (error: any) {
      set({ 
        error: error.message || '删除知识库失败', 
        loading: false 
      })
      throw error
    }
  },

  // 选择知识库
  selectKnowledgeBase: (kb) => {
    set({ selectedKB: kb })
  },

  // 获取知识库
  getKnowledgeBase: (id) => {
    return get().knowledgeBases.find((kb) => kb.id === id)
  },
}))
