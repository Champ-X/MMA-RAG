"""数据输入处理与存储模块。

Exports are lazy so a focused component such as the document splitter does
not import every parser, model, and service dependency merely by living under
this package.
"""

from importlib import import_module
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .parsers.factory import ParserFactory
    from .service import IngestionService
    from .storage.minio_adapter import MinIOAdapter
    from .storage.vector_store import VectorStore

__all__ = [
    "IngestionService",
    "ParserFactory", 
    "MinIOAdapter",
    "VectorStore"
]

_EXPORTS = {
    "IngestionService": (".service", "IngestionService"),
    "ParserFactory": (".parsers.factory", "ParserFactory"),
    "MinIOAdapter": (".storage.minio_adapter", "MinIOAdapter"),
    "VectorStore": (".storage.vector_store", "VectorStore"),
}


def __getattr__(name: str) -> Any:
    """Load public classes only when callers request them."""

    target = _EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(target[0], __name__)
    value = getattr(module, target[1])
    globals()[name] = value
    return value
