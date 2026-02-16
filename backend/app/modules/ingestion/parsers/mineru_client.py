"""
MinerU 文档解析：支持 PDF、Word(docx)、PPTX。
优先 MinerU API（需 MINERU_TOKEN），备选本地 MinerU2.5 模型。
输出与 PaddleOCR 兼容的解析结果结构（markdown、pages、extracted_images）。
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import tempfile
import time
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.logger import get_logger
from datetime import datetime

logger = get_logger(__name__)

MODEL_ID = "opendatalab/MinerU2.5-2509-1.2B"
# 本地渲染 PDF 默认 DPI，可通过配置 MINERU_PDF_RENDER_DPI 覆盖（越高越清晰，默认 300）
_PDF_DPI_DEFAULT = 300
MINERU_API_BASE = "https://mineru.net/api/v4"
MINERU_API_POLL_INTERVAL = 5
MINERU_API_POLL_TIMEOUT = 600

# 懒加载：模型 + Processor + MinerUClient
_mineru_client: Any = None


def _pdf_bytes_to_images(file_content: bytes, dpi: int = _PDF_DPI_DEFAULT) -> List[Any]:
    """将 PDF 二进制内容每一页渲染为 PIL Image。"""
    import fitz  # PyMuPDF
    from PIL import Image

    doc = fitz.open(stream=file_content, filetype="pdf")
    out: List[Any] = []
    try:
        for i in range(len(doc)):
            page = doc.load_page(i)
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
            out.append(img)
    finally:
        doc.close()
    return out


def _office_bytes_to_images(file_content: bytes, file_ext: str, dpi: int = _PDF_DPI_DEFAULT) -> List[Any]:
    """
    将 Word(docx) / PPTX 二进制内容转为每页/每页幻灯的 PIL Image 列表。
    通过 LibreOffice 转 PDF 再渲染；若 LibreOffice 不可用则返回空列表。
    file_ext: "docx" | "pptx"
    """
    suffix = f".{file_ext}" if not file_ext.startswith(".") else file_ext
    with tempfile.TemporaryDirectory(prefix="mineru_office_") as tmpdir:
        src = os.path.join(tmpdir, f"doc{suffix}")
        with open(src, "wb") as f:
            f.write(file_content)
        out_pdf = os.path.join(tmpdir, "out.pdf")
        try:
            subprocess.run(
                ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", tmpdir, src],
                capture_output=True,
                timeout=120,
                check=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
            logger.debug("LibreOffice 转换 Office 为 PDF 失败: %s", e)
            return []
        if not os.path.isfile(out_pdf):
            return []
        with open(out_pdf, "rb") as f:
            pdf_bytes = f.read()
    return _pdf_bytes_to_images(pdf_bytes, dpi=dpi)


def _blocks_to_markdown(
    blocks: List[Any],
    page_num: Optional[int] = None,
    include_page_header: bool = True,
) -> str:
    """将 ContentBlock 列表转为 Markdown 片段。为 image 块插入占位符，便于后续用 VLM 图注替换。"""
    parts = []
    if page_num is not None and include_page_header:
        parts.append(f"\n\n---\n\n## 第 {page_num} 页\n\n")
    img_idx = 0
    for b in blocks:
        t = getattr(b, "type", None) or (b.get("type") if isinstance(b, dict) else None)
        if t == "image":
            # 插入与 _extract_image_crops 一致的占位符，保证与 extracted_images 顺序对应
            placeholder = f"![](page{page_num or 0}_img{img_idx}.png)"
            parts.append("\n\n")
            parts.append(placeholder)
            parts.append("\n\n")
            img_idx += 1
            continue
        c = getattr(b, "content", None) if not isinstance(b, dict) else b.get("content")
        if not c:
            continue
        if t == "text":
            parts.append(c.strip())
            parts.append("\n\n")
        elif t == "table":
            parts.append("\n\n")
            parts.append(c.strip())
            parts.append("\n\n")
        elif t == "equation":
            parts.append("\n\n$$")
            parts.append(c.strip())
            parts.append("$$\n\n")
        else:
            parts.append(c.strip())
            parts.append("\n\n")
    return "".join(parts).strip()


def _extract_image_crops(
    page_pil_image: Any,
    blocks: List[Any],
    page_num: int,
    min_size: int = 16,
) -> List[Dict[str, Any]]:
    """
    从 MinerU 的 image 类型块按 bbox（归一化 [0,1]）裁剪页面图，返回与 PaddleOCR 兼容的图片信息列表。
    """
    from PIL import Image

    out: List[Dict[str, Any]] = []
    w, h = page_pil_image.size
    for img_idx, b in enumerate(blocks):
        t = getattr(b, "type", None) or (b.get("type") if isinstance(b, dict) else None)
        if t != "image":
            continue
        bbox = getattr(b, "bbox", None) or (b.get("bbox") if isinstance(b, dict) else None)
        if not bbox or len(bbox) != 4:
            continue
        x0, y0, x1, y1 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
        x0 = max(0, min(1, x0))
        y0 = max(0, min(1, y0))
        x1 = max(0, min(1, x1))
        y1 = max(0, min(1, y1))
        if x1 <= x0 or y1 <= y0:
            continue
        left = int(x0 * w)
        top = int(y0 * h)
        right = int(x1 * w)
        bottom = int(y1 * h)
        if right - left < min_size or bottom - top < min_size:
            continue
        try:
            crop = page_pil_image.crop((left, top, right, bottom))
            buf = io.BytesIO()
            crop.save(buf, format="PNG")
            image_bytes = buf.getvalue()
        except Exception as e:
            logger.debug("MinerU 裁剪页面图失败 (page=%s, bbox=%s): %s", page_num, bbox, e)
            continue
        # 与 _blocks_to_markdown 中占位符一致，供流水线定位与 VLM 图注插回
        markdown_ref = f"![](page{page_num}_img{img_idx}.png)"
        out.append({
            "page": page_num,
            "image_index": img_idx,
            "image_bytes": image_bytes,
            "image_path": f"page{page_num}_img{img_idx}.png",
            "markdown_ref": markdown_ref,
            "metadata": {"extracted_from": "mineru-vl-2.5", "page": page_num, "document_caption": None},
        })
    return out


def _parse_via_api_impl(
    file_content: bytes,
    file_path: str,
    token: str,
    file_type: str,
    poll_interval: int = MINERU_API_POLL_INTERVAL,
    poll_timeout: int = MINERU_API_POLL_TIMEOUT,
) -> Optional[Dict[str, Any]]:
    """
    通过 MinerU API 解析文档（PDF/docx/pptx），返回统一结构；失败返回 None。
    同步阻塞，调用方应在 executor 中执行。
    file_type: "pdf" | "docx" | "pptx"
    """
    try:
        import requests
    except ImportError:
        logger.warning("未安装 requests，无法使用 MinerU API")
        return None

    default_names = {"pdf": "document.pdf", "docx": "document.docx", "pptx": "document.pptx"}
    file_name = Path(file_path).name or default_names.get(file_type, "document.pdf")
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}

    # 1. 申请上传链接
    r = requests.post(
        f"{MINERU_API_BASE}/file-urls/batch",
        headers=headers,
        json={"files": [{"name": file_name}], "model_version": "vlm"},
        timeout=30,
    )
    if r.status_code != 200 or r.json().get("code") != 0:
        logger.debug("MinerU API 申请上传链接失败: %s", r.text[:200])
        return None
    data = r.json()
    batch_id = data["data"]["batch_id"]
    file_urls = data["data"].get("file_urls") or data["data"].get("files")
    if not file_urls:
        return None
    upload_url = file_urls[0] if isinstance(file_urls[0], str) else file_urls[0].get("url")

    # 2. 上传文件
    ru = requests.put(
        upload_url,
        data=file_content,
        headers={"Authorization": f"Bearer {token}"},
        timeout=120,
    )
    if ru.status_code not in (200, 204):
        logger.debug("MinerU API 上传失败: %s", ru.status_code)
        return None

    # 3. 轮询结果
    results_url = f"{MINERU_API_BASE}/extract-results/batch/{batch_id}"
    deadline = time.monotonic() + poll_timeout
    zip_url = None
    while time.monotonic() < deadline:
        rr = requests.get(results_url, headers=headers, timeout=30)
        if rr.status_code != 200:
            time.sleep(poll_interval)
            continue
        res = rr.json()
        if res.get("code") != 0:
            time.sleep(poll_interval)
            continue
        extract_result = res.get("data", {}).get("extract_result") or []
        if not extract_result:
            time.sleep(poll_interval)
            continue
        first = extract_result[0] if isinstance(extract_result[0], dict) else {}
        state = first.get("state", "")
        if state == "done":
            zip_url = first.get("full_zip_url")
            break
        if state == "failed":
            logger.warning("MinerU API 解析失败: %s", first.get("err_msg", "unknown"))
            return None
        logger.debug("MinerU API 任务状态: %s", state)
        time.sleep(poll_interval)
    if not zip_url:
        logger.warning("MinerU API 轮询超时或未返回 zip")
        return None

    # 4. 下载 zip
    rz = requests.get(zip_url, timeout=120)
    if rz.status_code != 200:
        return None
    zip_buf = io.BytesIO(rz.content)

    # 5. 解压并转为 parse_pdf 兼容结构
    with zipfile.ZipFile(zip_buf, "r") as zf:
        name_list = zf.namelist()
        md_paths = [n for n in name_list if n.endswith(".md") and not n.startswith("__")]
        content_list_paths = [n for n in name_list if "_content_list.json" in n]
        image_entries = [n for n in name_list if "images/" in n and not n.endswith("images/")]

        full_markdown = ""
        if md_paths:
            full_markdown = zf.read(min(md_paths, key=len)).decode("utf-8", errors="replace")

        content_list: List[Dict[str, Any]] = []
        if content_list_paths:
            raw = zf.read(min(content_list_paths, key=len)).decode("utf-8", errors="replace")
            try:
                obj = json.loads(raw)
                content_list = obj if isinstance(obj, list) else obj.get("content_list", [])
            except Exception:
                pass

        image_bytes_map: Dict[str, bytes] = {}
        for entry in image_entries:
            key = entry.replace("\\", "/")
            image_bytes_map[key] = zf.read(entry)
            # 无前缀的 key 便于 content_list 中 img_path 匹配
            name = Path(entry).name
            if name and name not in image_bytes_map:
                image_bytes_map[name] = image_bytes_map[key]

        extracted_images: List[Dict[str, Any]] = []
        page_image_index: Dict[int, int] = {}
        for item in content_list:
            if item.get("type") != "image":
                continue
            img_path = item.get("img_path") or item.get("image_path") or ""
            page_idx = int(item.get("page_idx", 0))
            page_num = page_idx + 1
            image_bytes = None
            for key in (img_path, img_path.replace("\\", "/"), Path(img_path).name, f"images/{Path(img_path).name}"):
                if key and image_bytes_map.get(key):
                    image_bytes = image_bytes_map[key]
                    break
            if not image_bytes:
                continue
            idx = page_image_index.get(page_idx, 0)
            page_image_index[page_idx] = idx + 1
            # 文档标题/说明：content_list 中 image 项可能有 image_caption（列表）
            doc_caption = ""
            cap_list = item.get("image_caption") or item.get("caption") or []
            if isinstance(cap_list, list) and cap_list:
                doc_caption = " ".join(str(c).strip() for c in cap_list if c).strip()
            elif isinstance(cap_list, str):
                doc_caption = cap_list.strip()
            # 与 full_markdown 中占位符一致，便于后续定位与替换
            img_name = Path(img_path).name or f"page{page_num}_img{idx}.jpg"
            ref_path = f"images/{img_name}" if "images/" not in (img_path or "") else (img_path or "").replace("\\", "/")
            markdown_ref = f"![]({ref_path})"
            extracted_images.append({
                "page": page_num,
                "image_index": idx,
                "image_bytes": image_bytes,
                "image_path": img_name,
                "markdown_ref": markdown_ref,
                "metadata": {
                    "extracted_from": "mineru-api",
                    "page": page_num,
                    "document_caption": doc_caption or None,
                },
            })

        # 按 page_idx 分组构建 pages
        by_page: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
        for item in content_list:
            by_page[int(item.get("page_idx", 0))].append(item)
        total_pages = max(by_page.keys(), default=-1) + 1
        if total_pages <= 0:
            total_pages = 1
        pages_content: List[Dict[str, Any]] = []
        for page_idx in range(total_pages):
            items = by_page.get(page_idx, [])
            parts = []
            page_images = [e for e in extracted_images if e["metadata"].get("page") == page_idx + 1]
            for it in items:
                ty = it.get("type")
                if ty == "text" or ty == "title":
                    t = it.get("text") or it.get("content") or ""
                    if t:
                        parts.append(t)
                elif ty == "table":
                    body = it.get("table_body") or it.get("content") or ""
                    if body:
                        parts.append("\n\n" + body + "\n\n")
                elif ty == "equation":
                    t = it.get("text") or it.get("content") or ""
                    if t:
                        parts.append("\n\n$$" + t + "$$\n\n")
            page_md = "\n\n".join(parts).strip()
            pages_content.append({
                "page": page_idx + 1,
                "markdown": page_md,
                "text": page_md,
                "images": page_images,
                "metadata": {"parser": "mineru-api"},
            })

        if extracted_images:
            logger.info("MinerU API 从文档中提取 %d 张图片", len(extracted_images))

        return {
            "file_type": file_type,
            "markdown": full_markdown or "\n\n".join(p["markdown"] for p in pages_content).strip(),
            "pages": pages_content,
            "extracted_images": extracted_images,
            "total_pages": total_pages,
            "metadata": {
                "parser": "mineru-api",
                "extracted_at": datetime.utcnow().isoformat() + "Z",
            },
        }
    return None


def parse_pdf_via_api(
    file_content: bytes,
    file_path: str,
    token: str,
    poll_interval: int = MINERU_API_POLL_INTERVAL,
    poll_timeout: int = MINERU_API_POLL_TIMEOUT,
) -> Optional[Dict[str, Any]]:
    """通过 MinerU API 解析 PDF，返回与 parse_pdf 兼容的结构；失败返回 None。"""
    return _parse_via_api_impl(
        file_content, file_path, token, "pdf", poll_interval, poll_timeout
    )


def parse_docx_via_api(
    file_content: bytes,
    file_path: str,
    token: str,
    poll_interval: int = MINERU_API_POLL_INTERVAL,
    poll_timeout: int = MINERU_API_POLL_TIMEOUT,
) -> Optional[Dict[str, Any]]:
    """通过 MinerU API 解析 Word(docx)，返回与 parse_pdf 兼容的结构；失败返回 None。"""
    return _parse_via_api_impl(
        file_content, file_path, token, "docx", poll_interval, poll_timeout
    )


def parse_pptx_via_api(
    file_content: bytes,
    file_path: str,
    token: str,
    poll_interval: int = MINERU_API_POLL_INTERVAL,
    poll_timeout: int = MINERU_API_POLL_TIMEOUT,
) -> Optional[Dict[str, Any]]:
    """通过 MinerU API 解析 PPTX，返回与 parse_pdf 兼容的结构；失败返回 None。"""
    return _parse_via_api_impl(
        file_content, file_path, token, "pptx", poll_interval, poll_timeout
    )


def get_mineru_client(enable: bool = True) -> Optional[Any]:
    """
    获取 MinerU 客户端实例（懒加载）。
    需要已安装 mineru-vl-utils[transformers] 且 Python 3.10+。
    """
    global _mineru_client
    if not enable:
        return None
    if _mineru_client is not None:
        return _mineru_client
    try:
        from app.core.config import settings
        if getattr(settings, "mineru_pdf_enabled", True) is False:
            return None
    except Exception:
        pass
    try:
        from transformers import AutoProcessor, Qwen2VLForConditionalGeneration
        from mineru_vl_utils import MinerUClient  # type: ignore[import-untyped]

        try:
            model = Qwen2VLForConditionalGeneration.from_pretrained(
                MODEL_ID,
                dtype="auto",
                device_map="auto",
            )
        except TypeError:
            model = Qwen2VLForConditionalGeneration.from_pretrained(
                MODEL_ID,
                torch_dtype="auto",
                device_map="auto",
            )
        processor = AutoProcessor.from_pretrained(MODEL_ID, use_fast=True)
        _mineru_client = MinerUClient(
            backend="transformers",
            model=model,
            processor=processor,
        )
        logger.info("MinerU2.5 客户端初始化成功")
        return _mineru_client
    except ImportError as e:
        logger.debug("MinerU 不可用（未安装 mineru-vl-utils）: %s", e)
        return None
    except Exception as e:
        logger.warning("MinerU 客户端初始化失败: %s", e)
        return None


def parse_pdf(file_content: bytes) -> Dict[str, Any]:
    """
    使用 MinerU2.5 解析 PDF，返回与 PaddleOCR 兼容的结果结构。
    调用方应在 executor 中执行（同步阻塞）。
    """
    client = get_mineru_client()
    if not client:
        raise ValueError("MinerU 客户端不可用")

    try:
        from app.core.config import settings
        dpi = getattr(settings, "mineru_pdf_render_dpi", None) or _PDF_DPI_DEFAULT
    except Exception:
        dpi = _PDF_DPI_DEFAULT
    dpi = max(72, min(600, int(dpi)))
    images = _pdf_bytes_to_images(file_content, dpi=dpi)
    total_pages = len(images)
    pages_content = []
    markdown_parts = []
    extracted_images: List[Dict[str, Any]] = []

    for idx, img in enumerate(images):
        page_num = idx + 1
        logger.info("MinerU 解析第 %d/%d 页", page_num, total_pages)
        blocks = client.two_step_extract(img)
        page_md = _blocks_to_markdown(blocks, page_num=page_num, include_page_header=False)
        # 从 image 类型块按 bbox 裁剪出图片，供后续 VLM/向量化
        page_images = _extract_image_crops(img, blocks, page_num)
        extracted_images.extend(page_images)
        pages_content.append({
            "page": page_num,
            "markdown": page_md,
            "text": page_md,
            "images": page_images,
            "metadata": {"parser": "mineru-vl-2.5"},
        })
        if page_md.strip():
            if markdown_parts:
                markdown_parts.append(f"\n\n---\n\n## 第 {page_num} 页\n\n")
            markdown_parts.append(page_md)

    full_markdown = "\n\n".join(markdown_parts).strip() if markdown_parts else ""
    if extracted_images:
        logger.info("MinerU 从 PDF 中提取 %d 张图片", len(extracted_images))

    return {
        "file_type": "pdf",
        "markdown": full_markdown,
        "pages": pages_content,
        "extracted_images": extracted_images,
        "total_pages": total_pages,
        "metadata": {
            "parser": "mineru-vl-2.5",
            "extracted_at": datetime.utcnow().isoformat() + "Z",
        },
    }


def parse_docx(file_content: bytes) -> Dict[str, Any]:
    """
    使用 MinerU2.5 解析 Word(docx)：先通过 LibreOffice 转为 PDF 再按页渲染为图，逐页 MinerU 提取。
    返回与 parse_pdf 兼容的结果结构。调用方应在 executor 中执行（同步阻塞）。
    """
    client = get_mineru_client()
    if not client:
        raise ValueError("MinerU 客户端不可用")
    try:
        from app.core.config import settings
        dpi = getattr(settings, "mineru_pdf_render_dpi", None) or _PDF_DPI_DEFAULT
    except Exception:
        dpi = _PDF_DPI_DEFAULT
    dpi = max(72, min(600, int(dpi)))
    images = _office_bytes_to_images(file_content, "docx", dpi=dpi)
    if not images:
        raise ValueError("LibreOffice 不可用或 docx 转 PDF 失败，无法使用本地 MinerU 解析 docx")
    return _parse_office_images_to_result(client, images, "docx", "mineru-vl-2.5")


def parse_pptx(file_content: bytes) -> Dict[str, Any]:
    """
    使用 MinerU2.5 解析 PPTX：先通过 LibreOffice 转为 PDF 再按页渲染为图，逐页 MinerU 提取。
    返回与 parse_pdf 兼容的结果结构。调用方应在 executor 中执行（同步阻塞）。
    """
    client = get_mineru_client()
    if not client:
        raise ValueError("MinerU 客户端不可用")
    try:
        from app.core.config import settings
        dpi = getattr(settings, "mineru_pdf_render_dpi", None) or _PDF_DPI_DEFAULT
    except Exception:
        dpi = _PDF_DPI_DEFAULT
    dpi = max(72, min(600, int(dpi)))
    images = _office_bytes_to_images(file_content, "pptx", dpi=dpi)
    if not images:
        raise ValueError("LibreOffice 不可用或 pptx 转 PDF 失败，无法使用本地 MinerU 解析 pptx")
    return _parse_office_images_to_result(client, images, "pptx", "mineru-vl-2.5")


def _parse_office_images_to_result(
    client: Any,
    images: List[Any],
    file_type: str,
    parser_tag: str,
) -> Dict[str, Any]:
    """将多页 PIL 图像用 MinerU 逐页提取，返回统一结构（markdown、pages、extracted_images）。"""
    total_pages = len(images)
    pages_content = []
    markdown_parts = []
    extracted_images: List[Dict[str, Any]] = []
    for idx, img in enumerate(images):
        page_num = idx + 1
        logger.info("MinerU 解析 %s 第 %d/%d 页", file_type, page_num, total_pages)
        blocks = client.two_step_extract(img)
        page_md = _blocks_to_markdown(blocks, page_num=page_num, include_page_header=False)
        page_images = _extract_image_crops(img, blocks, page_num)
        extracted_images.extend(page_images)
        pages_content.append({
            "page": page_num,
            "markdown": page_md,
            "text": page_md,
            "images": page_images,
            "metadata": {"parser": parser_tag},
        })
        if page_md.strip():
            if markdown_parts:
                markdown_parts.append(f"\n\n---\n\n## 第 {page_num} 页\n\n")
            markdown_parts.append(page_md)
    full_markdown = "\n\n".join(markdown_parts).strip() if markdown_parts else ""
    if extracted_images:
        logger.info("MinerU 从 %s 中提取 %d 张图片", file_type, len(extracted_images))
    return {
        "file_type": file_type,
        "markdown": full_markdown,
        "pages": pages_content,
        "extracted_images": extracted_images,
        "total_pages": total_pages,
        "metadata": {
            "parser": parser_tag,
            "extracted_at": datetime.utcnow().isoformat() + "Z",
        },
    }
