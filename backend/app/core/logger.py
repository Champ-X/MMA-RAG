"""
日志配置模块
使用 loguru 进行统一的日志管理
"""

import sys
import os
from pathlib import Path
from typing import Optional
from loguru import logger
from .config import settings

def setup_logger():
    """设置日志配置"""
    
    # 清除默认的 logger
    logger.remove()
    
    # 创建日志目录
    log_dir = Path(settings.log_file).parent
    log_dir.mkdir(exist_ok=True)
    
    # 控制台输出格式
    console_format = (
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
        "<level>{message}</level>"
    )
    
    # 文件输出格式
    file_format = (
        "{time:YYYY-MM-DD HH:mm:ss} | "
        "{level: <8} | "
        "{name}:{function}:{line} | "
        "{message} | "
        "{extra}"
    )
    
    # 控制台日志
    logger.add(
        sys.stdout,
        format=console_format,
        level=settings.log_level,
        colorize=True,
        backtrace=True,
        diagnose=True,
    )
    
    # 文件日志 - 按天轮转
    logger.add(
        settings.log_file,
        format=file_format,
        level=settings.log_level,
        rotation="00:00",
        retention="30 days",
        compression="zip",
        backtrace=True,
        diagnose=True,
        enqueue=True,
    )
    
    # 错误日志单独文件
    logger.add(
        "logs/error.log",
        format=file_format,
        level="ERROR",
        rotation="00:00",
        retention="30 days",
        compression="zip",
        backtrace=True,
        diagnose=True,
        enqueue=True,
    )
    
    # 审计日志 - 记录API调用
    logger.add(
        "logs/audit.log",
        format=file_format,
        level="INFO",
        rotation="1 week",
        retention="3 months",
        filter=lambda record: record["extra"].get("audit", False),
        enqueue=True,
    )
    
    return logger

# 全局日志实例
_app_logger = setup_logger()

# 导出的便捷函数
def get_logger(name: Optional[str] = None):
    """获取日志实例"""
    if name:
        return _app_logger.bind(name=name)
    return _app_logger

def audit_log(message: str, **kwargs):
    """记录审计日志"""
    return _app_logger.bind(audit=True, **kwargs).info(message)

def log_request(method: str, path: str, status_code: int, duration: float, user_id: Optional[str] = None):
    """记录API请求日志"""
    _app_logger.bind(
        audit=True,
        method=method,
        path=path,
        status_code=status_code,
        duration=duration,
        user_id=user_id
    ).info(f"API Request: {method} {path} - {status_code} - {duration:.3f}s")

def log_llm_call(model: str, task_type: str, tokens_used: int, duration: float, success: bool):
    """记录LLM调用日志"""
    _app_logger.bind(
        audit=True,
        model=model,
        task_type=task_type,
        tokens_used=tokens_used,
        success=success
    ).info(f"LLM Call: {task_type} with {model} - {tokens_used} tokens - {duration:.3f}s - {'Success' if success else 'Failed'}")