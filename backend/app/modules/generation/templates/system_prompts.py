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
                "**引用格式规范（必须遵守，便于前端正确渲染插图与角标）**：",
                "1) **统一用半角方括号**：正文里材料编号一律写作 `[1]`、`[2]`。不要用圆圈序号 ①②③、勿单独用「图三」「图3」代替可点击的 `[3]`（可写「如图」但须紧跟 `[3]`）。",
                "2) **就地首次标注**：在**对应句子或同一条列表项内**第一次用到某条材料时就要写 `[n]`；禁止只在全文最后一段集中写一串 `[3][4][5]`，而前面分点论述中从不出现这些编号。",
                "3) **避免同条内重复同一编号**：同一段落或同一条列表项中，若多句同属同一材料，**在该段/该条内对同一 `[n]` 只标注一次**（通常放在首例句末或本条末尾），勿连续重复多次相同 `[n]`。",
                "4) **列表与多图**：不同列表项若对应不同图片，请在**各自条目正文里**写 `如图 [n] 所示` 或句末 `[n]`，不要把所有图片编号只堆在文末。",
                "5) **多来源合并**：一句综合多源时写作紧邻的 `[1][2]` 即可（中间无空格）。",
                "6) **禁止外链插图**：不要输出 `![说明](https://...)` 或任何图片直链；知识库配图由系统根据 `[id]` 自动展示，你只写 `[id]` 与文字说明。",
                "7) **编号合法**：`[n]` 必须与上方【参考材料】中已列出的材料 id 一致，禁止编造未出现的编号；优先使用半角 `[n]`（少用全角【n】混排）。",
                "8) **角标位置**：引用号贴在从句末尾标点之前或紧接句末，如 `……如下。[2]`；勿单独开一行只写 `[2]`，勿在标题行末尾堆叠一串角标。",
                "",
                "**引用写法示例（模仿结构即可）**：",
                "- 反例（禁止）：前面分点完全无角标，仅在最后写「……。综上所述。[3][4][5]」；同一条里写「……[2]……[2]……[2]」。",
                "- 正例：列表第一项内写「……借景与层次……[3]。」；第二项内写「如图 [4] 所示……与记载一致 [5]。」（角标均在该条正文内）。",
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
                "**多模态排版（图文互证）**：",
                "上下文中可能包含图片类材料（含隐性检索增益）。若某图有助于说明观点，在**相关段落或列表项内**把 `如图 [n] 所示` / 句末 `[n]` 与论述写在同一视觉块中；上文已标过的图在后文若仅重复概括，可写「见上文」而避免同段再堆多个相同 `[n]`。",
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
                "确保每个事实都有相应的引用。",
                "**引用**：每个列表项或短段落内，事实与 `[n]` 成对出现，勿把全部编号留到段尾一行。"
            ]
        }
        
        self.prompt_templates["analysis"] = {
            "additional_instructions": [
                "**深度分析**：请进行深入的分析和推理。",
                "利用文档和图片信息进行综合分析。",
                "提供有见地的观点和结论。",
                "结构化组织分析内容（使用标题和列表）。",
                "**引用**：每个小标题下的论点在首次提出时即标注 `[n]`；图表解读与 `[n]` 写在同一段。"
            ]
        }
        
        self.prompt_templates["comparison"] = {
            "additional_instructions": [
                "**对比分析**：请系统性地比较不同的信息源。",
                "使用表格或结构化列表展示对比结果。",
                "客观地分析各方的优劣势。",
                "明确引用对比的信息来源。",
                "**引用**：对比表格的单元格结论若在正文中展开，展开句须带 `[n]`，勿仅在表下集中罗列编号。"
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
                "如果图片的视觉描述与查询意图相关，则积极引用并说明图片内容。",
                "**引用**：写画面/氛围时在**该句或该段内**用 `[n]`，与基础规范一致，勿仅在文末集中标注。"
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
1. 每个事实在对应句末用半角 `[编号]` 标注；勿用①②③代替；同一 `[n]` 在同一段/同一条列表项内勿重复多次。
2. 首次用到某材料须在论述该内容的段落或列表项内标注，勿仅在文末集中写一串编号。
3. 使用 Markdown 组织答案；勿输出图片 URL 或 `![]()`，配图仅通过 `[id]`。
4. 参考了图片时请写「如图 [n] 所示」等并紧跟 `[n]`。
5. 若无相关信息请诚实说明。"""
    
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