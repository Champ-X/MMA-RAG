import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type { ChatScopeFile } from '@/store/useChatStore'

/** 未设置 VITE_API_BASE_URL 时默认 /api：开发时由 Vite 代理到后端，避免浏览器直连 localhost:8000（WSL/端口转发下易失败或超时）；生产需同源反代或显式配置环境变量。 */
function resolveDefaultApiBaseURL(): string {
  const fromEnv = import.meta.env?.VITE_API_BASE_URL;
  if (fromEnv != null && String(fromEnv).trim() !== '') {
    return String(fromEnv).replace(/\/$/, '');
  }
  return '/api';
}

class ApiClient {
  private instance: AxiosInstance;
  private inFlightGetRequests = new Map<string, Promise<any>>();
  private inFlightBlobRequests = new Map<string, Promise<Blob>>();

  private buildRequestKey(url: string, config?: AxiosRequestConfig): string {
    const base = this.getBaseURL();
    const params = config?.params ? JSON.stringify(config.params) : '';
    const timeout = config?.timeout ?? '';
    return `${base}|${url}|params:${params}|timeout:${timeout}`;
  }

  getBaseURL(): string {
    return this.instance.defaults.baseURL || resolveDefaultApiBaseURL();
  }

  constructor() {
    this.instance = axios.create({
      baseURL: resolveDefaultApiBaseURL(),
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
    const key = this.buildRequestKey(url, config);
    const inFlight = this.inFlightGetRequests.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const request = this.instance.get<T>(url, config)
      .then((response: AxiosResponse<T>) => response.data)
      .finally(() => {
        this.inFlightGetRequests.delete(key);
      });

    this.inFlightGetRequests.set(key, request);
    return request;
  }

  // GET 请求返回 Blob（用于 PDF 等流式预览）
  async getBlob(url: string, config?: AxiosRequestConfig): Promise<Blob> {
    const key = this.buildRequestKey(url, config);
    const inFlight = this.inFlightBlobRequests.get(key);
    if (inFlight) return inFlight;

    const request = (async () => {
    try {
      const response = await this.instance.get(url, { ...config, responseType: 'blob' });
      return response.data as Blob;
    } catch (error: any) {
      const data = error?.response?.data;
      if (data instanceof Blob) {
        try {
          const text = await data.text();
          let detail = text;
          try {
            const json = JSON.parse(text);
            if (json?.detail) {
              detail = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail);
            }
          } catch {
            // ignore non-json body
          }
          throw new Error(detail || error?.message || '文件预览失败');
        } catch {
          throw new Error(error?.message || '文件预览失败');
        }
      }
      throw error;
    }
    })().finally(() => {
      this.inFlightBlobRequests.delete(key);
    });

    this.inFlightBlobRequests.set(key, request);
    return request;
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

  /**
   * 流式单文件上传：POST 后响应为 NDJSON 流，先收到 processing_id，再持续收到 stage/message/progress，最后收到 result。
   * 用于在「开始 CLIP / 文本向量化」时实时更新前端进度。
   */
  async uploadFileStream<T = any>(
    url: string,
    file: File,
    extraFields: Record<string, string>,
    onStatus?: (status: {
      processing_id?: string
      stage?: string
      message?: string
      progress?: number
      status?: string
      result?: T
    }) => void
  ): Promise<T> {
    const formData = new FormData();
    Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));
    formData.append('file', file);

    const baseURL = this.getBaseURL();
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${baseURL}${url}`, {
      method: 'POST',
      body: formData,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      let detail = text;
      try {
        const j = JSON.parse(text);
        if (j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
      } catch {
        // ignore
      }
      throw new Error(detail || `上传失败: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let result: T | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue; // skip malformed line
        }
        if (obj.status === 'failed') {
          throw new Error(String(obj.error ?? obj.message ?? '处理失败'));
        }
          if (obj.result !== undefined) {
            result = obj.result as T;
          }
        if (onStatus) onStatus(obj as Parameters<NonNullable<typeof onStatus>>[0]);
      }
    }
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer.trim()) as Record<string, unknown>;
        if (obj.result !== undefined) result = obj.result as T;
        if (onStatus) onStatus(obj as Parameters<NonNullable<typeof onStatus>>[0]);
      } catch {
        // skip
      }
    }

    if (result !== null) return result;
    throw new Error('流式上传未返回 result');
  }
}

// 创建单例实例
export const apiClient = new ApiClient();

// 知识库相关API
export const knowledgeApi = {
  // 获取知识库列表（多库+封面可能较慢，单独放宽超时）
  getKnowledgeBases: () => apiClient.get('/knowledge/', { timeout: 120000 }),
  
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
      audio?: number
      video?: number
      text_vector_dim?: number
      image_vector_dim?: number
      audio_vector_dim?: number
    }>(`/knowledge/${id}/stats`),
  
  // 获取知识库画像
  getKnowledgeBasePortrait: (id: string) => apiClient.get(`/knowledge/${id}/portrait`),

  // 触发知识库画像生成/更新（sync=true 在 API 内同步执行，保证含视频关键帧等最新逻辑；超时 120s）
  regenerateKnowledgeBasePortrait: (id: string, sync = true) =>
    apiClient.post<{ status: string; message: string; clusters?: number }>(
      `/knowledge/${id}/portrait/regenerate`,
      undefined,
      { params: { sync }, timeout: 120000 }
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

  // 获取文件预览详情（caption、chunks、text_preview；音频含 transcript、description）
  getFilePreviewDetails: (kbId: string, fileId: string, options?: { timeoutMs?: number }) =>
    apiClient.get<{
      caption?: string
      chunks?: Array<{ index: number; text: string }>
      text_preview?: string
      transcript?: string
      description?: string
    }>(
      `/knowledge/${kbId}/files/${encodeURIComponent(fileId)}/preview`,
      options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
    ),

  // 获取文件流（用于页面内 PDF/Office 预览，返回 Blob）
  getFileStream: (kbId: string, fileId: string, options?: { timeoutMs?: number }) =>
    apiClient.getBlob(
      `/knowledge/${kbId}/files/${encodeURIComponent(fileId)}/stream`,
      options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
    ),

  /** Markdown 预览中本地路径图片的 API URL（path 为 md 中的 src，如 /Users/.../image.png） */
  getFilePreviewAssetUrl: (kbId: string, fileId: string, path: string) =>
    `${apiClient.getBaseURL()}/knowledge/${encodeURIComponent(kbId)}/files/${encodeURIComponent(fileId)}/preview-asset?path=${encodeURIComponent(path)}`,

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

  /**
   * 流式单文件上传：响应为 NDJSON 流，可实时收到 stage/message/progress（含 CLIP、文本向量化阶段）。
   * 返回与 uploadSingleFile 一致的 result 结构。
   */
  uploadSingleFileStream: (
    kbId: string,
    file: File,
    fileType: string,
    onStatus?: (status: {
      processing_id?: string
      stage?: string
      message?: string
      progress?: number
      status?: string
      result?: {
        file_id?: string
        kb_id?: string
        filename?: string
        status?: string
        processing_id?: string
        message?: string
        details?: { chunks_processed?: number; vectors_stored?: number; caption?: string }
      }
    }) => void
  ) =>
    apiClient.uploadFileStream(`/upload/file/stream`, file, { kb_id: kbId, file_type: fileType }, onStatus),

  /** 获取上传/导入任务进度（用于 URL 导入轮询） */
  getUploadProgress: (taskId: string) =>
    apiClient.get<{
      processing_id: string
      status: string
      stage?: string
      progress?: number
      message?: string
      result?: { file_id?: string }
      error?: string
    }>(`/upload/progress/${taskId}`),
};

// 知识库导入 API（从 URL 或按关键词搜索图片导入）
export const importApi = {
  /** 轻量识别 URL：判断更像网页还是文件，并返回标题/站点/建议文件名等预览信息。 */
  inspectUrl: (body: {
    url: string
    mode?: 'auto' | 'webpage' | 'file'
  }) =>
    apiClient.post<{
      original_url: string
      final_url: string
      kind: 'webpage' | 'file'
      detected_kind: 'webpage' | 'file'
      recommended_mode: 'auto' | 'webpage' | 'file'
      suggested_filename: string
      content_type?: string | null
      content_length?: number | null
      title?: string | null
      site?: string | null
      warning?: string | null
    }>(`/import/url/inspect`, body, { timeout: 15000 }),

  /**
   * 从 URL 开始导入：先下载（HTML 页面会抽取正文为 Markdown），再后台处理，立即返回 202 + processing_id。
   * - mode=auto（默认）按 Content-Type 自动识别；webpage 强制网页解析；file 强制按文件下载。
   * - include_links / include_images 仅对网页解析生效，控制是否保留正文中的超链接与图片引用。
   * - download_images 为 true（默认）时，会带 Referer/UA 并发下载页面内图片到 KB，走多模态 VLM/CLIP 流水线。
   */
  importFromUrlStart: (body: {
    url: string
    kb_id: string
    filename?: string
    mode?: 'auto' | 'webpage' | 'file'
    include_links?: boolean
    include_images?: boolean
    download_images?: boolean
    image_max_count?: number
    image_max_bytes?: number
  }) =>
    apiClient.post<{
      processing_id: string
      kb_id: string
      filename: string
      message: string
      /** 网页解析时返回，标识使用的抽取器（trafilatura/readability/tavily/raw_html）；文件下载时为 null */
      extractor?: string | null
      /** 网页解析得到的标题；文件下载时为 null */
      title?: string | null
      /** 实际拉取的 URL（302 后可能不同于入参） */
      source_url?: string | null
      /** 'webpage' | 'file'，方便前端展示来源类型 */
      kind?: 'webpage' | 'file'
      /** 网页解析成功下载的图片数量；未启用图片下载时为 0 */
      image_count?: number
    }>(`/import/url/start`, body, { timeout: 60000, validateStatus: (s) => s === 202 || (s >= 200 && s < 300) }),

  /** 从单个 URL 下载并同步导入知识库（保留兼容，推荐用 importFromUrlStart + 轮询进度） */
  importFromUrl: (body: {
    url: string
    kb_id: string
    filename?: string
    mode?: 'auto' | 'webpage' | 'file'
    include_links?: boolean
    include_images?: boolean
    download_images?: boolean
    image_max_count?: number
    image_max_bytes?: number
  }) =>
    apiClient.post<{
      file_id: string
      kb_id: string
      filename: string
      status: string
      processing_id?: string
      message: string
      details?: {
        chunks_processed?: number
        vectors_stored?: number
        caption?: string
        extractor?: string | null
        title?: string | null
        site?: string | null
        author?: string | null
        published?: string | null
        source_url?: string | null
        kind?: 'webpage' | 'file'
        image_count?: number
      }
    }>(`/import/url`, body, { timeout: 180000 }),

  /** 热点/新闻导入（异步）：立即返回 202 + processing_id，后台拉取→整理→入库，前端轮询进度 */
  importHotTopicsStart: (body: {
    kb_id: string
    query?: string
    topic?: 'general' | 'news' | 'finance'
    time_range?: 'day' | 'week' | 'month' | 'year'
    max_results?: number
    use_llm_summary?: boolean
  }) =>
    apiClient.post<{
      processing_id: string
      kb_id: string
      filename: string
      message: string
    }>(`/import/hot-topics/start`, body, { timeout: 15000, validateStatus: (s) => s === 202 }),

  /** 热点/新闻导入（同步）：Tavily 拉取后整理成 Markdown 导入知识库，可选参数不传用后端默认 */
  importHotTopics: (body: {
    kb_id: string
    query?: string
    topic?: 'general' | 'news' | 'finance'
    time_range?: 'day' | 'week' | 'month' | 'year'
    max_results?: number
    use_llm_summary?: boolean
  }) =>
    apiClient.post<{
      file_id: string | null
      kb_id: string
      status: string
      processing_id?: string
      message: string
      details?: { chunks_processed?: number; vectors_stored?: number }
    }>(`/import/hot-topics`, body, { timeout: 600000 }),

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

  /** 从指定本地文件夹导入知识库（路径须在服务端白名单内） */
  importFromFolder: (body: {
    folder_path: string
    kb_id: string
    recursive?: boolean
    extensions?: string[]
    exclude_patterns?: string[]
    max_files?: number
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
    }>(`/import/folder`, body, { timeout: 300000 }),

  /** 从指定本地文件夹导入知识库（SSE 流式进度：scanning -> importing -> done） */
  importFromFolderStream: (
    params: {
      folder_path: string
      kb_id: string
      recursive?: boolean
      extensions?: string[]
      exclude_patterns?: string[]
      max_files?: number
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
    q.set('folder_path', params.folder_path)
    q.set('kb_id', params.kb_id)
    q.set('recursive', String(params.recursive !== false))
    if (params.max_files != null) q.set('max_files', String(params.max_files))
    if (params.extensions?.length) q.set('extensions', params.extensions.join(','))
    if (params.exclude_patterns?.length) q.set('exclude_patterns', params.exclude_patterns.join(','))
    const url = `${base}/import/folder/stream?${q.toString()}`
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
function serializeSelectedFiles(selectedFiles?: ChatScopeFile[]) {
  if (!selectedFiles?.length) return undefined
  return selectedFiles.map((file) => ({
    kb_id: file.kbId,
    file_id: file.fileId,
    name: file.name,
    ...(file.type ? { type: file.type } : {}),
    ...(file.kbName ? { kb_name: file.kbName } : {}),
  }))
}

export const chatApi = {
  // 发送消息
  sendMessage: (data: {
    message: string;
    knowledgeBaseIds?: string[];
    selectedFiles?: ChatScopeFile[];
    stream?: boolean;
  }) => apiClient.post('/chat/message', {
    ...data,
    ...(data.selectedFiles ? { selectedFiles: serializeSelectedFiles(data.selectedFiles) } : {}),
  }),
  
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

  // 按需获取引用音频播放地址（用于「点击播放」或 URL 过期后刷新）
  getReferenceAudioUrl: (params: { kb_id?: string; file_path: string }) =>
    apiClient.post<{ audio_url: string }>('/chat/reference-audio-url', params),
  // 按需获取引用视频播放地址（用于「点击播放」或 URL 过期后刷新）
  getReferenceVideoUrl: (params: { kb_id?: string; file_path: string }) =>
    apiClient.post<{ video_url: string }>('/chat/reference-video-url', params),
  // 按需获取引用图片预览地址（用于 URL 过期后刷新）
  getReferenceImageUrl: (params: { kb_id?: string; file_path: string }) =>
    apiClient.post<{ img_url: string }>('/chat/reference-image-url', params),
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
  /** OpenRouter 公开模型目录（后端代理 + 缓存，供对话模型搜索） */
  getOpenRouterModels: () =>
    apiClient.get('/chat/openrouter-models', { timeout: 120000 }),
  // 更新模型配置（运行时立即生效，后端会持久化任务主模型覆盖）
  updateModelConfig: (config: any) => apiClient.put('/chat/models', config),
  // 获取系统指标
  getMetrics: () => apiClient.get('/debug/stats'),
};

export default apiClient;