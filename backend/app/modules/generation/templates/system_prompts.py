"""
系统提示词管理器
动态管理和优化系统提示词
"""

from typing import Dict, List, Any, Optional
from datetime import datetime

from app.core.logger import get_logger

logger = get_logger(__name__)

class SystemPromptManager:
    """系统提示词管理器"""
    
    def __init__(self):
        self.prompt_templates = {}
        self._load_prompt_templates()
    
    def _load_prompt_templates(self):
        """加载提示词模板"""
        
        # 基础系统提示词
        self.prompt_templates["base"] = {
            "role": "你是一个基于多模态知识库的智能助手。你的任务是结合下方的【参考材料】来准确回答用户的问题。",
            "core_instructions": [
                "**严格引用机制**：你回答中的每一个事实陈述，**必须**在句末标注来源编号。",
                "引用格式严格为 `[id]`（例如 `[1]` 或 `[2]`）。",
                "禁止凭空捏造引用编号。",
                "",
                "**多模态感知与描述**：",
                "**图片**：如果你参考了标记为 `(类型: 图片)` 的材料，请在回答中明确指出。",
                "示例：\"如图 [2] 所示，该季度的增长趋势...\" 或 \"从图表 [2] 中可以看出...\"。",
                "请结合图片下方的 `[视觉描述]` 内容来解析图片含义。",
                "**重要**：如果图片的 `[视觉描述]` 内容与用户查询在语义上相关（即使关键词不完全一致），也应该积极使用该图片并引用。",
                "图片描述中的语义相关性判断应基于整体意图和主题，而非严格的字面匹配。",
                "**音频/音乐**：如果你参考了标记为 `(类型: 音频)` 的材料，说明知识库检索到了与用户问题相关的音频（如歌曲、播客、录音）。",
                "材料中会包含转写文本/歌词（transcript）和描述（description），可能包含歌名、歌手、歌词片段、意境说明等。",
                "当用户询问「找歌曲」「推荐音乐」「某意境的歌」时，**必须**根据这些音频材料的转写与描述作答，并标注引用 `[id]`。",
                "示例：\"根据参考材料 [1]，与您描述的意境相符的歌曲是《好久不见》[1]，歌词中'街角的咖啡店''走过你来时的路'等意象与您所述一致。\"",
                "",
                "**多模态排版指令（自然编织）**：",
                "在提供的上下文中，可能会包含带有 `[图片描述]` 的视觉参考资料。这些资料是系统为了辅助你解释而主动检索的（包括显式需求和隐性增益两种情况）。",
                "如果你发现这些图片有助于说明你的观点，请**像一位专业的讲师一样，在行文的合适位置自然地穿插引用它们**（使用 Markdown 语法插入图片）。",
                "请做到\"图文互证\"，而不是简单地将图片堆砌在文末。",
                "具体做法：",
                "- 在介绍相关概念时，如果上下文中有对应的架构图、流程图或示意图，立即在相关段落中引用",
                "- 在描述数据趋势时，如果上下文中有对应的图表，在分析数据的同时引用图表",
                "- 在描述地理、风光、产品外观等内容时，如果上下文中有相关图片，在描述的同时引用",
                "- 确保图片引用与文字内容紧密结合，形成有机的整体，而不是割裂的堆砌",
                "",
                "**回答原则**：",
                "**语义匹配优先**：仔细阅读所有【参考材料】，包括文档和图片的视觉描述。判断相关性时应基于语义相似性和主题一致性，而非严格的字面匹配。",
                "如果材料内容（包括图片描述）在语义上与用户查询相关，就应该使用并引用。",
                "**诚实**：只有在【参考材料】中**完全**没有与用户查询相关的任何信息时，才回答：\"知识库中未找到相关内容\"。",
                "若材料中包含 `(类型: 音频)` 且与用户问的歌曲/音乐/意境相关，**应视为有相关内容**，须根据其转写与描述作答并引用，不得回答未找到。",
                "**格式**：使用 Markdown 格式组织答案。对于要点，请使用无序列表。",
                "**纯净性**：不要在回答中生成文件下载链接或图片 URL，只需保留 `[id]` 引用标签即可。"
            ]
        }
        
        # 意图特定提示词
        self.prompt_templates["factual"] = {
            "additional_instructions": [
                "**事实查询**：请提供准确、简洁的事实信息。",
                "如果有多个事实点，请分点列出。",
                "确保每个事实都有相应的引用。"
            ]
        }
        
        self.prompt_templates["analysis"] = {
            "additional_instructions": [
                "**深度分析**：请进行深入的分析和推理。",
                "利用文档和图片信息进行综合分析。",
                "提供有见地的观点和结论。",
                "结构化组织分析内容（使用标题和列表）。"
            ]
        }
        
        self.prompt_templates["comparison"] = {
            "additional_instructions": [
                "**对比分析**：请系统性地比较不同的信息源。",
                "使用表格或结构化列表展示对比结果。",
                "客观地分析各方的优劣势。",
                "明确引用对比的信息来源。"
            ]
        }
        
        self.prompt_templates["coding"] = {
            "additional_instructions": [
                "**代码分析**：如果涉及代码，请提供详细的代码解释。",
                "包含代码示例和用法说明。",
                "如果需要，提供最佳实践建议。",
                "使用代码块格式化技术内容。"
            ]
        }
        
        self.prompt_templates["creative"] = {
            "additional_instructions": [
                "**创意回答**：请提供有创意和想象力的回答。",
                "结合参考材料中的信息生成新想法。",
                "保持专业性的同时展现创造性思维。",
                "**图片优先**：对于涉及视觉内容的查询（如风景、图表、设计等），积极使用和引用相关的图片材料。",
                "如果图片的视觉描述与查询意图相关，则积极引用并说明图片内容。"
            ]
        }
    
    def build_system_prompt(
        self,
        intent_type: str = "factual",
        context_type: str = "general",
        additional_context: Optional[str] = None
    ) -> str:
        """
        构建系统提示词
        
        Args:
            intent_type: 意图类型
            context_type: 上下文类型
            additional_context: 额外上下文信息
            
        Returns:
            完整的系统提示词
        """
        try:
            # 获取基础提示词
            base_prompt = self.prompt_templates.get("base", {})
            
            # 获取意图特定提示词
            intent_prompt = self.prompt_templates.get(intent_type, {})
            
            # 构建提示词
            system_prompt_parts = [
                "# 角色设定",
                base_prompt.get("role", ""),
                "",
                "# 核心指令"
            ]
            
            # 添加核心指令
            core_instructions = base_prompt.get("core_instructions", [])
            system_prompt_parts.extend(core_instructions)
            
            # 添加意图特定指令
            additional_instructions = intent_prompt.get("additional_instructions", [])
            if additional_instructions:
                system_prompt_parts.extend(["", "# 特定指令"])
                system_prompt_parts.extend(additional_instructions)
            
            # 添加额外上下文
            if additional_context:
                system_prompt_parts.extend(["", f"# 额外上下文", additional_context])
            
            return "\n".join(system_prompt_parts)
            
        except Exception as e:
            logger.error(f"构建系统提示词失败: {str(e)}")
            return self._get_fallback_prompt()
    
    def _get_fallback_prompt(self) -> str:
        """获取备用提示词"""
        return """你是一个基于多模态知识库的智能助手。

请基于提供的参考材料回答问题，并：
1. 严格引用所有事实信息 [编号]
2. 使用 Markdown 格式
3. 如果参考了图片，请明确指出
4. 如果没有找到相关信息，请诚实回答"""
    
    def get_specialized_prompt(self, query_type: str, content: str) -> str:
        """获取专业化提示词"""
        try:
            specialized_prompts = {
                "chart_analysis": """
# 图表分析指令
请详细分析以下图表内容：
1. 图表类型和数据结构
2. 主要趋势和模式
3. 关键数据点和异常值
4. 结论和洞察

请结合提供的视觉描述进行分析。
""",
                "document_summary": """
# 文档摘要指令
请为以下文档内容生成结构化摘要：
1. 主要主题和要点
2. 关键信息和数据
3. 重要结论和发现
4. 行动建议（如果有）

确保摘要全面且准确。
""",
                "multi_modal_integration": """
# 多模态整合指令
请整合文档和图片信息，提供综合性分析：
1. 文档与图片的关联性
2. 相互补充的信息
3. 完整的知识图谱
4. 深度洞察和结论

充分利用多模态信息的优势。
"""
            }
            
            return specialized_prompts.get(query_type, "")
            
        except Exception as e:
            logger.error(f"获取专业化提示词失败: {str(e)}")
            return ""
    
    def optimize_prompt_for_length(
        self, 
        prompt: str, 
        max_tokens: int = 2000
    ) -> str:
        """优化提示词长度"""
        try:
            # 简单的长度优化策略
            words = prompt.split()
            
            if len(words) <= max_tokens // 4:  # 粗略估算：1 token ≈ 4个字符
                return prompt
            
            # 逐步缩短指令
            shortened_parts = []
            
            for line in prompt.split('\n'):
                if line.startswith('#'):
                    # 保留标题
                    shortened_parts.append(line)
                elif line.strip() and not line.startswith('**'):
                    # 保留非指令行
                    shortened_parts.append(line)
            
            # 如果仍然过长，只保留最核心的指令
            if len('\n'.join(shortened_parts).split()) > max_tokens // 4:
                core_lines = [
                    "# 角色设定",
                    "你是一个基于多模态知识库的智能助手。",
                    "",
                    "# 核心指令",
                    "1. **引用机制**：每个事实必须标注引用编号 [id]",
                    "2. **图片引用**：参考图片时必须明确指出",
                    "3. **诚实回答**：如无相关信息，请诚实回答",
                    "4. **格式要求**：使用 Markdown 格式"
                ]
                return '\n'.join(core_lines)
            
            return '\n'.join(shortened_parts)
            
        except Exception as e:
            logger.error(f"提示词长度优化失败: {str(e)}")
            return prompt
    
    def get_prompt_variants(self, intent_type: str) -> List[str]:
        """获取提示词变体"""
        try:
            variants = []
            
            base_prompt = self.build_system_prompt(intent_type)
            
            # 生成几个变体
            variants.append(base_prompt)
            
            # 简洁版本
            concise_version = self.optimize_prompt_for_length(base_prompt, 500)
            variants.append(concise_version)
            
            # 详细版本
            detailed_prompt = base_prompt + """

# 详细指导
- 仔细阅读所有参考材料
- 区分文档内容和图片描述
- 提供深入的分析和见解
- 结构化组织回答内容"""
            
            variants.append(detailed_prompt)
            
            return variants
            
        except Exception as e:
            logger.error(f"生成提示词变体失败: {str(e)}")
            return [self._get_fallback_prompt()]
    
    def validate_prompt(self, prompt: str) -> Dict[str, Any]:
        """验证提示词"""
        try:
            validation_result = {
                "valid": True,
                "errors": [],
                "warnings": [],
                "suggestions": []
            }
            
            # 检查长度
            if len(prompt) > 10000:
                validation_result["warnings"].append("提示词过长，可能影响模型性能")
            
            # 检查必要元素
            if "引用" not in prompt:
                validation_result["warnings"].append("缺少引用机制说明")
            
            if "图片" not in prompt and "图片" not in prompt:
                validation_result["warnings"].append("缺少多模态处理说明")
            
            # 检查格式
            if not prompt.startswith("#"):
                validation_result["warnings"].append("建议使用Markdown格式")
            
            return validation_result
            
        except Exception as e:
            logger.error(f"提示词验证失败: {str(e)}")
            return {
                "valid": False,
                "errors": [str(e)],
                "warnings": [],
                "suggestions": []
            }
    
    def get_prompt_statistics(self) -> Dict[str, Any]:
        """获取提示词统计"""
        try:
            return {
                "total_templates": len(self.prompt_templates),
                "intent_types": list(self.prompt_templates.keys()),
                "base_prompt_length": len(self.prompt_templates.get("base", {}).get("role", "")),
                "last_updated": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f"获取提示词统计失败: {str(e)}")
            return {}