"""Stream directory members into ordinary durable uploads, preserving Markdown sibling references."""
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
import posixpath

from .desktop_jobs import jobs


def member_name(value):
    parts = value.replace("\\", "/").split("/")
    if (
        not all(parts)
        or any(part in {".", ".."} or "\x00" in part for part in parts)
        or ":" in parts[0]
    ):
        raise ValueError("无效的目录文件相对路径")
    return "/".join(parts)


@contextmanager
def member_stream(value):
    if isinstance(value, Path):
        with value.open("rb") as stream:
            yield stream
    else:
        value.seek(0)
        try:
            yield value
        finally:
            value.seek(0)


def enqueue_member(members, name, kb, *, request_id=None, source_type=None):
    from app.core.config import settings
    from .parsers.factory import _extract_image_refs_from_markdown_text

    name = member_name(name)
    assets = {}
    with member_stream(members[name]) as source:
        if len(members) > 1 and name.lower().endswith((".md", ".markdown")):
            content = source.read(settings.max_file_size + 1)
            if len(content) > settings.max_file_size:
                raise ValueError("Markdown 文件超出当前解析器大小上限")
            total_assets = 0
            for _, ref in _extract_image_refs_from_markdown_text(
                content.decode("utf-8-sig", errors="replace")
            ):
                target = posixpath.normpath(
                    posixpath.join(posixpath.dirname(name), ref)
                )
                if target not in members or target == name or target in assets:
                    continue
                with member_stream(members[target]) as image:
                    data = image.read(settings.markdown_image_url_max_size + 1)
                if len(data) > settings.markdown_image_url_max_size:
                    raise ValueError("Markdown 引用的图片过大")
                total_assets += len(data)
                if total_assets > settings.max_file_size:
                    raise ValueError("Markdown 的图片总量超出解析器大小上限")
                assets[target] = data
            source.seek(0)
        return jobs().enqueue(
            source,
            PurePosixPath(name).name,
            kb,
            processing_id=request_id,
            source_type=source_type,
            asset_map=assets,
            logical_path=name,
        )


def stage_directory(
    root,
    kb,
    *,
    recursive=True,
    extensions=None,
    exclude_patterns=None,
    max_files=500,
    request_id=None,
):
    """The API resolved root against its configured import allowlist before calling this function."""
    import uuid
    from .sources.folder import _matches_exclude

    root = Path(root).resolve(strict=True)
    operation = uuid.UUID(str(request_id)) if request_id else uuid.uuid4()
    allowed = {ext.lower().lstrip(".") for ext in extensions} if extensions else None
    members = {}
    iterator = root.rglob("*") if recursive else root.iterdir()
    for path in iterator:
        if (
            not path.is_file()
            or path.is_symlink()
            or not path.resolve().is_relative_to(root)
        ):
            continue
        if allowed and path.suffix.lower().lstrip(".") not in allowed:
            continue
        if _matches_exclude(path.name, exclude_patterns) or _matches_exclude(
            path.parent.name, exclude_patterns
        ):
            continue
        members[path.relative_to(root).as_posix()] = path
        if len(members) >= max_files:
            break
    entries = []
    for name in members:
        try:
            receipt = enqueue_member(
                members, name, kb, request_id=str(uuid.uuid5(operation, name))
            )
            entries.append({**receipt, "filename": name})
        except (OSError, ValueError) as exc:
            entries.append({"filename": name, "status": "failed", "error": str(exc)})
    return entries


async def directory_result(entries):
    results = []
    for receipt in entries:
        if receipt["status"] == "failed":
            results.append(receipt)
            continue
        try:
            await jobs().wait(receipt["processing_id"])
            results.append({**receipt, "status": "completed"})
        except ValueError as exc:
            results.append({**receipt, "status": "failed", "error": str(exc)})
    succeeded = sum(item["status"] == "completed" for item in results)
    return {
        "total": len(entries),
        "success_count": succeeded,
        "failed_count": len(entries) - succeeded,
        "results": results,
        "message": f"文件夹导入完成：成功 {succeeded}，失败 {len(entries)-succeeded}。",
    }
