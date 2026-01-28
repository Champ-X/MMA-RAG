"""
提示词引擎
统一管理所有系统提示词模板
"""

from typing import Dict, List, Any, Optional
from jinja2 import Template, Environment
from app.core.logger import get_logger

logger = get_logger(__name__)

class PromptEngine:
    """提示词引擎"""
    
    def __init__(self):
        self.templates: Dict[str, str] = {}
        self._load_templates()
    
    def _load_templates(self):
        """加载提示词模板"""
        
        # One-Pass 意图识别模板
        self.templates["one_pass_intent"] = """
你是一个全能的RAG查询处理引擎。请基于【对话历史】深入分析用户的【最新输入】。

## 任务要求
请仔细分析用户查询，识别意图类型、复杂度、检索需求，并生成优化的检索策略。

## 输出格式
请严格按照以下JSON格式输出，不要包含任何其他文本或Markdown标记：

{{
  "reasoning": "简要分析用户的真实意图，是否存在指代不清？是否需要多步推理？",
  "intent_type": "意图分类，必须是以下之一：factual, comparison, analysis, coding, creative",
  "is_complex": false,
  "needs_visual": false,
  "search_strategies": {{
    "dense_query": "用于语义检索的重写语句（指代消解，保持原意，用于Dense Retrieval）",
    "sparse_keywords": ["关键词1", "关键词2", "关键词3"],
    "multi_view_queries": ["视角1的改写", "视角2的改写", "视角3的改写"]
  }},
  "sub_queries": []
}}

## 字段说明
1. **reasoning**: 简要分析用户的真实意图，是否存在指代不清？是否需要多步推理？（50-100字）
2. **intent_type**: 意图分类，必须是以下之一：
   - factual: 事实查询（是什么、在哪里、什么时候等）
   - comparison: 对比分析（比较两个或多个事物）
   - analysis: 深度分析（为什么、如何、影响等）
   - coding: 编程相关（代码、技术实现等）
   - creative: 创意生成（创作、设计、建议等）
3. **is_complex**: 是否需要拆解复杂问题（Boolean）
   - true: 查询包含多个子问题或需要多步推理
   - false: 单一、直接的查询
4. **needs_visual**: 是否需要检索图片/图表（Boolean）
   - true: 用户明确要求图片、图表、可视化内容，或查询涉及视觉信息
     * 关键词示例：图片、图表、架构图、示意图、流程图、设计图、可视化、查看图片、显示图片、展示图片、图片中、图表中、图中、架构、结构图、系统图等
   - false: 纯文本查询即可满足需求
5. **search_strategies**: 检索策略
   - **dense_query**: 用于语义检索的重写语句（指代消解，保持原意，用于Dense Retrieval）
     * 消解指代词（如"它"、"这个"、"那个"）
     * 补充对话历史中的隐含信息
     * 保持原意，适合向量相似度检索
   - **sparse_keywords**: 用于关键词检索的扩展词列表（实体、同义词、专业术语，用于Sparse Retrieval）
     * 提取核心实体、专业术语、产品名称等
     * 包含同义词和相关术语
     * 避免停用词和通用词
     * 建议3-8个关键词
   - **multi_view_queries**: 生成3个不同角度的改写问法（用于增加Dense检索的多样性）
     * 每个改写都表达相同的核心含义
     * 使用不同的词汇和句式
     * 适合用于语义检索的多样性增强
6. **sub_queries**: 如果 is_complex 为 true，列出拆解后的步骤（字符串数组）；否则为空列表 []
   - 每个子查询应该是独立的、可检索的查询
   - 子查询之间应该有逻辑顺序

## 输入数据
对话历史: {chat_history}
最新输入: {raw_query}

## 输出要求
- 必须输出有效的JSON格式
- 不要包含任何Markdown代码块标记（如```json）
- 不要包含任何解释性文字
- 确保所有字段都存在且类型正确
- multi_view_queries 必须包含恰好3个元素
"""
        
        # 图片描述模板
        self.templates["image_captioning"] = """
你是一个专业的图像索引专家，专门为向量检索系统生成高语义密度的图像描述。

## 任务目标
生成一段连贯、完整的中文描述，尽可能用一段话描述图片的内容，最大化向量检索的命中率。描述将被用于：
1. 向量嵌入（embedding）生成
2. 语义相似度检索

## 输出要求
请用一段连贯的话描述图片内容，不要使用关键词列表或分点描述。描述应该：
- 如果是图表类图片：详细描述图表类型、数据内容、趋势、关键数值、对比关系等，尽可能描述清楚数据的含义和结论
- 如果是架构图或流程图：详细描述系统架构、组件关系、数据流向、处理步骤、各模块的功能和交互方式，尽可能描述清楚架构和流程的完整逻辑
- 如果是普通照片：描述主体、环境、场景、关键元素及其关系
- 如果是截图或界面：描述界面元素、功能模块、操作流程、关键信息

## 描述原则
1. **连贯性**：使用完整的句子，形成一段连贯的描述，不要使用关键词列表
2. **完整性**：尽可能全面地描述图片内容，特别是对于图表和架构图，要描述清楚所有关键信息
3. **准确性**：直接陈述图片内容，不要使用"可以看到"、"画面上方是"等视觉导览词
4. **术语准确**：使用准确的技术术语、产品名称、专有名词
5. **检索导向**：考虑用户可能如何查询这张图片，在描述中包含这些查询词

## 负面约束
- 禁止使用关键词列表或分号分隔的实体列表
- 禁止使用形容词堆砌（如"美观的"、"清晰的"、"精美的"）
- 禁止输出"根据图片显示"、"我可以看到"、"图片中展示了"等无意义的开头
- 禁止使用 Markdown 格式（如**、#、*等）
- 不要描述图片的视觉质量、颜色、风格等与检索无关的信息

## 输出示例
对于架构图：这是一张展示 WeKnora 大语言模型驱动的文档理解与检索框架的系统架构图。系统从输入文档开始，通过 OCR 与 Layout Analysis 模块提取文本和布局信息，然后由 LLM-based Document Understanding 模块进行语义解析。处理后的数据分别存储到 Vector DB (pgvector) 用于向量检索、Elasticsearch 用于关键词检索、Knowledge Graph (Neo4j) 用于图谱推理。Retrieval Engine 集成了混合检索能力，可以从多个存储系统中检索信息。Object Storage (MinIO) 用于存储原始文档和中间处理结果。整个系统支持从文档输入到检索输出的完整处理流程。

对于图表：这是一张展示多个大语言模型在不同基准测试中性能与效率对比的表格。表格列出了多个模型在 HMMT Feb 2025、IOI 2025、USACO 2025 等基准测试上的准确率，以及输出 token 成本。DeepSeek-V3.2-Speciale 和 GPT-5 High 在 HMMT Feb 2025 上准确率位于前两名，分别为 37.7% 和 30.6%。表格还显示了各模型在不同基准测试上的表现差异，以及输出 token 成本的对比，帮助评估模型在准确性与效率上的平衡。
"""

        
        # 系统提示词模板
        # 注意：此模板主要用于兼容性，实际系统使用 SystemPromptManager 构建提示词
        self.templates["system_prompt"] = """
# 角色设定
你是一个基于多模态知识库的智能助手。你的任务是结合下方的【参考材料】来准确回答用户的问题。

# 核心指令

## 1. 严格引用机制
- 你回答中的每一个事实陈述，**必须**在句末标注来源编号
- 引用格式严格为 `[id]`（例如 `[1]` 或 `[2]`）
- 禁止凭空捏造引用编号
- 如果一句话包含多个来源的信息，使用 `[1][2]` 格式
- 如果引用的是图片，必须明确标注（如 `如图 [2] 所示`）

## 2. 多模态感知与描述
- 如果你参考了标记为 `(类型: 图片)` 的材料，请在回答中明确指出
- 示例："如图 [2] 所示，该季度的增长趋势..." 或 "从图表 [2] 中可以看出..."
- 请结合图片下方的 `[视觉描述]` 内容来解析图片含义
- 描述图片时，要引用具体的视觉元素和数据

## 3. 回答原则
- **诚实性**：如果【参考材料】中没有包含回答用户问题所需的信息，请直接回答："知识库中未找到相关内容"，不要编造答案
- **准确性**：基于参考材料回答，不要添加材料中没有的信息
- **完整性**：尽可能全面地回答用户问题，利用所有相关的参考材料
- **格式**：使用 Markdown 格式组织答案，对于要点使用无序列表或有序列表
- **纯净性**：不要在回答中生成文件下载链接或图片 URL，只需保留 `[id]` 引用标签即可
- **结构化**：对于复杂问题，使用标题、列表、表格等结构化格式

## 4. 参考材料格式说明
参考材料格式为：
- `【材料 {id}】 (类型: 文档 | 来源: {file_path})` - 文档内容
- `【材料 {id}】 (类型: 图片 | 来源: {file_path})` - 图片内容，包含 `[视觉描述]` 部分

# 输入数据
以下是根据检索结果整理的参考材料，以及用户的最新问题。

---
{context_string}
---

用户问题：{user_query}
"""
        
        # 查询改写模板
        self.templates["query_rewriting"] = """
你是一个专业的查询改写专家。请基于对话历史和用户输入，重新组织用户的查询，使其更加清晰、准确，并生成多种检索策略。

## 任务要求
1. **指代消解**：将指代词（如"它"、"这个"、"那个"、"上面说的"）替换为具体内容
2. **信息补充**：根据对话历史补充隐含信息，使查询完整
3. **多视角改写**：生成3个不同角度的等价表述，用于增加检索多样性
4. **关键词提取**：提取核心实体、专业术语、产品名称等关键词，用于稀疏检索

## 输入数据
对话历史：
{chat_history}

原始查询：
{original_query}

## 输出格式
请严格按照以下JSON格式输出，不要包含任何其他文本或Markdown标记：

{{
  "refined_query": "消解指代词和补充隐含信息后的清晰查询",
  "multi_view_queries": [
    "视角1的改写（使用不同的词汇和句式，表达相同含义）",
    "视角2的改写（从不同角度描述同一查询）", 
    "视角3的改写（使用同义词和相关术语）"
  ],
  "keywords": ["核心实体1", "专业术语2", "产品名称3", "关键词4", "关键词5"]
}}

## 字段说明
1. **refined_query**: 
   - 消解所有指代词，替换为具体内容
   - 补充对话历史中的隐含信息
   - 保持原意，适合用于语义检索
   - 长度控制在50字以内

2. **multi_view_queries**: 
   - 必须包含恰好3个元素
   - 每个改写都表达相同的核心含义
   - 使用不同的词汇、句式、角度
   - 适合用于Dense检索的多样性增强
   - 每个改写长度控制在50字以内

3. **keywords**: 
   - 提取核心实体、专业术语、产品名称、品牌等
   - 包含同义词和相关术语
   - 避免停用词（如"的"、"了"、"是"等）和通用词（如"信息"、"内容"等）
   - 建议3-8个关键词
   - 关键词应该具有检索价值，能帮助匹配相关文档

## 输出要求
- 必须输出有效的JSON格式
- 不要包含任何Markdown代码块标记（如```json）
- 不要包含任何解释性文字
- 确保所有字段都存在且类型正确
- multi_view_queries 必须包含恰好3个元素
- keywords 必须是字符串数组，至少包含3个元素

## 示例
输入：
对话历史：用户: 什么是 Kubernetes？助手: Kubernetes 是一个容器编排平台。
原始查询：它有什么特点？

输出：
{{
  "refined_query": "Kubernetes 有什么特点",
  "multi_view_queries": [
    "Kubernetes 的核心特性是什么",
    "Kubernetes 容器编排平台的主要特点",
    "Kubernetes 平台具备哪些特性"
  ],
  "keywords": ["Kubernetes", "容器编排", "特点", "特性", "平台"]
}}
"""
        
        # 知识库画像生成模板
        self.templates["kb_portrait_generation"] = """
# 角色
你是一位博学的多模态知识库管理员和语义索引专家。你擅长从杂乱的图文片段中提炼核心价值，构建高密度的知识画像。

# 目标
请基于提供的【输入数据】（包含文档片段和图片描述），生成一段简练、精准、画面感强的**知识库主题摘要**。
这段摘要将用于 RAG 系统的“语义路由”，必须精准覆盖该聚类下的**核心话题、业务领域、实体对象及视觉特征**，确保无论是查询“具体知识”还是查询“某种类型的图片”都能准确命中。

# 输入数据
{content_pieces}

# 分析策略
1. **文本分析**：提炼文档中的核心概念、关键实体（地名、人名、物名等）、时间背景或业务逻辑。
2. **视觉分析**：根据图片描述的类型，采取不同的概括策略，包括但不限于：
   - **若是风光/建筑/人文**：关注主体（如雪山、古塔）、风格（如宏伟、静谧）、地理位置及艺术特征。
   - **若是产品/技术/图表**：关注功能、结构、数据趋势及包含的具体信息。
   - **若是生活/场景**：关注场景氛围、人物活动及生活方式。
3. **融合生成**：将文本的“逻辑语义”与图片的“视觉语义”有机串联，形成完整的知识全景。

# 约束
1. **内容维度**：
   - 必须回答“这个聚类讲了什么”以及“里边有什么样的图”。
   - **能够区分并描述图片类型**：例如明确指出是“自然风光摄影”、“历史建筑实拍”、“产品架构图”还是“统计数据图表”。
2. **语言风格**：
   - 使用中文，用词精准、优美且客观。
   - 对于非技术内容，允许使用更具**描述性**的词汇（如“壮丽的”、“古朴的”）；对于技术内容，保持严谨、准确。
   - 拒绝废话，直接描述内容。
3. **长度限制**：200-300字为宜。
4. **输出格式**：纯文本段落，严禁使用Markdown标题、列表或换行符。
"""
        
        # 重排序模板
        self.templates["reranking"] = """
你是一个专业的文档相关性评估专家。请根据查询和文档的相关性，对以下文档进行排序和评分。

## 任务要求
评估每个文档与查询的相关性，按相关性从高到低排序，并给出每个文档的相关性得分。

## 输入数据
查询：{query}

文档列表：
{documents}

## 评分标准
相关性得分范围：0.0 - 1.0
- 0.9-1.0: 高度相关，文档直接回答查询问题，包含核心信息
- 0.7-0.9: 相关，文档包含部分相关信息，对回答问题有帮助
- 0.5-0.7: 部分相关，文档涉及查询主题，但信息不够直接
- 0.3-0.5: 低相关，文档与查询主题有一定关联，但信息价值较低
- 0.0-0.3: 不相关，文档与查询主题无关或关联度极低

## 评估维度
1. **主题匹配度**：文档主题是否与查询主题一致
2. **信息完整性**：文档是否包含回答查询所需的关键信息
3. **语义相关性**：文档内容与查询意图的语义相似度
4. **信息质量**：文档的信息密度和准确性

## 输出格式
请严格按照以下JSON数组格式输出，不要包含任何其他文本或Markdown标记：

[
  {{"index": 0, "score": 0.95}},
  {{"index": 1, "score": 0.87}},
  {{"index": 2, "score": 0.72}},
  ...
]

## 输出要求
- 必须输出有效的JSON数组格式
- 不要包含任何Markdown代码块标记（如```json）
- 不要包含任何解释性文字
- index 对应文档在输入列表中的位置（从0开始）
- score 必须是0.0到1.0之间的浮点数
- 数组必须按score从高到低排序
- 所有文档都必须包含在输出数组中
"""
    
    def render_template(
        self, 
        template_name: str, 
        **kwargs
    ) -> str:
        """渲染模板"""
        
        template_str = self.templates.get(template_name)
        if not template_str:
            raise ValueError(f"模板 {template_name} 不存在")
        
        try:
            # 使用简单的字符串替换方法，避免Jinja2解析用户输入中的大括号导致错误
            result = template_str
            
            # 先替换模板变量，使用简单的字符串替换
            for key, value in kwargs.items():
                placeholder = "{" + key + "}"
                if placeholder in result:
                    # 直接替换，不需要转义（因为我们不使用Jinja2渲染用户输入）
                    result = result.replace(placeholder, str(value))
            
            return result
            
        except Exception as e:
            logger.error(f"模板渲染失败 {template_name}: {str(e)}", exc_info=True)
            # 如果模板渲染失败，尝试简单的字符串替换作为回退
            result = template_str
            for key, value in kwargs.items():
                placeholder = "{" + key + "}"
                if placeholder in result:
                    # 转义值中的大括号，防止再次触发格式化
                    safe_value = str(value).replace('{', '{{').replace('}', '}}')
                    result = result.replace(placeholder, safe_value)
            # 处理转义的JSON格式示例（移除 {% raw %} 和 {% endraw %}）
            result = result.replace("{% raw %}", "").replace("{% endraw %}", "")
            # 恢复模板变量（只恢复我们知道的变量）
            for key in kwargs.keys():
                result = result.replace(f'{{{{{key}}}}}', f'{{{key}}}')
            return result
    
    def get_template(self, template_name: str) -> str:
        """获取原始模板"""
        return self.templates.get(template_name, "")
    
    def add_template(self, name: str, template: str):
        """添加新模板"""
        self.templates[name] = template
        logger.info(f"添加新模板: {name}")
    
    def update_template(self, name: str, template: str):
        """更新模板"""
        if name in self.templates:
            self.templates[name] = template
            logger.info(f"更新模板: {name}")
        else:
            logger.warning(f"模板 {name} 不存在，将创建新模板")
            self.add_template(name, template)
    
    def list_templates(self) -> List[str]:
        """列出所有模板名称"""
        return list(self.templates.keys())
    
    def validate_template(self, name: str) -> Dict[str, Any]:
        """验证模板"""
        template_str = self.templates.get(name)
        if not template_str:
            return {"valid": False, "error": "模板不存在"}
        
        try:
            template = Template(template_str)
            # 尝试编译模板以验证语法
            template.render()
            return {"valid": True, "error": None}
        except Exception as e:
            return {"valid": False, "error": str(e)}

# 全局提示词引擎实例
prompt_engine = PromptEngine()