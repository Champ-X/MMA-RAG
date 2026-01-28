"""
One-Pass意图识别处理器
使用统一提示词进行意图识别和查询预处理
"""

from typing import Dict, List, Any, Optional
import json
from datetime import datetime

from app.core.llm.manager import llm_manager
from app.core.llm.prompt_engine import prompt_engine
from app.core.logger import get_logger

logger = get_logger(__name__)

class IntentProcessor:
    """One-Pass意图识别处理器"""
    
    def __init__(self):
        self.llm_manager = llm_manager
        self.prompt_engine = prompt_engine
    
    async def process(
        self,
        query: str,
        chat_history: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """
        One-Pass意图识别处理
        
        Args:
            query: 用户查询
            chat_history: 对话历史
            
        Returns:
            意图分析结果
        """
        try:
            # 构建对话历史文本
            chat_history_text = self._format_chat_history(chat_history or [])
            
            # 构建提示词
            prompt = self.prompt_engine.render_template(
                "one_pass_intent",
                chat_history=chat_history_text,
                raw_query=query
            )
            
            # 调用LLM进行意图识别
            messages = [
                {
                    "role": "system",
                    "content": (
                        "你是一个专业的RAG查询处理器。请仔细分析用户的查询，"
                        "生成结构化的JSON输出，包含意图分类、查询改写等信息。"
                    )
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
            
            result = await self.llm_manager.chat(
                messages=messages,
                task_type="intent_recognition",
                temperature=0.1
            )
            
            if not result.success or not result.data:
                logger.error(f"意图识别失败: {result.error}")
                return self._default_intent_analysis(query)
            
            # 解析LLM响应
            intent_analysis = self._parse_llm_response(result.data)
            
            # 验证和补全分析结果
            validated_analysis = self._validate_intent_analysis(intent_analysis, query)
            
            logger.info(f"意图识别完成: {validated_analysis['intent_type']}, 复杂度: {validated_analysis['is_complex']}")
            
            return validated_analysis
            
        except Exception as e:
            logger.error(f"意图识别处理失败: {str(e)}")
            return self._default_intent_analysis(query)
    
    def _format_chat_history(self, chat_history: List[Dict[str, str]]) -> str:
        """格式化对话历史"""
        if not chat_history:
            return "无对话历史"
        
        history_text = []
        for message in chat_history[-5:]:  # 只保留最近5轮对话
            role = "用户" if message["role"] == "user" else "助手"
            content = message["content"][:100]  # 限制长度
            history_text.append(f"{role}: {content}")
        
        return "\n".join(history_text)
    
    def _parse_llm_response(self, response_data: Dict[str, Any]) -> Dict[str, Any]:
        """解析LLM响应"""
        try:
            # 提取文本内容
            content = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            # 尝试解析JSON
            if content.strip().startswith("{"):
                # 直接是JSON格式
                return json.loads(content)
            else:
                # 尝试从文本中提取JSON
                json_start = content.find("{")
                json_end = content.rfind("}") + 1
                
                if json_start != -1 and json_end > json_start:
                    json_str = content[json_start:json_end]
                    return json.loads(json_str)
                else:
                    # 手动解析（简单实现）
                    return self._manual_parse_response(content)
                    
        except json.JSONDecodeError as e:
            logger.warning(f"JSON解析失败: {e}, 尝试手动解析")
            return self._manual_parse_response(response_data.get("choices", [{}])[0].get("message", {}).get("content", ""))
        except Exception as e:
            logger.error(f"LLM响应解析失败: {str(e)}")
            return {}
    
    def _manual_parse_response(self, content: str) -> Dict[str, Any]:
        """手动解析响应内容"""
        try:
            # 简单的关键字匹配
            content_lower = content.lower()
            
            # 意图分类
            if "factual" in content_lower or "事实" in content_lower:
                intent_type = "factual"
            elif "comparison" in content_lower or "比较" in content_lower:
                intent_type = "comparison"
            elif "analysis" in content_lower or "分析" in content_lower:
                intent_type = "analysis"
            elif "coding" in content_lower or "编程" in content_lower or "代码" in content_lower:
                intent_type = "coding"
            elif "creative" in content_lower or "创意" in content_lower:
                intent_type = "creative"
            else:
                intent_type = "factual"
            
            # 复杂度判断
            is_complex = "complex" in content_lower or "复杂" in content_lower
            
            # 视觉需求（扩展关键词列表）
            visual_keywords = [
                "visual", "图片", "图表", "架构图", "示意图", "流程图", "设计图", "可视化",
                "查看图片", "显示图片", "展示图片", "图片中", "图表中", "图中", "看看",
                "image", "chart", "diagram", "graph", "figure", "visualization",
                "结构图", "系统图", "网络图", "拓扑图"
            ]
            needs_visual = any(keyword in content_lower for keyword in visual_keywords)
            
            return {
                "reasoning": content[:200],  # 取前200字符作为推理
                "intent_type": intent_type,
                "is_complex": is_complex,
                "needs_visual": needs_visual,
                "search_strategies": {
                    "dense_query": content.split("dense_query")[-1] if "dense_query" in content else content[:100],
                    "sparse_keywords": ["查询", "信息"],  # 默认关键词
                    "multi_view_queries": [content[:100]]  # 默认多视角查询
                },
                "sub_queries": []
            }
            
        except Exception as e:
            logger.error(f"手动解析失败: {str(e)}")
            return {}
    
    def _validate_intent_analysis(
        self, 
        analysis: Dict[str, Any], 
        original_query: str
    ) -> Dict[str, Any]:
        """验证和补全意图分析结果"""
        try:
            # 确保所有必需字段存在
            validated = {
                "original_query": original_query,
                "reasoning": analysis.get("reasoning", "基于查询内容分析"),
                "intent_type": analysis.get("intent_type", "factual"),
                "is_complex": analysis.get("is_complex", False),
                "needs_visual": analysis.get("needs_visual", False),
                "search_strategies": {
                    "dense_query": analysis.get("search_strategies", {}).get("dense_query", original_query),
                    "sparse_keywords": analysis.get("search_strategies", {}).get("sparse_keywords", []),
                    "multi_view_queries": analysis.get("search_strategies", {}).get("multi_view_queries", [])
                },
                "sub_queries": analysis.get("sub_queries", [])
            }
            
            # 验证字段值
            valid_intent_types = ["factual", "comparison", "analysis", "coding", "creative"]
            if validated["intent_type"] not in valid_intent_types:
                validated["intent_type"] = "factual"
            
            # 基于原始查询的关键词检查，作为needs_visual的后备验证
            # 如果LLM没有正确识别，但查询中包含视觉相关关键词，强制设置为True
            if not validated["needs_visual"]:
                visual_keywords = [
                    "图片", "图表", "示意图", "流程图", "设计图", "可视化",
                    "查看图片", "显示图片", "展示图片", "图片中", "图表中", "图中", "看看",
                    "image", "chart", "diagram", "graph", "figure", "visualization",
                    "架构图", "结构图", "系统图", "网络图", "拓扑图"
                ]
                query_lower = original_query.lower()
                if any(keyword in query_lower for keyword in visual_keywords):
                    logger.info(f"检测到视觉相关关键词，强制设置needs_visual=True: {original_query}")
                    validated["needs_visual"] = True
            
            # 确保sparse_keywords是列表
            if not isinstance(validated["search_strategies"]["sparse_keywords"], list):
                validated["search_strategies"]["sparse_keywords"] = []
            
            # 确保multi_view_queries是列表
            if not isinstance(validated["search_strategies"]["multi_view_queries"], list):
                validated["search_strategies"]["multi_view_queries"] = []
            
            return validated
            
        except Exception as e:
            logger.error(f"意图分析验证失败: {str(e)}")
            return self._default_intent_analysis(original_query)
    
    def _default_intent_analysis(self, query: str) -> Dict[str, Any]:
        """默认意图分析结果"""
        return {
            "original_query": query,
            "reasoning": "使用默认规则进行简单分析",
            "intent_type": "factual",
            "is_complex": False,
            "needs_visual": False,
            "search_strategies": {
                "dense_query": query,
                "sparse_keywords": [],
                "multi_view_queries": []
            },
            "sub_queries": []
        }
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            # 测试LLM连接
            test_result = await self.llm_manager.chat(
                messages=[{"role": "user", "content": "test"}],
                task_type="intent_recognition",
                max_tokens=10
            )
            
            return {
                "status": "healthy" if test_result.success else "unhealthy",
                "llm_available": test_result.success,
                "test_response": test_result.data is not None
            }
            
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }