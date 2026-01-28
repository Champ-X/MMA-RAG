"""
多模态格式化器
为不同类型的内容生成标准化的格式模板
"""

from typing import Dict, List, Any, Optional
import re

from app.core.logger import get_logger

logger = get_logger(__name__)

class MultiModalFormatter:
    """多模态内容格式化器"""
    
    def __init__(self):
        # 格式化模板
        self.templates = {
            "document_chunk": self._get_document_chunk_template(),
            "image_content": self._get_image_content_template()
        }
    
    def _get_document_chunk_template(self) -> str:
        """文档块模板"""
        return """【材料 {index}】 (类型: 文档 | 来源: {file_path})
内容片段：
{content}"""
    
    def _get_image_content_template(self) -> str:
        """图片内容模板"""
        return """【材料 {index}】 (类型: 图片 | 来源: {file_path})
[视觉描述]：
{caption}"""
    
    def format_document_chunk(
        self,
        index: str,
        content: str,
        file_path: str,
        metadata: Dict[str, Any]
    ) -> str:
        """格式化文档块"""
        try:
            # 清理内容
            cleaned_content = self._clean_content(content)
            
            # 截断过长内容
            max_length = 500
            if len(cleaned_content) > max_length:
                cleaned_content = cleaned_content[:max_length] + "..."
            
            # 使用模板格式化
            formatted = self.templates["document_chunk"].format(
                index=index,
                file_path=file_path,
                content=cleaned_content
            )
            
            return formatted
            
        except Exception as e:
            logger.error(f"文档块格式化失败: {str(e)}")
            return f"【材料 {index}】 (类型: 文档 | 来源: {file_path})\n内容片段：格式化失败"
    
    def format_image_content(
        self,
        index: str,
        caption: str,
        file_path: str,
        metadata: Dict[str, Any]
    ) -> str:
        """格式化图片内容"""
        try:
            # 清理描述
            cleaned_caption = self._clean_content(caption)
            
            # 截断过长描述
            max_length = 300
            if len(cleaned_caption) > max_length:
                cleaned_caption = cleaned_caption[:max_length] + "..."
            
            # 使用模板格式化
            formatted = self.templates["image_content"].format(
                index=index,
                file_path=file_path,
                caption=cleaned_caption
            )
            
            return formatted
            
        except Exception as e:
            logger.error(f"图片内容格式化失败: {str(e)}")
            return f"【材料 {index}】 (类型: 图片 | 来源: {file_path})\n[视觉描述]：格式化失败"
    
    def _clean_content(self, content: str) -> str:
        """清理内容"""
        try:
            # 确保 content 是字符串类型
            if not isinstance(content, str):
                content = str(content) if content is not None else ""
            
            if not content:
                return ""
            
            # 移除多余的空白字符
            content = re.sub(r'\s+', ' ', content)
            
            # 使用更安全的字符类：明确列出要保留的字符
            # 保留：字母、数字、空格、基本标点符号
            # 注意：在字符类中，] 需要放在开头或转义，[ 和 - 需要转义
            # 使用更简单的方法：先移除明显不需要的字符
            try:
                # 尝试使用原始正则表达式
                content = re.sub(r'[^\w\s\.\,\;\:\!\?\-\(\)\[\]""''/\\]', ' ', content)
            except re.error:
                # 如果正则表达式失败，使用字符过滤方法
                import string
                allowed_chars = set(string.ascii_letters + string.digits + 
                                  ' .,;:!?-()[]"\'\'/\\' + 
                                  '\u4e00-\u9fff')  # 中文字符范围
                content = ''.join(c if c in allowed_chars or ('\u4e00' <= c <= '\u9fff') else ' ' 
                                 for c in content)
            
            # 清理首尾空白
            content = content.strip()
            
            return content
            
        except Exception as e:
            logger.error(f"内容清理失败: {str(e)}")
            # 返回原始内容或空字符串
            try:
                return str(content) if content is not None else ""
            except:
                return ""
    
    def format_reference_list(self, references: List[Dict[str, Any]]) -> str:
        """格式化引用列表"""
        try:
            formatted_references = []
            
            for ref in references:
                if ref["content_type"] == "doc":
                    formatted_references.append(
                        self.format_document_chunk(
                            index=ref["id"],
                            content=ref["content"],
                            file_path=ref["file_path"],
                            metadata=ref["metadata"]
                        )
                    )
                else:  # image
                    formatted_references.append(
                        self.format_image_content(
                            index=ref["id"],
                            caption=ref["content"],
                            file_path=ref["file_path"],
                            metadata=ref["metadata"]
                        )
                    )
            
            return "\n\n".join(formatted_references)
            
        except Exception as e:
            logger.error(f"引用列表格式化失败: {str(e)}")
            return "引用列表格式化失败"
    
    def parse_references_from_text(self, text: str) -> List[str]:
        """从文本中解析引用编号"""
        try:
            # 查找引用格式 [数字]
            ref_pattern = r'\[(\d+)\]'
            matches = re.findall(ref_pattern, text)
            return list(set(matches))  # 去重
            
        except Exception as e:
            logger.error(f"解析引用失败: {str(e)}")
            return []
    
    def format_system_instructions(self, context_type: str = "general") -> str:
        """格式化系统指令"""
        try:
            instructions = {
                "general": """
# 角色设定
你是一个基于多模态知识库的智能助手。你的任务是结合下方的【参考材料】来准确回答用户的问题。

# 核心指令
1. **严格引用机制**：
   - 你回答中的每一个事实陈述，**必须**在句末标注来源编号。
   - 引用格式严格为 `[id]`（例如 `[1]` 或 `[2]`）。
   - 禁止凭空捏造引用编号。

2. **多模态感知与描述**：
   - 如果你参考了标记为 `(类型: 图片)` 的材料，请在回答中明确指出。
   - 示例："如图 [2] 所示，该季度的增长趋势..." 或 "从图表 [2] 中可以看出..."。
   - 请结合图片下方的 `[视觉描述]` 内容来解析图片含义。

3. **回答原则**：
   - **诚实**：如果【参考材料】中没有包含回答用户问题所需的信息，请直接回答："知识库中未找到相关内容"，不要编造答案。
   - **格式**：使用 Markdown 格式组织答案。对于要点，请使用无序列表。
   - **纯净性**：不要在回答中生成文件下载链接或图片 URL，只需保留 `[id]` 引用标签即可。
""",
                "analysis": """
# 角色设定
你是一个专业的多模态数据分析助手。你的任务是基于提供的参考资料进行深度分析。

# 核心指令
1. **引用要求**：每个分析结论都必须引用具体的参考材料编号
2. **多模态分析**：充分利用文档和图片信息进行综合分析
3. **数据支撑**：引用具体的数字、图表信息来支撑分析结论
4. **结构化输出**：使用清晰的标题和要点组织分析结果
""",
                "comparison": """
# 角色设定
你是一个专业的比较分析助手。你的任务是比较不同信息源的内容。

# 核心指令
1. **全面对比**：系统性地比较各个方面
2. **引用对比**：明确引用对比的信息来源
3. **客观中性**：保持客观中性的分析态度
4. **结构化展示**：使用表格或列表清晰展示比较结果
"""
            }
            
            return instructions.get(context_type, instructions["general"])
            
        except Exception as e:
            logger.error(f"系统指令格式化失败: {str(e)}")
            return instructions["general"]
    
    def format_user_query(self, query: str, context: Optional[str] = None) -> str:
        """格式化用户查询"""
        try:
            if context:
                formatted_query = f"""以下是根据检索结果整理的参考材料，以及用户的最新问题。

---
{context}
---

用户问题：{query}"""
            else:
                formatted_query = f"用户问题：{query}"
            
            return formatted_query
            
        except Exception as e:
            logger.error(f"用户查询格式化失败: {str(e)}")
            return f"用户问题：{query}"
    
    def validate_format(self, text: str, content_type: str) -> Dict[str, Any]:
        """验证格式化结果"""
        try:
            validation_result = {
                "valid": True,
                "errors": [],
                "warnings": []
            }
            
            # 检查引用格式
            if content_type in ["doc", "image"]:
                ref_pattern = r'【材料 \d+】'
                if not re.search(ref_pattern, text):
                    validation_result["warnings"].append("缺少标准引用格式")
            
            # 检查引用编号
            if content_type == "doc":
                ref_numbers = self.parse_references_from_text(text)
                if not ref_numbers:
                    validation_result["warnings"].append("没有找到引用编号")
            
            return validation_result
            
        except Exception as e:
            logger.error(f"格式化验证失败: {str(e)}")
            return {
                "valid": False,
                "errors": [str(e)],
                "warnings": []
            }