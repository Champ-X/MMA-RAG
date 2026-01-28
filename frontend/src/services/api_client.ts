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

  // 文件上传
  async uploadFile<T = any>(
    url: string, 
    file: File, 
    onProgress?: (progress: number) => void
  ): Promise<T> {
    const formData = new FormData();
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

  // 多文件上传
  async uploadFiles<T = any>(
    url: string,
    files: File[],
    onProgress?: (progress: number, fileIndex: number) => void
  ): Promise<T> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append(`files`, file);
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
  
  // 获取知识库画像
  getKnowledgeBasePortrait: (id: string) => apiClient.get(`/knowledge/${id}/portrait`),
  
  // 上传文件到知识库
  uploadFiles: (kbId: string, files: File[], onProgress?: (progress: number, fileIndex: number) => void) =>
    apiClient.uploadFiles(`/knowledge/${kbId}/upload`, files, onProgress),
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

// 调试相关API
export const debugApi = {
  // 获取调试信息
  getDebugInfo: (query: string, knowledgeBaseIds?: string[]) =>
    apiClient.get('/debug/info', {
      params: {
        query,
        knowledgeBaseIds: knowledgeBaseIds?.join(','),
      },
    }),
  
  // 获取检索详情
  getRetrievalDetails: (query: string, knowledgeBaseIds?: string[]) =>
    apiClient.get('/debug/retrieval', {
      params: {
        query,
        knowledgeBaseIds: knowledgeBaseIds?.join(','),
      },
    }),
};

// 系统相关API
export const systemApi = {
  // 获取系统状态
  getSystemStatus: () => apiClient.get('/system/status'),
  
  // 获取模型配置
  getModelConfig: () => apiClient.get('/system/models'),
  
  // 更新模型配置
  updateModelConfig: (config: any) => apiClient.put('/system/models', config),
  
  // 获取系统指标
  getMetrics: () => apiClient.get('/system/metrics'),
};

export default apiClient;