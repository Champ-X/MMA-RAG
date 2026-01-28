"""
文件解析器工厂模式
支持多种文件格式的差异化解析
"""

from typing import Dict, List, Any, Optional, Union, Protocol
from abc import ABC, abstractmethod
from enum import Enum
import asyncio
from pathlib import Path
import uuid

from app.core.logger import get_logger

logger = get_logger(__name__)

class FileType(Enum):
    """文件类型枚举"""
    PDF = "pdf"
    DOCX = "docx"
    DOC = "doc"
    TXT = "txt"
    MD = "md"
    IMAGE = "image"
    UNKNOWN = "unknown"

class DocumentParser(ABC):
    """文档解析器基类"""
    
    @abstractmethod
    async def parse(self, file_content: bytes, file_path: str) -> Dict[str, Any]:
        """
        解析文件内容
        
        Args:
            file_content: 文件二进制内容
            file_path: 文件路径
            
        Returns:
            解析结果字典
        """
        pass
    
    @abstractmethod
    def supports_file_type(self) -> FileType:
        """支持的文件类型"""
        pass

class PDFParser(DocumentParser):
    """PDF文档解析器"""
    
    def __init__(self):
        self.supported_formats = ["pdf"]
    
    def supports_file_type(self) -> FileType:
        return FileType.PDF
    
    async def parse(self, file_content: bytes, file_path: str) -> Dict[str, Any]:
        """解析PDF文件"""
        try:
            import fitz  # PyMuPDF
            
            # 保存临时文件
            temp_file = f"/tmp/{uuid.uuid4()}.pdf"
            with open(temp_file, "wb") as f:
                f.write(file_content)
            
            # 使用PyMuPDF解析
            doc = fitz.open(temp_file)
            total_pages = len(doc)
            pages_content = []
            tables = []
            
            for page_num in range(total_pages):
                page = doc.load_page(page_num)
                
                # 提取文本
                text = page.get_text()
                
                # 尝试提取表格（使用pdfplumber，如果可用）
                try:
                    import pdfplumber  # type: ignore
                    with pdfplumber.open(temp_file) as pdf:
                        pdf_page = pdf.pages[page_num]
                        tables_on_page = pdf_page.find_tables()
                        for table in tables_on_page:
                            table_data = table.extract()
                            if table_data:
                                tables.append(table_data)
                except (ImportError, Exception):
                    # pdfplumber不可用或提取失败，跳过表格提取
                    pass
                
                pages_content.append({
                    "page": page_num + 1,
                    "text": text,
                    "metadata": {
                        "width": page.rect.width,
                        "height": page.rect.height
                    }
                })
            
            doc.close()
            
            # 清理临时文件
            Path(temp_file).unlink(missing_ok=True)
            
            return {
                "file_type": "pdf",
                "pages": pages_content,
                "tables": tables,
                "total_pages": total_pages,
                "metadata": {
                    "extracted_at": "2024-01-01T00:00:00Z"
                }
            }
            
        except Exception as e:
            logger.error(f"PDF解析失败: {str(e)}")
            raise
    
    async def parse_with_pymupdf4llm(self, file_content: bytes, file_path: str) -> Dict[str, Any]:
        """使用pymupdf4llm解析（如果可用）"""
        try:
            import pymupdf4llm
            
            # 保存临时文件
            temp_file = f"/tmp/{uuid.uuid4()}.pdf"
            with open(temp_file, "wb") as f:
                f.write(file_content)
            
            # 使用pymupdf4llm解析
            md_text = pymupdf4llm.to_markdown(temp_file)
            
            # 清理临时文件
            Path(temp_file).unlink(missing_ok=True)
            
            return {
                "file_type": "pdf",
                "markdown": md_text,
                "pages": [{"page": 1, "text": md_text}],
                "metadata": {
                    "parser": "pymupdf4llm",
                    "extracted_at": "2024-01-01T00:00:00Z"
                }
            }
            
        except ImportError:
            logger.warning("pymupdf4llm不可用，使用PyMuPDF")
            return await self.parse(file_content, file_path)
        except Exception as e:
            logger.error(f"pymupdf4llm解析失败: {str(e)}")
            return await self.parse(file_content, file_path)

class DocxParser(DocumentParser):
    """DOCX文档解析器"""
    
    def supports_file_type(self) -> FileType:
        return FileType.DOCX
    
    async def parse(self, file_content: bytes, file_path: str) -> Dict[str, Any]:
        """解析DOCX文件"""
        try:
            from docx import Document
            import io
            
            # 读取DOCX内容
            doc = Document(io.BytesIO(file_content))
            
            paragraphs = []
            tables = []
            
            # 提取段落
            for para in doc.paragraphs:
                if para.text.strip():
                    paragraphs.append({
                        "text": para.text.strip(),
                        "style": para.style.name if para.style else "Normal"
                    })
            
            # 提取表格
            for table in doc.tables:
                table_data = []
                for row in table.rows:
                    row_data = []
                    for cell in row.cells:
                        row_data.append(cell.text.strip())
                    table_data.append(row_data)
                tables.append(table_data)
            
            return {
                "file_type": "docx",
                "paragraphs": paragraphs,
                "tables": tables,
                "metadata": {
                    "total_paragraphs": len(paragraphs),
                    "total_tables": len(tables),
                    "extracted_at": "2024-01-01T00:00:00Z"
                }
            }
            
        except Exception as e:
            logger.error(f"DOCX解析失败: {str(e)}")
            raise

class TextParser(DocumentParser):
    """文本文件解析器"""
    
    def supports_file_type(self) -> FileType:
        return FileType.TXT
    
    async def parse(self, file_content: bytes, file_path: str) -> Dict[str, Any]:
        """解析文本文件"""
        try:
            # 检测编码
            content = file_content.decode('utf-8', errors='ignore')
            
            # 简单分段落
            paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
            
            return {
                "file_type": "txt",
                "content": content,
                "paragraphs": [{"text": para} for para in paragraphs],
                "metadata": {
                    "encoding": "utf-8",
                    "total_characters": len(content),
                    "total_paragraphs": len(paragraphs),
                    "extracted_at": "2024-01-01T00:00:00Z"
                }
            }
            
        except Exception as e:
            logger.error(f"文本文件解析失败: {str(e)}")
            raise

class MarkdownParser(DocumentParser):
    """Markdown文档解析器"""
    
    def supports_file_type(self) -> FileType:
        return FileType.MD
    
    async def parse(self, file_content: bytes, file_path: str) -> Dict[str, Any]:
        """解析Markdown文件"""
        try:
            content = file_content.decode('utf-8', errors='ignore')
            
            # 使用markdown库解析
            import markdown
            
            html_content = markdown.markdown(content)
            
            # 提取结构化信息
            lines = content.split('\n')
            headers = []
            code_blocks = []
            current_code_block = []
            in_code_block = False
            
            for line in lines:
                # 检测标题
                if line.startswith('#'):
                    headers.append({
                        "level": len(line) - len(line.lstrip('#')),
                        "text": line.lstrip('#').strip()
                    })
                
                # 检测代码块
                if line.strip().startswith('```'):
                    if in_code_block:
                        if current_code_block:
                            code_blocks.append('\n'.join(current_code_block))
                            current_code_block = []
                    in_code_block = not in_code_block
                elif in_code_block:
                    current_code_block.append(line)
            
            if current_code_block:
                code_blocks.append('\n'.join(current_code_block))
            
            # 生成智能段落：将标题和紧随的内容绑定在一起
            paragraphs = self._build_smart_paragraphs(content, headers)
            
            return {
                "file_type": "md",
                "content": content,
                "html_content": html_content,
                "headers": headers,
                "code_blocks": code_blocks,
                "paragraphs": paragraphs,  # 添加智能段落
                "metadata": {
                    "total_headers": len(headers),
                    "total_code_blocks": len(code_blocks),
                    "total_paragraphs": len(paragraphs),
                    "extracted_at": "2024-01-01T00:00:00Z"
                }
            }
            
        except Exception as e:
            logger.error(f"Markdown解析失败: {str(e)}")
            raise
    
    def _build_smart_paragraphs(self, content: str, headers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """构建智能段落：将标题和紧随的内容绑定在一起
        
        策略：
        1. 标题总是和紧随其后的内容绑定在一起
        2. 遇到新的标题时，结束当前段落并开始新段落
        3. 代码块作为独立段落处理
        4. 空行用于分隔段落，但如果标题后只有空行，继续等待内容
        
        Args:
            content: Markdown内容
            headers: 标题列表（用于参考，实际从内容中解析）
            
        Returns:
            段落列表，每个段落包含标题（如果有）和内容
        """
        lines = content.split('\n')
        paragraphs = []
        current_paragraph = []
        current_header = None
        in_code_block = False
        code_block_language = None
        
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped_line = line.strip()
            
            # 检测代码块
            if stripped_line.startswith('```'):
                if in_code_block:
                    # 结束代码块
                    current_paragraph.append(line)
                    # 保存代码块段落
                    paragraph_text = '\n'.join(current_paragraph).strip()
                    if paragraph_text:
                        paragraphs.append({
                            "text": paragraph_text,
                            "header": None,  # 代码块不绑定标题
                            "has_code": True
                        })
                    current_paragraph = []
                    in_code_block = False
                    code_block_language = None
                else:
                    # 开始代码块
                    # 如果当前有段落，先保存（不包含代码块开始标记）
                    if current_paragraph:
                        paragraph_text = '\n'.join(current_paragraph).strip()
                        if paragraph_text:
                            paragraphs.append({
                                "text": paragraph_text,
                                "header": current_header,
                                "has_code": False
                            })
                        current_paragraph = []
                        current_header = None
                    # 开始新的代码块段落
                    in_code_block = True
                    code_block_language = stripped_line[3:].strip()  # 提取语言标识
                    current_paragraph = [line]
                i += 1
                continue
            
            if in_code_block:
                # 在代码块中，直接添加
                current_paragraph.append(line)
                i += 1
                continue
            
            # 检测标题
            if line.startswith('#'):
                # 如果当前有段落，先保存
                if current_paragraph:
                    paragraph_text = '\n'.join(current_paragraph).strip()
                    if paragraph_text:
                        paragraphs.append({
                            "text": paragraph_text,
                            "header": current_header,
                            "has_code": False
                        })
                    current_paragraph = []
                
                # 提取标题信息
                header_level = len(line) - len(line.lstrip('#'))
                header_text = line.lstrip('#').strip()
                current_header = {
                    "level": header_level,
                    "text": header_text
                }
                
                # 标题本身作为段落的第一行
                current_paragraph.append(line)
                i += 1
                continue
            
            # 空行处理
            if not stripped_line:
                # 检查下一行是否是标题
                if i + 1 < len(lines):
                    next_line = lines[i + 1]
                    if next_line.startswith('#'):
                        # 下一行是标题，结束当前段落（不包含这个空行）
                        if current_paragraph:
                            paragraph_text = '\n'.join(current_paragraph).strip()
                            if paragraph_text:
                                paragraphs.append({
                                    "text": paragraph_text,
                                    "header": current_header,
                                    "has_code": False
                                })
                            current_paragraph = []
                            current_header = None
                        i += 1
                        continue
                    else:
                        # 下一行不是标题，空行可能是段落分隔符
                        # 但如果当前段落只有标题，继续等待内容
                        non_empty_lines = [l for l in current_paragraph if l.strip()]
                        if len(non_empty_lines) == 1 and non_empty_lines[0].startswith('#'):
                            # 只有标题，添加空行并继续
                            current_paragraph.append(line)
                            i += 1
                            continue
                        else:
                            # 有内容，空行作为段落分隔符
                            # 但先不结束，看看后面是否还有内容
                            # 如果连续两个空行，结束段落
                            if i + 1 < len(lines) and not lines[i + 1].strip():
                                # 连续两个空行，结束段落
                                if current_paragraph:
                                    paragraph_text = '\n'.join(current_paragraph).strip()
                                    if paragraph_text:
                                        paragraphs.append({
                                            "text": paragraph_text,
                                            "header": current_header,
                                            "has_code": False
                                        })
                                    current_paragraph = []
                                    current_header = None
                                i += 2  # 跳过两个空行
                                continue
                            else:
                                # 单个空行，添加到当前段落
                                current_paragraph.append(line)
                                i += 1
                                continue
                else:
                    # 最后一行是空行，结束当前段落
                    if current_paragraph:
                        paragraph_text = '\n'.join(current_paragraph).strip()
                        if paragraph_text:
                            paragraphs.append({
                                "text": paragraph_text,
                                "header": current_header,
                                "has_code": False
                            })
                        current_paragraph = []
                        current_header = None
                    i += 1
                    continue
            
            # 普通内容行
            current_paragraph.append(line)
            i += 1
        
        # 处理最后一个段落
        if current_paragraph:
            paragraph_text = '\n'.join(current_paragraph).strip()
            if paragraph_text:
                paragraphs.append({
                    "text": paragraph_text,
                    "header": current_header,
                    "has_code": in_code_block
                })
        
        return paragraphs

class ImageParser(DocumentParser):
    """图片解析器（用于生成描述）"""
    
    def supports_file_type(self) -> FileType:
        return FileType.IMAGE
    
    async def parse(self, file_content: bytes, file_path: str) -> Dict[str, Any]:
        """解析图片文件"""
        try:
            import base64
            import io
            from PIL import Image
            
            # 获取图片信息
            image = Image.open(io.BytesIO(file_content))
            
            # 转换为base64用于VLM处理
            base64_content = base64.b64encode(file_content).decode('utf-8')
            
            return {
                "file_type": "image",
                "width": image.width,
                "height": image.height,
                "format": image.format,
                "mode": image.mode,
                "base64_content": base64_content,
                "metadata": {
                    "size_bytes": len(file_content),
                    "aspect_ratio": round(image.width / image.height, 2) if image.height > 0 else 0,
                    "extracted_at": "2024-01-01T00:00:00Z"
                }
            }
            
        except Exception as e:
            logger.error(f"图片解析失败: {str(e)}")
            raise

class ParserFactory:
    """解析器工厂"""
    
    _parsers: Dict[FileType, DocumentParser] = {
        FileType.PDF: PDFParser(),
        FileType.DOCX: DocxParser(),
        FileType.TXT: TextParser(),
        FileType.MD: MarkdownParser(),
        FileType.IMAGE: ImageParser()
    }
    
    @classmethod
    def detect_file_type(cls, file_path: str, file_content: bytes) -> FileType:
        """检测文件类型"""
        file_ext = Path(file_path).suffix.lower().lstrip('.')
        
        # 基于文件扩展名检测
        if file_ext in ["pdf"]:
            return FileType.PDF
        elif file_ext in ["docx"]:
            return FileType.DOCX
        elif file_ext in ["doc"]:
            return FileType.DOC
        elif file_ext in ["txt"]:
            return FileType.TXT
        elif file_ext in ["md", "markdown"]:
            return FileType.MD
        elif file_ext in ["jpg", "jpeg", "png", "gif", "bmp", "tiff"]:
            return FileType.IMAGE
        
        # 基于内容检测（简单实现）
        try:
            # 尝试检测PDF
            if file_content.startswith(b'%PDF'):
                return FileType.PDF
            
            # 尝试检测图片文件头
            if file_content.startswith((b'\xff\xd8\xff', b'\x89PNG', b'GIF', b'BM')):
                return FileType.IMAGE
        except:
            pass
        
        return FileType.UNKNOWN
    
    @classmethod
    def get_parser(cls, file_type: FileType) -> Optional[DocumentParser]:
        """获取解析器"""
        return cls._parsers.get(file_type)
    
    @classmethod
    def register_parser(cls, file_type: FileType, parser: DocumentParser):
        """注册解析器"""
        cls._parsers[file_type] = parser
        logger.info(f"注册解析器: {file_type.value}")
    
    @classmethod
    async def parse_file(
        cls, 
        file_content: bytes, 
        file_path: str
    ) -> Dict[str, Any]:
        """解析文件"""
        file_type = cls.detect_file_type(file_path, file_content)
        
        if file_type == FileType.UNKNOWN:
            raise ValueError(f"不支持的文件类型: {file_path}")
        
        parser = cls.get_parser(file_type)
        if not parser:
            raise ValueError(f"没有找到 {file_type.value} 的解析器")
        
        logger.info(f"开始解析文件: {file_path}, 类型: {file_type.value}")
        result = await parser.parse(file_content, file_path)
        
        # 添加文件信息
        result["file_info"] = {
            "file_path": file_path,
            "file_type": file_type.value,
            "file_size": len(file_content)
        }
        
        return result
    
    @classmethod
    def list_supported_types(cls) -> List[str]:
        """列出支持的文件类型"""
        return [ptype.value for ptype in cls._parsers.keys()]