"""
应用核心配置模块
使用 Pydantic 进行配置管理和验证
"""

from typing import Optional, List, Dict, Any, Union
from pydantic import Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import os
import re
from pathlib import Path

class Settings(BaseSettings):
    """应用设置类"""
    
    model_config = SettingsConfigDict(  # type: ignore[assignment]
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"  # 忽略 .env 文件中未定义的字段
    )
    
    # 应用基本信息
    app_name: str = Field(default="Multi-Modal RAG Agent", validation_alias="APP_NAME")
    app_version: str = Field(default="1.0.0", validation_alias="APP_VERSION")
    debug: bool = Field(default=False, validation_alias="API_DEBUG")
    
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
    
    # Qdrant 配置
    qdrant_host: str = Field(default="localhost", validation_alias="QDRANT_HOST")
    qdrant_port: int = Field(default=6333, validation_alias="QDRANT_PORT")
    qdrant_api_key: Optional[str] = Field(default=None, validation_alias="QDRANT_API_KEY")
    
    # Redis 配置
    redis_url: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")
    
    # SiliconFlow API 配置
    siliconflow_api_key: str = Field(..., validation_alias="SILICONFLOW_API_KEY")  # type: ignore[arg-type]
    
    # DeepSeek API 配置（可选，配置后可使用 deepseek-chat / deepseek-reasoner 等模型）
    deepseek_api_key: Optional[str] = Field(default=None, validation_alias="DEEPSEEK_API_KEY")
    
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
    
    # 文件上传配置
    max_file_size: int = Field(default=100 * 1024 * 1024, validation_alias="MAX_FILE_SIZE")  # 100MB
    allowed_extensions_str: str = Field(
        default="pdf,docx,doc,txt,md,jpg,jpeg,png,gif",
        validation_alias="ALLOWED_EXTENSIONS"
    )

    # 文件夹导入：允许的根路径白名单（逗号分隔），未配置则禁用文件夹导入
    import_folder_allowed_base_paths: List[str] = Field(
        default_factory=list,
        validation_alias="IMPORT_FOLDER_ALLOWED_BASE_PATHS",
    )

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
    
    # 检索配置
    max_retrieval_results: int = Field(default=20, validation_alias="MAX_RETRIEVAL_RESULTS")
    max_context_length: int = Field(default=4000, validation_alias="MAX_CONTEXT_LENGTH")
    rerank_top_k: int = Field(default=10, validation_alias="RERANK_TOP_K")
    
    # 知识库配置（知识库列表与元数据仅从 MinIO 获取，不再使用本地 JSON）
    max_kb_portrait_size: int = Field(default=20, validation_alias="MAX_KB_PORTRAIT_SIZE")
    portrait_update_threshold: int = Field(default=50, validation_alias="PORTRAIT_UPDATE_THRESHOLD")

    # Celery 配置（可选，如果不需要可以忽略）
    celery_broker_url: Optional[str] = Field(default=None, validation_alias="CELERY_BROKER_URL")
    celery_result_backend: Optional[str] = Field(default=None, validation_alias="CELERY_RESULT_BACKEND")
    
    def get_minio_config(self) -> Dict[str, Any]:
        """获取 MinIO 配置字典"""
        return {
            "endpoint": self.minio_endpoint,
            "access_key": self.minio_access_key,
            "secret_key": self.minio_secret_key,
            "secure": self.minio_secure,
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

# 全局设置实例
settings = Settings()  # type: ignore[call-arg]
settings.ensure_directories()