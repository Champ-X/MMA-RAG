"""Dependency-light runner for the repository's current Markdown splitter.

The experiment must compare against the real splitter source, but importing
``IngestionService`` pulls storage, vision and model dependencies that are not
needed for a pure split.  This adapter compiles only the relevant methods from
the checked-in source after removing their local parser import, then supplies
the actual Markdown smart-paragraph method as a lightweight stub.

It is intentionally test-only and never used by the application runtime.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


class _NoopLogger:
    def debug(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    def info(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    def warning(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    def error(self, *_args: Any, **_kwargs: Any) -> None:
        return None


class _DropParserImport(ast.NodeTransformer):
    def visit_ImportFrom(self, node: ast.ImportFrom) -> Any:
        if node.level == 1 and node.module == "parsers.factory":
            return None
        return node


def _extract_method(source_path: Path, class_name: str, method_name: str) -> ast.FunctionDef:
    tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            for member in node.body:
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)) and member.name == method_name:
                    return member
    raise LookupError(f"{class_name}.{method_name} not found in {source_path}")


def _compile_method(method: ast.AST, namespace: Dict[str, Any], *, strip_parser_import: bool = False) -> Any:
    cloned = ast.parse(ast.unparse(method)).body[0]
    if strip_parser_import:
        cloned = _DropParserImport().visit(cloned)
    module = ast.Module(body=[cloned], type_ignores=[])
    ast.fix_missing_locations(module)
    exec(compile(module, "<repository-baseline>", "exec"), namespace)
    return namespace[getattr(method, "name")]


def _source_root() -> Path:
    return Path(__file__).resolve().parents[2] / "app" / "modules" / "ingestion"


def _build_runtime_service() -> Any:
    ingestion_root = _source_root()
    service_source = ingestion_root / "service.py"
    parser_source = ingestion_root / "parsers" / "factory.py"
    namespace: Dict[str, Any] = {
        "Any": Any,
        "Dict": Dict,
        "List": List,
        "Optional": Optional,
        "Tuple": Tuple,
        "logger": _NoopLogger(),
        "normalize_text_newlines": lambda text: text.replace("\r\n", "\n").replace("\r", "\n") if text else text,
        "staticmethod": staticmethod,
    }

    markdown_method = _compile_method(
        _extract_method(parser_source, "MarkdownParser", "_build_smart_paragraphs"), namespace
    )

    class MarkdownParser:  # noqa: N801 - matches the source method's expectation
        pass

    MarkdownParser._build_smart_paragraphs = markdown_method
    namespace["MarkdownParser"] = MarkdownParser

    class Service:
        pass

    method_names = (
        "merge_adjacent_chunks_up_to_max",
        "_split_text_into_chunks",
        "_recursive_split_chunk",
        "_split_by_sentences",
        "_apply_overlap_window",
    )
    for method_name in method_names:
        method = _extract_method(service_source, "IngestionService", method_name)
        compiled = _compile_method(
            method,
            namespace,
            strip_parser_import=method_name == "_split_text_into_chunks",
        )
        setattr(Service, method_name, compiled)
    return Service()


async def split_with_current_repository_policy(markdown: str) -> List[Dict[str, Any]]:
    """Execute the current checked-in Markdown split methods without app setup."""

    service = _build_runtime_service()
    return await service._split_text_into_chunks(
        {
            "file_type": "md",
            "markdown": markdown,
            "metadata": {"parser": "repository-baseline-adapter"},
        }
    )
