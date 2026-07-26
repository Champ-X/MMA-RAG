"""
应用核心配置模块
使用 Pydantic 进行配置管理和验证
"""

from typing import Optional, List, Dict, Any, Union
from pydantic import Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from loguru import logger
import os
import re
from pathlib import Path

# 仅从 backend 目录加载 .env（不使用项目根 .env）
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"

# 仅使用 backend/.env（不使用项目根 .env）；文件不存在时依赖进程环境变量
_settings_config_dict: dict = {
    "env_file_encoding": "utf-8",
    "extra": "ignore",
}
if _ENV_FILE.exists():
    _settings_config_dict["env_file"] = str(_ENV_FILE)


class Settings(BaseSettings):
    """应用设置类"""
    
    model_config = SettingsConfigDict(**_settings_config_dict)  # type: ignore[assignment]
    
    # 应用基本信息
    app_name: str = Field(default="Tessmora", validation_alias="APP_NAME")
    app_version: str = Field(default="1.0.0", validation_alias="APP_VERSION")
    debug: bool = Field(default=False, validation_alias="API_DEBUG")
    # 评测实例安全标记。只有显式开启的隔离实例才允许 rag-eval 自动创建 KB/上传语料。
    evaluation_mode: bool = Field(default=False, validation_alias="EVALUATION_MODE")
    
    # 服务器配置
    host: str = Field(default="0.0.0.0", validation_alias="API_HOST")
    port: int = Field(default=8000, validation_alias="API_PORT")
    
    # 安全配置
    secret_key: str = Field(default="your-super-secret-key", validation_alias="SECRET_KEY")
    algorithm: str = Field(default="HS256", validation_alias="ALGORITHM")
    access_token_expire_minutes: int = Field(default=30, validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    
    # 数据库配置
    database_url: str = Field(default="sqlite:///./app.db", validation_alias="DATABASE_URL")
    
    # MinIO 配置（本地 MinIO 默认账号为 minioadmin/minioadmin）
    minio_endpoint: str = Field(default="localhost:9000", validation_alias="MINIO_ENDPOINT")
    minio_access_key: str = Field(default="minioadmin", validation_alias="MINIO_ACCESS_KEY")
    minio_secret_key: str = Field(default="minioadmin", validation_alias="MINIO_SECRET_KEY")
    minio_secure: bool = Field(default=False, validation_alias="MINIO_SECURE")
    minio_region: str = Field(default="us-east-1", validation_alias="MINIO_REGION")
    # 浏览器可访问的 MinIO 地址（host:port，无协议）。Docker 内 MINIO_ENDPOINT 常为 minio:9000，预签名 URL 必须指向宿主机映射端口（如 localhost:9000）前端才能加载图片/音视频。
    minio_public_endpoint: Optional[str] = Field(default=None, validation_alias="MINIO_PUBLIC_ENDPOINT")
    minio_public_secure: Optional[bool] = Field(default=None, validation_alias="MINIO_PUBLIC_SECURE")
    
    @field_validator("minio_public_endpoint", mode="before")
    @classmethod
    def normalize_minio_public_endpoint(cls, v: Union[str, None]) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        low = s.lower()
        for p in ("https://", "http://"):
            if low.startswith(p):
                s = s[len(p) :]
                low = s.lower()
        s = s.split("/")[0].strip()
        return s or None

    # Qdrant 配置
    qdrant_host: str = Field(default="localhost", validation_alias="QDRANT_HOST")
    qdrant_port: int = Field(default=6333, validation_alias="QDRANT_PORT")
    qdrant_api_key: Optional[str] = Field(default=None, validation_alias="QDRANT_API_KEY")
    
    # Redis 配置
    redis_url: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")
    
    # SiliconFlow API 配置
    siliconflow_api_key: str = Field(..., validation_alias="SILICONFLOW_API_KEY")  # type: ignore[arg-type]
    
    # DeepSeek API 配置（可选；模型 id 以官方 /v1/models 为准，注册表形式为 deepseek:<id>，兼容旧配置 deepseek-chat）
    deepseek_api_key: Optional[str] = Field(default=None, validation_alias="DEEPSEEK_API_KEY")
    
    # OpenRouter API 配置（可选，配置后可使用 OpenRouter 提供的模型）
    openrouter_api_key: Optional[str] = Field(default=None, validation_alias="OPENROUTER_API_KEY")
    
    # 阿里云百炼 API 配置（可选，配置后可使用阿里云百炼提供的模型）
    aliyun_bailian_api_key: Optional[str] = Field(default=None, validation_alias="ALIYUN_BAILIAN_API_KEY")
    
    # PaddleOCR API 配置（PDF 解析备选）
    paddleocr_api_url: Optional[str] = Field(default=None, validation_alias="PADDLEOCR_API_URL")
    paddleocr_token: Optional[str] = Field(default=None, validation_alias="PADDLEOCR_TOKEN")
    # VLM 预处理图像像素上限，部分 API 支持，值越大图像越清晰、显存/耗时越高（仅当服务端支持时生效）
    paddleocr_max_pixels: Optional[int] = Field(default=None, validation_alias="PADDLEOCR_MAX_PIXELS")

    # MinerU PDF 解析：优先 API（需 MINERU_TOKEN），失败则本地模型
    mineru_token: Optional[str] = Field(default=None, validation_alias="MINERU_TOKEN")
    mineru_pdf_enabled: bool = Field(default=True, validation_alias="MINERU_PDF_ENABLED")
    # 本地 MinerU 渲染 PDF 页面的 DPI，越高图片越清晰（默认 300，原 200）
    mineru_pdf_render_dpi: int = Field(default=300, validation_alias="MINERU_PDF_RENDER_DPI")
    # LibreOffice 可执行路径（可选）。用于 docx/pptx 转 PDF（解析与预览）。未设置时自动探测：PATH 中的 libreoffice/soffice，或 macOS /Applications/LibreOffice.app
    libreoffice_path: Optional[str] = Field(default=None, validation_alias="LIBREOFFICE_PATH")

    # 文件上传配置
    max_file_size: int = Field(default=100 * 1024 * 1024, validation_alias="MAX_FILE_SIZE")  # 100MB
    allowed_extensions_str: str = Field(
        default="pdf,docx,doc,pptx,txt,md,xlsx,xls,csv,jpg,jpeg,png,gif,webp,tiff,tif",
        validation_alias="ALLOWED_EXTENSIONS"
    )

    # Excel/CSV 分块配置
    # 行块 chunk 的最大字符数：用于「带表头 Markdown 行块」按字符预算切分；与文档分块的 max_chunk_size 对齐
    excel_row_chunk_max_chars: int = Field(default=900, validation_alias="EXCEL_ROW_CHUNK_MAX_CHARS")
    # 是否为每个 sheet 调用 LLM 生成 1-2 句摘要；关闭可节省 token，sheet_summary chunk 仍会写入但摘要为空
    excel_sheet_llm_summary_enabled: bool = Field(default=True, validation_alias="EXCEL_SHEET_LLM_SUMMARY_ENABLED")

    # Agentic 文档分块：模型仅规划不可变原子单元的范围，服务端负责无损物化。
    # 600 是安全上限而非目标大小；实际切点优先服从语义与结构边界。
    document_chunking_hard_max_tokens: int = Field(
        default=600,
        validation_alias="DOCUMENT_CHUNKING_HARD_MAX_TOKENS",
    )
    document_chunking_agent_max_input_tokens: int = Field(
        default=24_000,
        validation_alias="DOCUMENT_CHUNKING_AGENT_MAX_INPUT_TOKENS",
    )
    document_chunking_agent_max_output_tokens: int = Field(
        default=4_000,
        validation_alias="DOCUMENT_CHUNKING_AGENT_MAX_OUTPUT_TOKENS",
    )
    document_chunking_agent_timeout_seconds: int = Field(
        default=180,
        validation_alias="DOCUMENT_CHUNKING_AGENT_TIMEOUT_SECONDS",
    )
    document_chunking_model: Optional[str] = Field(
        default=None,
        validation_alias="DOCUMENT_CHUNKING_MODEL",
    )

    # 文件夹导入：允许的根路径白名单（逗号分隔），未配置则禁用文件夹导入
    import_folder_allowed_base_paths: List[str] = Field(
        default_factory=list,
        validation_alias="IMPORT_FOLDER_ALLOWED_BASE_PATHS",
    )

    # Markdown 链接图片：是否下载 http(s) 图片，超时(秒)，单图最大字节数（默认 5MB）
    markdown_fetch_image_urls: bool = Field(default=True, validation_alias="MARKDOWN_FETCH_IMAGE_URLS")
    markdown_image_url_timeout: int = Field(default=10, validation_alias="MARKDOWN_IMAGE_URL_TIMEOUT")
    markdown_image_url_max_size: int = Field(default=5 * 1024 * 1024, validation_alias="MARKDOWN_IMAGE_URL_MAX_SIZE")
    # Markdown 本地绝对路径图片：env 中为逗号分隔字符串，由下方 computed 暴露为 List[str]（避免 pydantic-settings 对 List 做 json.loads 报错）
    markdown_local_image_allowed_base_paths_str: str = Field(
        default="",
        validation_alias="MARKDOWN_LOCAL_IMAGE_ALLOWED_BASE_PATHS",
    )
    # false 时不校验路径是否在白名单内，只要文件存在且为图片即读取（上传方可引用任意本机路径；仅建议在可信/内网环境使用）
    markdown_local_image_require_whitelist: bool = Field(
        default=True,
        validation_alias="MARKDOWN_LOCAL_IMAGE_REQUIRE_WHITELIST",
    )

    # 视频模态：Scene–Shot–ASR。120 秒窗口能容纳完整语义段，同时避免长视频的
    # Scene/Shot/ASR JSON 因输出过长被模型截断；15 秒重叠用于保留跨窗语句。
    video_long_threshold_seconds: float = Field(default=120.0, validation_alias="VIDEO_LONG_THRESHOLD_SECONDS")
    video_chunk_window_seconds: float = Field(default=120.0, validation_alias="VIDEO_CHUNK_WINDOW_SECONDS")
    video_max_chunk_duration_seconds: float = Field(default=120.0, validation_alias="VIDEO_MAX_CHUNK_DURATION_SECONDS")
    video_segment_max_seconds: float = Field(default=120.0, validation_alias="VIDEO_SEGMENT_MAX_SECONDS")
    video_chunk_overlap_seconds: float = Field(default=15.0, validation_alias="VIDEO_CHUNK_OVERLAP_SECONDS")
    # 长视频每个窗口输入给 Omni 的采样帧率。1fps 足以保留语义切分与关键事件时间轴，
    # 同时避免 20+ 分钟视频按 2fps 发送数千帧而让单个任务长时间占满解析队列。
    video_long_parsing_fps: int = Field(default=1, validation_alias="VIDEO_LONG_PARSING_FPS")
    video_parsing_max_tokens: int = Field(default=16000, validation_alias="VIDEO_PARSING_MAX_TOKENS")
    video_parsing_temperature: float = Field(default=0.1, validation_alias="VIDEO_PARSING_TEMPERATURE")
    # 只有模型响应不是合法 Scene–Shot JSON 时才重试，避免瞬态格式错误导致整段长视频失败。
    video_parsing_retry_attempts: int = Field(default=1, validation_alias="VIDEO_PARSING_RETRY_ATTEMPTS")
    # 长视频分段切段使用的 ffmpeg 可执行路径；未设置时使用 PATH 中的 ffmpeg（需系统已安装，如 macOS: brew install ffmpeg）
    ffmpeg_path: Optional[str] = Field(default=None, validation_alias="FFMPEG_PATH")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def markdown_local_image_allowed_base_paths(self) -> List[str]:
        s = (self.markdown_local_image_allowed_base_paths_str or "").strip().strip("'\"")
        return [p.strip().strip("'\"").strip() for p in s.split(",") if p.strip()]

    @field_validator("import_folder_allowed_base_paths", mode="before")
    @classmethod
    def parse_import_folder_allowed_base_paths(cls, v: Union[str, List[str], None]) -> List[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [p.strip() for p in v if isinstance(p, str) and p.strip()]
        if isinstance(v, str):
            return [p.strip() for p in v.split(",") if p.strip()]
        return []

    @field_validator("max_file_size", mode="before")
    @classmethod
    def parse_max_file_size(cls, v: Union[str, int]) -> int:
        """解析文件大小，支持 '100MB' 格式的字符串"""
        if isinstance(v, int):
            return v
        if isinstance(v, str):
            # 移除空格并转换为大写
            v = v.strip().upper()
            # 匹配数字和单位 (KB, MB, GB)
            match = re.match(r'^(\d+)(KB|MB|GB)?$', v)
            if match:
                size = int(match.group(1))
                unit = match.group(2) or 'B'
                multipliers = {
                    'B': 1,
                    'KB': 1024,
                    'MB': 1024 * 1024,
                    'GB': 1024 * 1024 * 1024
                }
                return size * multipliers.get(unit, 1)
            # 如果无法解析，尝试直接转换为整数
            try:
                return int(v)
            except ValueError:
                raise ValueError(f"无法解析文件大小: {v}")
        return v
    
    @computed_field
    @property
    def allowed_extensions(self) -> List[str]:
        """解析允许的文件扩展名列表，支持逗号分隔的字符串"""
        return [ext.strip().lower() for ext in self.allowed_extensions_str.split(",") if ext.strip()]
    
    # 日志配置
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    log_file: str = Field(default="logs/app.log", validation_alias="LOG_FILE")
    
    # 模型配置（可选环境变量，用于覆盖 LLMRegistry 的默认主模型）
    # 实际选模型以 app/core/llm/__init__.py 的 _task_config 为准；此处仅在配置时覆盖对应任务的主模型
    default_embedding_model: Optional[str] = Field(
        default=None,
        validation_alias="DEFAULT_EMBEDDING_MODEL"
    )

    # BGE-M3 稀疏编码：模型 ID 或本机目录；无法直连 huggingface.co 时在 .env 设置 HF_ENDPOINT（如 https://hf-mirror.com）
    bge_m3_model_id: str = Field(default="BAAI/bge-m3", validation_alias="BGE_M3_MODEL_ID")
    bge_m3_use_fp16: bool = Field(default=False, validation_alias="BGE_M3_USE_FP16")
    hf_endpoint: Optional[str] = Field(default=None, validation_alias="HF_ENDPOINT")
    hf_hub_download_timeout: Optional[int] = Field(
        default=None,
        validation_alias="HF_HUB_DOWNLOAD_TIMEOUT",
    )
    # 为 True 时在服务接受流量前预载 BGE-M3/CLIP/CLAP（启动变慢、占用显存/内存；首次部署可改善首请求体验）
    preload_local_models_on_startup: bool = Field(
        default=False,
        validation_alias="PRELOAD_LOCAL_MODELS_ON_STARTUP",
    )
    default_chat_model: Optional[str] = Field(
        default=None,
        validation_alias="DEFAULT_CHAT_MODEL"
    )
    default_vision_model: Optional[str] = Field(
        default=None,
        validation_alias="DEFAULT_VISION_MODEL"
    )
    default_reranker_model: Optional[str] = Field(
        default=None,
        validation_alias="DEFAULT_RERANKER_MODEL"
    )
    # 视频解析（场景划分+关键帧 / 视频整体描述）：与音频解析一样可指定专用模型
    default_video_parsing_model: Optional[str] = Field(
        default=None,
        validation_alias="DEFAULT_VIDEO_PARSING_MODEL"
    )
    # 视频后台解析：批量上传会先为每个文件入队，避免前端刷新丢掉尚未提交的文件。
    # Qwen Omni 解析与关键帧向量化资源较重，默认串行执行视频解析。
    video_processing_concurrency: int = Field(
        default=1,
        validation_alias="VIDEO_PROCESSING_CONCURRENCY",
    )
    # 让 MLLM 按视觉变化自行决定关键帧数；此值仅用于防御异常输出造成的资源失控。
    video_max_keyframes_per_shot: int = Field(
        default=4,
        validation_alias="VIDEO_MAX_KEYFRAMES_PER_SHOT",
    )
    video_keyframe_min_gap_seconds: float = Field(
        default=1.0,
        validation_alias="VIDEO_KEYFRAME_MIN_GAP_SECONDS",
    )
    # 关键帧仍由 MLLM 按 Shot 自主选择；该全视频预算只防止长视频的
    # 「Shot 数 × 每 Shot 多帧」失控。选择器先尽量保留每个 Shot 的首帧，
    # 再按轮次公平保留额外帧，而不是简单截断前半段视频。
    video_max_keyframes_per_video: int = Field(
        default=192,
        validation_alias="VIDEO_MAX_KEYFRAMES_PER_VIDEO",
    )
    # 抽帧/上传是 I/O 密集型，受控并发可缩短长视频尾部耗时；CLIP 本身按 batch
    # 串行执行，避免与 CPU/GPU 推理竞争资源。
    video_keyframe_processing_concurrency: int = Field(
        default=4,
        validation_alias="VIDEO_KEYFRAME_PROCESSING_CONCURRENCY",
    )
    video_clip_batch_size: int = Field(
        default=4,
        validation_alias="VIDEO_CLIP_BATCH_SIZE",
    )
    # 上传任务状态写入 Redis 的保留时长，供页面刷新后恢复文件状态。
    upload_processing_status_ttl_seconds: int = Field(
        default=7 * 24 * 60 * 60,
        validation_alias="UPLOAD_PROCESSING_STATUS_TTL_SECONDS",
    )
    # 后台上传任务的 lease/heartbeat 超时。超过该时间未续约的 queued/processing
    # 任务会在下次查询时安全标记为失败，避免服务重启后永久假处理中。
    upload_processing_lease_timeout_seconds: int = Field(
        default=300,
        validation_alias="UPLOAD_PROCESSING_LEASE_TIMEOUT_SECONDS",
    )

    # 检索配置
    max_retrieval_results: int = Field(default=20, validation_alias="MAX_RETRIEVAL_RESULTS")
    max_context_length: int = Field(default=4000, validation_alias="MAX_CONTEXT_LENGTH")
    rerank_top_k: int = Field(default=10, validation_alias="RERANK_TOP_K")

    # 多轮会话上下文：按完整轮次选择最近消息，分别限制消息数、总字符数和单条长度。
    chat_context_max_messages: int = Field(default=12, ge=2, le=50, validation_alias="CHAT_CONTEXT_MAX_MESSAGES")
    chat_context_max_chars: int = Field(default=6000, ge=500, le=50000, validation_alias="CHAT_CONTEXT_MAX_CHARS")
    chat_context_message_max_chars: int = Field(
        default=1600,
        ge=100,
        le=10000,
        validation_alias="CHAT_CONTEXT_MESSAGE_MAX_CHARS",
    )
    chat_session_max_stored_messages: int = Field(
        default=100,
        ge=10,
        le=1000,
        validation_alias="CHAT_SESSION_MAX_STORED_MESSAGES",
    )

    # Agentic 检索运行时：在原有多模态检索之上做有界的规划、并发检索与证据收敛。
    # 所有自动工具均为只读；预算用于避免规划器循环或意外的模型/检索成本失控。
    agent_max_rounds: int = Field(
        default=3,
        ge=1,
        le=8,
        validation_alias="AGENT_MAX_ROUNDS",
    )
    agent_max_queries_per_round: int = Field(
        default=3,
        ge=1,
        le=5,
        validation_alias="AGENT_MAX_QUERIES_PER_ROUND",
    )
    agent_max_total_queries: int = Field(
        default=6,
        ge=1,
        le=20,
        validation_alias="AGENT_MAX_TOTAL_QUERIES",
    )
    agent_max_evidence: int = Field(
        default=30,
        ge=5,
        le=100,
        validation_alias="AGENT_MAX_EVIDENCE",
    )
    
    # 知识库配置（知识库列表与元数据仅从 MinIO 获取，不再使用本地 JSON）
    max_kb_portrait_size: int = Field(default=20, validation_alias="MAX_KB_PORTRAIT_SIZE")
    portrait_update_threshold: int = Field(default=50, validation_alias="PORTRAIT_UPDATE_THRESHOLD")
    # 画像自动触发：Celery 投递失败时，后台通过该 API 回退同步画像接口；不阻塞上传/删除请求。
    portrait_sync_api_url: Optional[str] = Field(default=None, validation_alias="PORTRAIT_SYNC_API_URL")

    # Celery 配置（可选，如果不需要可以忽略）
    celery_broker_url: Optional[str] = Field(default=None, validation_alias="CELERY_BROKER_URL")
    celery_result_backend: Optional[str] = Field(default=None, validation_alias="CELERY_RESULT_BACKEND")

    # 飞书机器人（可选；与 Web 共用进程时需 FEISHU_WS_ENABLED 与凭证）
    feishu_app_id: Optional[str] = Field(default=None, validation_alias="FEISHU_APP_ID")
    feishu_app_secret: Optional[str] = Field(default=None, validation_alias="FEISHU_APP_SECRET")
    # 可选的用户 access token；未配置时文档导入复用 App ID/Secret 获取 tenant token。
    feishu_doc_access_token: Optional[str] = Field(
        default=None,
        validation_alias="FEISHU_DOC_ACCESS_TOKEN",
    )
    feishu_doc_max_blocks: int = Field(default=5000, ge=100, le=20000, validation_alias="FEISHU_DOC_MAX_BLOCKS")
    feishu_doc_max_assets: int = Field(default=100, ge=1, le=500, validation_alias="FEISHU_DOC_MAX_ASSETS")
    feishu_doc_max_sheet_rows: int = Field(
        default=200,
        ge=1,
        le=5000,
        validation_alias="FEISHU_DOC_MAX_SHEET_ROWS",
    )
    feishu_doc_max_bitable_records: int = Field(
        default=200,
        ge=1,
        le=5000,
        validation_alias="FEISHU_DOC_MAX_BITABLE_RECORDS",
    )
    feishu_ws_enabled: bool = Field(default=False, validation_alias="FEISHU_WS_ENABLED")
    feishu_encrypt_key: str = Field(default="", validation_alias="FEISHU_ENCRYPT_KEY")
    feishu_verification_token: str = Field(default="", validation_alias="FEISHU_VERIFICATION_TOKEN")
    feishu_default_kb_ids: str = Field(default="", validation_alias="FEISHU_DEFAULT_KB_IDS")
    feishu_dedup_ttl_sec: int = Field(default=600, validation_alias="FEISHU_DEDUP_TTL_SEC")
    feishu_session_backend: str = Field(default="memory", validation_alias="FEISHU_SESSION_BACKEND")
    feishu_ignore_bot_messages: bool = Field(default=True, validation_alias="FEISHU_IGNORE_BOT_MESSAGES")
    feishu_max_reply_images: int = Field(default=4, validation_alias="FEISHU_MAX_REPLY_IMAGES")
    feishu_image_send_enabled: bool = Field(default=True, validation_alias="FEISHU_IMAGE_SEND_ENABLED")
    feishu_max_reply_audios: int = Field(default=4, validation_alias="FEISHU_MAX_REPLY_AUDIOS")
    feishu_audio_send_enabled: bool = Field(default=True, validation_alias="FEISHU_AUDIO_SEND_ENABLED")
    feishu_web_base_url: Optional[str] = Field(default=None, validation_alias="FEISHU_WEB_BASE_URL")
    feishu_reply_in_thread: bool = Field(default=False, validation_alias="FEISHU_REPLY_IN_THREAD")
    # True：RAG 回复用 post+md，渲染 ** / 列表 / 引用 / 代码块等；False：沿用纯 text（多为原文）
    feishu_reply_post_md: bool = Field(default=True, validation_alias="FEISHU_REPLY_POST_MD")
    # True：同一 post 气泡内交替 md 与 img（飞书要求图片独占段落）；False：图文分多条消息
    feishu_inline_images_in_post: bool = Field(default=True, validation_alias="FEISHU_INLINE_IMAGES_IN_POST")
    # 用户先发文字再发图/音时，文字侧等待的秒数，便于与 pending 附件合并为一次检索（0 关闭）
    feishu_merge_attach_wait_sec: float = Field(default=2.0, validation_alias="FEISHU_MERGE_ATTACH_WAIT_SEC")
    # 占位符：{name} 为附件文件名，{emoji} 由程序按类型填入（图片🖼️ / 音频🎵 / 其它📄）
    feishu_attach_received_hint: str = Field(
        default="已收到附件：{name}{emoji}\n下一条消息发送相关查询文本，我会结合附件与文字一起检索。",
        validation_alias="FEISHU_ATTACH_RECEIVED_HINT",
    )
    feishu_bot_open_id: Optional[str] = Field(default=None, validation_alias="FEISHU_BOT_OPEN_ID")
    feishu_group_trigger_prefix: str = Field(default="", validation_alias="FEISHU_GROUP_TRIGGER_PREFIX")
    feishu_typing_hint: bool = Field(default=True, validation_alias="FEISHU_TYPING_HINT")
    feishu_typing_hint_text: str = Field(
        default="正在检索与生成，请稍候…",
        validation_alias="FEISHU_TYPING_HINT_TEXT",
    )
    # websockets 默认 open_timeout=10s；asyncio 对 wss 默认 ssl_handshake_timeout=60s。
    # 跨境/代理/WSL 下两者均可能超时，本值会同时注入 connect(open_timeout=...) 与 ssl_handshake_timeout=...
    feishu_ws_open_timeout: float = Field(default=300.0, validation_alias="FEISHU_WS_OPEN_TIMEOUT")
    # WSL2 等环境 IPv6 访问飞书 WSS 可能极慢或卡住，解析域名后优先走 IPv4 + SNI（与 Node/OpenClaw 常见网络路径更一致）
    feishu_ws_prefer_ipv4: bool = Field(default=True, validation_alias="FEISHU_WS_PREFER_IPV4")
    # RAG 回复形态：post（默认，富文本 post 或多条消息）| card_v2（卡片 JSON 2.0，多图与 OPUS 音频同卡）
    feishu_rag_reply_format: str = Field(default="post", validation_alias="FEISHU_RAG_REPLY_FORMAT")
    # True：通过 CardKit 创建卡片实体并对正文做流式 PUT（需应用权限 cardkit:card:write）
    feishu_rag_card_streaming: bool = Field(default=False, validation_alias="FEISHU_RAG_CARD_STREAMING")
    feishu_rag_card_stream_chunk_chars: int = Field(
        default=120, ge=20, le=2000, validation_alias="FEISHU_RAG_CARD_STREAM_CHUNK_CHARS"
    )
    feishu_rag_card_stream_pause_sec: float = Field(
        default=0.08, ge=0.0, le=2.0, validation_alias="FEISHU_RAG_CARD_STREAM_PAUSE_SEC"
    )
    # True：尽量转 OPUS 并嵌入卡片 audio 组件（需 ffmpeg/libopus；失败则回退为文件消息）
    feishu_rag_card_opus_audio: bool = Field(default=True, validation_alias="FEISHU_RAG_CARD_OPUS_AUDIO")

    # Tavily 联网搜索（热点/新闻导入知识库）
    tavily_api_key: Optional[str] = Field(default=None, validation_alias="TAVILY_API_KEY")
    tavily_search_depth: str = Field(default="basic", validation_alias="TAVILY_SEARCH_DEPTH")
    tavily_max_results: int = Field(default=10, ge=1, le=20, validation_alias="TAVILY_MAX_RESULTS")
    tavily_hot_topics_default_query: str = Field(
        default="科技热点 互联网新闻 AI动态",
        validation_alias="TAVILY_HOT_TOPICS_DEFAULT_QUERY",
    )
    tavily_hot_topics_topic: str = Field(default="news", validation_alias="TAVILY_HOT_TOPICS_TOPIC")
    tavily_hot_topics_time_range: str = Field(default="day", validation_alias="TAVILY_HOT_TOPICS_TIME_RANGE")
    tavily_use_extract: bool = Field(default=False, validation_alias="TAVILY_USE_EXTRACT")
    tavily_extract_max_urls: int = Field(default=5, ge=1, le=20, validation_alias="TAVILY_EXTRACT_MAX_URLS")
    # 定时热点导入：目标知识库 ID（为空则仅允许手动 API 触发）
    tavily_hot_topics_kb_id: Optional[str] = Field(default=None, validation_alias="TAVILY_HOT_TOPICS_KB_ID")
    
    def get_minio_config(self) -> Dict[str, Any]:
        """获取 MinIO 配置字典"""
        pub = self.minio_public_endpoint or self.minio_endpoint
        pub_sec = (
            self.minio_public_secure
            if self.minio_public_secure is not None
            else self.minio_secure
        )
        return {
            "endpoint": self.minio_endpoint,
            "access_key": self.minio_access_key,
            "secret_key": self.minio_secret_key,
            "secure": self.minio_secure,
            "public_endpoint": pub,
            "public_secure": pub_sec,
        }
    
    def get_qdrant_config(self) -> Dict[str, Any]:
        """获取 Qdrant 配置字典"""
        config = {
            "host": self.qdrant_host,
            "port": self.qdrant_port,
        }
        if self.qdrant_api_key:
            config["api_key"] = self.qdrant_api_key
        return config
    
    def ensure_directories(self):
        """确保必要的目录存在"""
        # 获取backend目录
        backend_dir = Path(__file__).parent.parent.parent
        
        # 只需要在backend目录下创建必要的目录
        # minio_data 和 qdrant_storage 由 Docker Compose 在项目根目录管理，不需要在backend目录下创建
        directories = [
            backend_dir / "logs",
            backend_dir / "temp",
            backend_dir / "uploads",
            backend_dir / "data",
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)


def apply_huggingface_env_from_settings(s: Settings) -> None:
    """将 .env 中的 HF 相关配置写入 os.environ，供 huggingface_hub / transformers 全库使用（BGE-M3、CLIP、CLAP、MinerU 等）。"""
    if s.hf_endpoint:
        v = s.hf_endpoint.strip().rstrip("/")
        os.environ["HF_ENDPOINT"] = v
        logger.info("Hugging Face 端点已应用（HF_ENDPOINT）: {}", v)
    if s.hf_hub_download_timeout is not None:
        os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = str(int(s.hf_hub_download_timeout))


# 全局设置实例
settings = Settings()  # type: ignore[call-arg]
apply_huggingface_env_from_settings(settings)
settings.ensure_directories()
