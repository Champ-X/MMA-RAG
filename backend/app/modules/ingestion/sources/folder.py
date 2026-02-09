"""
从本地文件夹遍历文件，产出 (bytes, suggested_filename) 列表。
路径白名单由 API 层校验，本模块不负责安全校验。
"""

import fnmatch
from pathlib import Path
from typing import List, Optional

from app.core.logger import get_logger
from .base import BaseContentSource, ContentSourceResult

logger = get_logger(__name__)


def _matches_exclude(name: str, patterns: Optional[List[str]]) -> bool:
    if not patterns:
        return False
    for p in patterns:
        if fnmatch.fnmatch(name, p):
            return True
    return False


class FolderSource(BaseContentSource):
    """从给定本地文件夹遍历文件，返回 ContentSourceResult 列表。"""

    def fetch_folder(
        self,
        folder_path: str,
        recursive: bool = True,
        extensions: Optional[List[str]] = None,
        exclude_patterns: Optional[List[str]] = None,
        max_files: int = 500,
    ) -> List[ContentSourceResult]:
        """
        遍历文件夹，收集文件内容。
        :param folder_path: 文件夹绝对路径（应由 API 层做白名单校验）。
        :param recursive: 是否递归子目录。
        :param extensions: 允许的后缀列表，如 [".pdf", ".txt"]，大小写不敏感；None 表示不过滤。
        :param exclude_patterns: 排除模式，如 ["__pycache__", "*.tmp"]。
        :param max_files: 最多收集文件数，超过则停止并返回已收集的。
        :return: ContentSourceResult 列表。
        """
        root = Path(folder_path)
        if not root.is_dir():
            raise ValueError(f"路径不是目录或不存在: {folder_path}")

        if extensions is not None:
            ext_set = {e.lower() if e.startswith(".") else f".{e.lower()}" for e in extensions}
        else:
            ext_set = None

        results: List[ContentSourceResult] = []
        if recursive:
            iterator = root.rglob("*")
        else:
            iterator = root.glob("*")

        for p in iterator:
            if len(results) >= max_files:
                logger.warning("文件夹导入达到 max_files=%s，停止收集", max_files)
                break
            if not p.is_file():
                continue
            if _matches_exclude(p.name, exclude_patterns):
                continue
            if _matches_exclude(p.parent.name, exclude_patterns):
                continue
            if ext_set is not None and p.suffix.lower() not in ext_set:
                continue
            try:
                content = p.read_bytes()
            except (OSError, IOError) as e:
                logger.warning("跳过无法读取的文件 %s: %s", p, e)
                continue
            # 使用相对路径作为 suggested_filename，避免重名
            try:
                rel = p.relative_to(root)
                suggested_filename = str(rel).replace("\\", "/")
            except ValueError:
                suggested_filename = p.name
            results.append(
                ContentSourceResult(content=content, suggested_filename=suggested_filename)
            )

        return results
