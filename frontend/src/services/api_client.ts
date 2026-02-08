import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

class ApiClient {
  private instance: AxiosInstance;

  getBaseURL(): string {
    return this.instance.defaults.baseURL || 'http://localhost:8000/api';
  }

  constructor() {
    this.instance = axios.create({
      baseURL: import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000/api',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器
    this.instance.interceptors.request.use(
      (config) => {
        // 添加认证token（如果需要）
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        
        console.log(`🚀 API请求: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ 请求错误:', error);
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.instance.interceptors.response.use(
      (response) => {
        console.log(`✅ API响应: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
        return response;
      },
      (error) => {
        console.error('❌ 响应错误:', error.response?.data || error.message);
        
        // 处理常见错误
        if (error.response?.status === 401) {
          // 未授权，清除token并跳转到登录页
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        } else if (error.response?.status >= 500) {
          // 服务器错误
          console.error('服务器错误:', error.response.data);
        }
        
        return Promise.reject(error);
      }
    );
  }

  // GET请求
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.get(url, config);
    return response.data;
  }

  // POST请求
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.post(url, data, config);
    return response.data;
  }

  // PUT请求
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.put(url, data, config);
    return response.data;
  }

  // DELETE请求
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.delete(url, config);
    return response.data;
  }

  // PATCH请求
  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.patch(url, data, config);
    return response.data;
  }

  // 文件上传（支持额外 FormData 字段）
  async uploadFile<T = any>(
    url: string,
    file: File,
    onProgress?: (progress: number) => void,
    extraFields?: Record<string, string>
  ): Promise<T> {
    const formData = new FormData();
    if (extraFields) {
      Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));
    }
    formData.append('file', file);

    const response: AxiosResponse<T> = await this.instance.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });

    return response.data;
  }

  // 多文件上传（支持额外 FormData 字段）
  async uploadFiles<T = any>(
    url: string,
    files: File[],
    onProgress?: (progress: number, fileIndex: number) => void,
    extraFields?: Record<string, string>
  ): Promise<T> {
    const formData = new FormData();
    if (extraFields) {
      Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));
    }
    files.forEach((file) => {
      formData.append('files', file);
    });

    const response: AxiosResponse<T> = await this.instance.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress, 0);
        }
      },
    });

    return response.data;
  }
}

// 创建单例实例
export const apiClient = new ApiClient();

// 知识库相关API
export const knowledgeApi = {
  // 获取知识库列表
  getKnowledgeBases: () => apiClient.get('/knowledge/'),
  
  // 创建知识库
  createKnowledgeBase: (data: {
    name: string;
    description: string;
    tags?: string[];
  }) => apiClient.post('/knowledge/', data),
  
  // 更新知识库
  updateKnowledgeBase: (id: string, data: {
    name?: string;
    description?: string;
    tags?: string[];
  }) => apiClient.put(`/knowledge/${id}`, data),
  
  // 删除知识库
  deleteKnowledgeBase: (id: string) => apiClient.delete(`/knowledge/${id}`),
  
  // 获取知识库详情
  getKnowledgeBase: (id: string) => apiClient.get(`/knowledge/${id}`),

  // 获取知识库向量统计（用于数据源比例、主题统计、向量维度）
  getKnowledgeBaseStats: (id: string) =>
    apiClient.get<{
      documents: number
      chunks: number
      images: number
      text_vector_dim?: number
      image_vector_dim?: number
    }>(`/knowledge/${id}/stats`),
  
  // 获取知识库画像
  getKnowledgeBasePortrait: (id: string) => apiClient.get(`/knowledge/${id}/portrait`),

  // 触发知识库画像生成/更新（超时 120s，因同步生成可能较慢）
  regenerateKnowledgeBasePortrait: (id: string) =>
    apiClient.post<{ status: string; message: string; clusters?: number }>(
      `/knowledge/${id}/portrait/regenerate`,
      undefined,
      { timeout: 120000 }
    ),

  // 获取知识库文件列表
  getKnowledgeBaseFiles: (id: string) =>
    apiClient.get<{ files: Array<{ id: string; name: string; size: number; date: string; type: string; preview_url?: string; text_preview?: string }> }>(`/knowledge/${id}/files`),

  // 删除知识库中的文件
  deleteKnowledgeBaseFile: (kbId: string, fileId: string) =>
    apiClient.delete(`/knowledge/${kbId}/files/${encodeURIComponent(fileId)}`),

  // 获取文本文件原始内容（md/txt，用于预览避免下载）
  getFileTextContent: (kbId: string, fileId: string) =>
    apiClient.get<{ content: string }>(`/knowledge/${kbId}/files/${encodeURIComponent(fileId)}/content`),

  // 获取文件预览详情（caption、chunks、text_preview）
  getFilePreviewDetails: (kbId: string, fileId: string) =>
    apiClient.get<{ caption?: string; chunks?: Array<{ index: number; text: string }>; text_preview?: string }>(
      `/knowledge/${kbId}/files/${encodeURIComponent(fileId)}/preview`
    ),
  
  // 上传文件到知识库（调用 /upload/batch）
  uploadFiles: (kbId: string, files: File[], onProgress?: (progress: number, fileIndex: number) => void) =>
    apiClient.uploadFiles(`/upload/batch`, files, onProgress, { kb_id: kbId }),

  // 上传单个文件（用于精细进度）
  uploadSingleFile: (
    kbId: string,
    file: File,
    fileType: string,
    onProgress?: (progress: number) => void
  ) => apiClient.uploadFile(`/upload/file`, file, onProgress, { kb_id: kbId, file_type: fileType }),
};

// 知识库导入 API（从 URL 或按关键词搜索图片导入）
export const importApi = {
  /** 从单个 URL 下载并导入知识库 */
  importFromUrl: (body: { url: string; kb_id: string; filename?: string }) =>
    apiClient.post<{
      file_id: string
      kb_id: string
      filename: string
      status: string
      processing_id?: string
      message: string
      details?: { chunks_processed?: number; vectors_stored?: number; caption?: string }
    }>(`/import/url`, body),

  /** 按关键词从选定渠道搜索图片并导入知识库（一次性返回） */
  importFromSearch: (body: {
    kb_id: string
    query: string
    source: 'google_images' | 'pixabay' | 'internet_archive'
    quantity?: number
    pixabay_image_type?: string
    pixabay_order?: string
    archive_sort?: string
    randomize?: boolean
  }) =>
    apiClient.post<{
      kb_id: string
      total: number
      success_count: number
      failed_count: number
      results: Array<{
        file_id?: string
        filename: string
        status: string
        processing_id?: string
        error?: string
      }>
      message: string
    }>(`/import/search`, body, { timeout: 120000 }),

  /** 按关键词搜索图片并导入知识库（SSE 流式进度） */
  importFromSearchStream: (
    params: {
      kb_id: string
      query: string
      source: 'google_images' | 'pixabay' | 'internet_archive'
      quantity?: number
      pixabay_image_type?: string
      pixabay_order?: string
      archive_sort?: string
      randomize?: boolean
    },
    onProgress: (event: {
      stage: string
      current?: number
      total?: number
      message?: string
      success_count?: number
      failed_count?: number
    }) => void
  ) => {
    const base = apiClient.getBaseURL()
    const q = new URLSearchParams()
    q.set('kb_id', params.kb_id)
    q.set('query', params.query)
    q.set('source', params.source)
    q.set('quantity', String(params.quantity ?? 5))
    if (params.pixabay_image_type) q.set('pixabay_image_type', params.pixabay_image_type)
    if (params.pixabay_order) q.set('pixabay_order', params.pixabay_order)
    if (params.archive_sort) q.set('archive_sort', params.archive_sort)
    if (params.randomize !== undefined) q.set('randomize', String(params.randomize))
    const url = `${base}/import/search/stream?${q.toString()}`
    return fetch(url, { method: 'GET' }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any)?.detail ?? res.statusText)
      }
      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as {
                stage: string
                current?: number
                total?: number
                message?: string
                success_count?: number
                failed_count?: number
              }
              onProgress(data)
            } catch (_) {}
          }
        }
      }
      if (buf.startsWith('data: ')) {
        try {
          const data = JSON.parse(buf.slice(6))
          onProgress(data)
        } catch (_) {}
      }
    })
  },
};

// 对话相关API
export const chatApi = {
  // 发送消息
  sendMessage: (data: {
    message: string;
    knowledgeBaseIds?: string[];
    stream?: boolean;
  }) => apiClient.post('/chat/message', data),
  
  // 流式对话
  sendMessageStream: (
    data: {
      message: string;
      knowledgeBaseIds?: string[];
    },
    onMessage: (chunk: string) => void,
    onComplete: () => void,
    onError: (error: any) => void
  ) => {
    const eventSource = new EventSource(
      `${apiClient.getBaseURL()}/chat/stream?` + 
      new URLSearchParams({
        message: data.message,
        knowledgeBaseIds: data.knowledgeBaseIds?.join(',') || '',
      })
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message') {
          onMessage(data.content);
        }
      } catch (error) {
        console.error('解析SSE数据失败:', error);
      }
    };

    eventSource.onerror = (error) => {
      onError(error);
      eventSource.close();
    };

    eventSource.addEventListener('complete', () => {
      onComplete();
      eventSource.close();
    });

    return eventSource;
  },
  
  // 获取对话历史
  getChatHistory: (sessionId?: string) => 
    apiClient.get('/chat/history', { params: { sessionId } }),
  
  // 创建新会话
  createSession: (data: {
    title?: string;
    knowledgeBaseIds?: string[];
  }) => apiClient.post('/chat/session', data),
};

// 调试相关API（对接 /api/debug）
export const debugApi = {
  // 获取系统统计信息
  getStats: () => apiClient.get('/debug/stats'),
  // 获取检索调试详情（需 query_id）
  getRetrievalDebug: (queryId: string) =>
    apiClient.get(`/debug/retrieval-debug/${encodeURIComponent(queryId)}`),
  // 获取组件健康状态
  getComponentHealth: () => apiClient.get('/debug/health/components'),
};

// 系统相关API（模型配置来自 /api/chat/models）
export const systemApi = {
  // 获取系统状态（使用 debug/stats）
  getSystemStatus: () => apiClient.get('/debug/stats'),
  // 获取模型配置（来自 chat/models）
  getModelConfig: () => apiClient.get('/chat/models'),
  // 更新模型配置（后端暂无写入接口，仅本地持久化）
  updateModelConfig: async (config: any) => {
    console.warn('模型配置写入接口暂未实现，配置仅保存于本地');
    return config;
  },
  // 获取系统指标
  getMetrics: () => apiClient.get('/debug/stats'),
};

export default apiClient;