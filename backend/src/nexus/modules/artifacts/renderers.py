from __future__ import annotations

import csv
import html
import io
import json
from typing import Any

from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from nexus.shared.domain.errors import ValidationError


def render_artifact(document: dict[str, Any], format_name: str) -> tuple[bytes, str, str]:
    """Render one canonical revision without creating a competing source of truth."""
    if format_name == "json":
        return (
            json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8"),
            "application/json",
            "json",
        )
    markdown = artifact_markdown(document)
    if format_name == "markdown":
        return markdown.encode("utf-8"), "text/markdown; charset=utf-8", "md"
    if format_name == "html":
        body = _artifact_html(document)
        return body.encode("utf-8"), "text/html; charset=utf-8", "html"
    if format_name == "pdf":
        return _artifact_pdf(document), "application/pdf", "pdf"
    if format_name == "csv":
        return _artifact_csv(document), "text/csv; charset=utf-8", "csv"
    if format_name == "xlsx":
        return (
            _artifact_xlsx(document),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xlsx",
        )
    raise ValidationError("Unsupported Artifact render format", details={"format": format_name})


def artifact_markdown(document: dict[str, Any]) -> str:
    lines: list[str] = []
    for block in _blocks(document):
        block_type = block.get("type")
        if block_type == "heading":
            lines.append(
                f"{'#' * max(1, min(6, int(block.get('level', 1))))} {block.get('text', '')}"
            )
        elif block_type == "paragraph":
            lines.append(str(block.get("text", "")))
        elif block_type == "evidence_list":
            for item in block.get("items", []):
                if isinstance(item, dict):
                    lines.append(
                        f"- {item.get('source', 'source')} "
                        f"[evidence:{item.get('evidence_revision_id', '')}]"
                    )
        elif block_type == "table":
            columns, rows = _table_data(block)
            lines.append("| " + " | ".join(map(str, columns)) + " |")
            lines.append("| " + " | ".join("---" for _ in columns) + " |")
            for row in rows:
                lines.append("| " + " | ".join(str(value) for value in row) + " |")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _artifact_html(document: dict[str, Any]) -> str:
    parts = [
        '<!doctype html><html><head><meta charset="utf-8"><title>',
        html.escape(str(document.get("title", "Artifact"))),
        "</title></head><body>",
    ]
    for block in _blocks(document):
        block_type = block.get("type")
        if block_type == "heading":
            level = max(1, min(6, int(block.get("level", 1))))
            parts.append(f"<h{level}>{html.escape(str(block.get('text', '')))}</h{level}>")
        elif block_type == "paragraph":
            parts.append(f"<p>{html.escape(str(block.get('text', '')))}</p>")
        elif block_type == "evidence_list":
            parts.append("<ul>")
            for item in block.get("items", []):
                if isinstance(item, dict):
                    evidence_id = item.get("evidence_revision_id", "")
                    label = f"{item.get('source', 'source')} [evidence:{evidence_id}]"
                    parts.append(f"<li>{html.escape(label)}</li>")
            parts.append("</ul>")
        elif block_type == "table":
            columns, rows = _table_data(block)
            parts.append("<table><thead><tr>")
            parts.extend(f"<th>{html.escape(str(value))}</th>" for value in columns)
            parts.append("</tr></thead><tbody>")
            for row in rows:
                parts.append("<tr>")
                parts.extend(f"<td>{html.escape(str(value))}</td>" for value in row)
                parts.append("</tr>")
            parts.append("</tbody></table>")
    parts.append("</body></html>")
    return "".join(parts)


def _artifact_pdf(document: dict[str, Any]) -> bytes:
    output = io.BytesIO()
    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        font_name = "STSong-Light"
    except Exception:
        font_name = "Helvetica"
    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "NexusBody", parent=styles["BodyText"], fontName=font_name, leading=16, alignment=TA_LEFT
    )
    title_style = ParagraphStyle(
        "NexusTitle", parent=styles["Heading1"], fontName=font_name, leading=24
    )
    story: list[Any] = []
    for block in _blocks(document):
        block_type = block.get("type")
        if block_type == "heading":
            story.append(Paragraph(html.escape(str(block.get("text", ""))), title_style))
        elif block_type == "paragraph":
            story.append(Paragraph(html.escape(str(block.get("text", ""))), body_style))
        elif block_type == "evidence_list":
            for item in block.get("items", []):
                if isinstance(item, dict):
                    evidence_id = item.get("evidence_revision_id", "")
                    label = f"• {item.get('source', 'source')} [evidence:{evidence_id}]"
                    story.append(Paragraph(html.escape(label), body_style))
        elif block_type == "table":
            columns, rows = _table_data(block)
            table = Table([columns, *rows], repeatRows=1)
            table.setStyle(
                TableStyle(
                    [
                        ("FONTNAME", (0, 0), (-1, -1), font_name),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DCE7E5")),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#73817F")),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ]
                )
            )
            story.append(table)
        story.append(Spacer(1, 10))
    SimpleDocTemplate(output, pagesize=A4, title=str(document.get("title", "Artifact"))).build(
        story
    )
    return output.getvalue()


def _artifact_csv(document: dict[str, Any]) -> bytes:
    tables = [block for block in _blocks(document) if block.get("type") == "table"]
    if not tables:
        raise ValidationError("CSV export requires at least one table block")
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    for index, block in enumerate(tables):
        columns, rows = _table_data(block)
        if index:
            writer.writerow([])
        writer.writerow(columns)
        writer.writerows(rows)
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def _artifact_xlsx(document: dict[str, Any]) -> bytes:
    tables = [block for block in _blocks(document) if block.get("type") == "table"]
    if not tables:
        raise ValidationError("XLSX export requires at least one table block")
    workbook = Workbook()
    workbook.remove(workbook.active)
    for index, block in enumerate(tables, start=1):
        title = str(block.get("title") or f"Table {index}")[:31]
        sheet = workbook.create_sheet(title=title)
        columns, rows = _table_data(block)
        sheet.append(columns)
        for row in rows:
            sheet.append(row)
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def _blocks(document: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in document.get("blocks", []) if isinstance(item, dict)]


def _table_data(block: dict[str, Any]) -> tuple[list[Any], list[list[Any]]]:
    columns = list(block.get("columns") or [])
    rows = [list(row) for row in block.get("rows", []) if isinstance(row, (list, tuple))]
    if not columns:
        width = max((len(row) for row in rows), default=0)
        columns = [f"Column {index + 1}" for index in range(width)]
    normalized = [(row + [None] * len(columns))[: len(columns)] for row in rows]
    return columns, normalized
