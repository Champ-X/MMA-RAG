"""
查询改写与扩展处理器
负责查询改写、关键词扩展和多视角重构
"""

from typing import Dict, List, Any, Optional
import json
import re
from collections import Counter

from app.core.llm.manager import llm_manager
from app.core.llm.prompt_engine import prompt_engine
from app.core.logger import get_logger

logger = get_logger(__name__)

class QueryRewriter:
    """查询改写与扩展处理器"""
    
    def __init__(self):
        self.llm_manager = llm_manager
        self.prompt_engine = prompt_engine
        
        # 常见中文停用词
        self.stop_words = {
            "的", "了", "是", "在", "有", "和", "就", "都", "而", "及", "与", "或",
            "一个", "一些", "这个", "那个", "什么", "怎么", "如何", "哪里", "谁",
            "可以", "能够", "应该", "需要", "希望", "想要", "打算", "考虑",
            "吗", "呢", "啊", "呀", "哦", "恩", "嗯"
        }
    
    async def rewrite(
        self,
        original_query: str,
        chat_history: Optional[List[Dict[str, str]]] = None,
        intent_analysis: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        查询改写与扩展
        
        Args:
            original_query: 原始查询
            chat_history: 对话历史
            intent_analysis: 意图分析结果
            
        Returns:
            改写结果
        """
        try:
            # 构建对话历史文本
            chat_history_text = self._format_chat_history(chat_history or [])
            
            # 构建提示词
            prompt = self.prompt_engine.render_template(
                "query_rewriting",
                chat_history=chat_history_text,
                original_query=original_query
            )
            
            # 调用LLM进行查询改写
            messages = [
                {
                    "role": "system",
                    "content": (
                        "你是一个专业的查询改写专家。你的任务是将用户的原始查询"
                        "改写得更加清晰、准确，并生成多种表述方式和关键词。"
                    )
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
            
            result = await self.llm_manager.chat(
                messages=messages,
                task_type="query_rewriting",
                temperature=0.3
            )
            
            if not result.success or not result.data:
                logger.warning(f"查询改写失败: {result.error}, 使用默认值")
                return self._default_rewrite(original_query)
            
            # 解析LLM响应
            rewrite_result = self._parse_rewrite_response(result.data)
            
            # 如果LLM解析失败，使用默认方法
            if not rewrite_result:
                logger.warning("查询改写解析失败，使用默认方法")
                rewrite_result = self._default_rewrite(original_query)
            
            # 后处理：添加SPLADE风格的关键词扩展
            enhanced_result = await self._enhance_with_splade_keywords(
                original_query, rewrite_result
            )
            
            logger.info(f"查询改写完成: 原始='{original_query}' -> 改写='{enhanced_result.get('refined_query', original_query)}'")
            
            return enhanced_result
            
        except Exception as e:
            # 记录详细的错误信息以便调试
            error_type = type(e).__name__
            error_msg = str(e)
            logger.error(
                f"查询改写失败: {error_type}: {error_msg}",
                exc_info=True
            )
            # 即使失败也返回默认结果，确保系统继续运行
            return self._default_rewrite(original_query)
    
    def _format_chat_history(self, chat_history: List[Dict[str, str]]) -> str:
        """格式化对话历史"""
        if not chat_history:
            return "无对话历史"
        
        history_text = []
        for message in chat_history[-3:]:  # 只保留最近3轮对话
            role = "用户" if message["role"] == "user" else "助手"
            content = message["content"][:80]  # 限制长度
            history_text.append(f"{role}: {content}")
        
        return "\n".join(history_text)
    
    def _parse_rewrite_response(self, response_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """解析查询改写响应"""
        try:
            # 提取文本内容
            content = response_data.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            # 尝试解析JSON
            if content.strip().startswith("{"):
                return json.loads(content)
            else:
                # 手动解析
                return self._manual_parse_rewrite(content)
                
        except Exception as e:
            logger.error(f"查询改写响应解析失败: {str(e)}")
            return None
    
    def _manual_parse_rewrite(self, content: str) -> Optional[Dict[str, Any]]:
        """手动解析查询改写响应"""
        try:
            # 提取关键信息
            lines = content.split('\n')
            
            refined_query = content[:50]  # 默认值
            original_query = content[:50]  # 默认值
            multi_view_queries = []
            keywords = []
            
            for line in lines:
                line = line.strip()
                if "重写查询" in line or "改写后" in line:
                    # 提取重写后的查询
                    parts = line.split(":", 1)
                    if len(parts) > 1:
                        refined_query = parts[1].strip()
                elif "关键词" in line:
                    # 提取关键词
                    parts = line.split(":", 1)
                    if len(parts) > 1:
                        keywords_text = parts[1].strip()
                        keywords = [kw.strip() for kw in keywords_text.split(",") if kw.strip()]
                elif "多视角" in line or "不同角度" in line:
                    # 提取多视角查询
                    parts = line.split(":", 1)
                    if len(parts) > 1:
                        queries_text = parts[1].strip()
                        queries = [q.strip() for q in queries_text.split("；") if q.strip()]
                        multi_view_queries = queries
            
            return {
                "refined_query": refined_query,
                "multi_view_queries": multi_view_queries,
                "keywords": keywords,
                "original_query": original_query
            }
            
        except Exception as e:
            logger.error(f"手动解析失败: {str(e)}")
            return None
    
    async def _enhance_with_splade_keywords(
        self,
        original_query: str,
        rewrite_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """使用类似SPLADE的方法增强关键词"""
        try:
            # 提取查询中的重要词汇
            base_keywords = rewrite_result.get("keywords", [])
            
            # 添加从原始查询和改写查询中提取的关键词
            enhanced_keywords = await self._extract_keywords_from_queries([
                original_query,
                rewrite_result.get("refined_query", original_query)
            ] + rewrite_result.get("multi_view_queries", []))
            
            # 合并和去重
            all_keywords = list(set(base_keywords + enhanced_keywords))
            
            # 限制关键词数量
            all_keywords = all_keywords[:10]
            
            # 更新结果
            rewrite_result["keywords"] = all_keywords
            
            return rewrite_result
            
        except Exception as e:
            logger.error(f"关键词增强失败: {str(e)}")
            return rewrite_result
    
    async def _extract_keywords_from_queries(self, queries: List[str]) -> List[str]:
        """从查询中提取关键词"""
        try:
            keywords = []
            
            for query in queries:
                # 简单的关键词提取
                # 1. 去除标点符号和停用词
                words = re.findall(r'[\u4e00-\u9fa5a-zA-Z0-9]+', query)
                
                for word in words:
                    word = word.strip()
                    if len(word) >= 2 and word not in self.stop_words:
                        keywords.append(word)
            
            # 统计词频并选择高频词
            word_counter = Counter(keywords)
            frequent_words = [word for word, count in word_counter.most_common(5)]
            
            return frequent_words
            
        except Exception as e:
            logger.error(f"关键词提取失败: {str(e)}")
            return []
    
    def _default_rewrite(self, original_query: str) -> Dict[str, Any]:
        """默认查询改写结果"""
        return {
            "refined_query": original_query,
            "multi_view_queries": [],
            "keywords": [],
            "original_query": original_query
        }
    
    async def generate_multi_view_queries(
        self,
        query: str,
        num_views: int = 3
    ) -> List[str]:
        """生成多视角查询"""
        try:
            prompt = f"""
请将以下查询改写成 {num_views} 个不同角度的表述方式，保持原意不变：

原始查询：{query}

要求：
1. 每个改写都要表达相同的核心含义
2. 使用不同的词汇和句式
3. 适合用于语义检索的多样性增强

请直接输出改写后的查询，每行一个：
"""
            
            messages = [
                {
                    "role": "system",
                    "content": "你是一个专业的查询改写专家。"
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
            
            result = await self.llm_manager.chat(
                messages=messages,
                task_type="query_rewriting",
                temperature=0.5
            )
            
            if result.success and result.data:
                content = result.data.get("choices", [{}])[0].get("message", {}).get("content", "")
                
                # 解析多视角查询
                queries = []
                lines = content.split('\n')
                for line in lines:
                    line = line.strip()
                    if line and not line.startswith('#') and not line.startswith('要求'):
                        # 移除编号
                        clean_line = re.sub(r'^\d+\.?\s*', '', line)
                        if clean_line:
                            queries.append(clean_line)
                
                return queries[:num_views]
            else:
                # 返回默认值
                return [f"关于{query}的信息", f"{query}的详细内容", f"查询{query}相关资料"]
                
        except Exception as e:
            logger.error(f"生成多视角查询失败: {str(e)}")
            return [f"关于{query}的信息"]
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            # 测试LLM连接
            test_result = await self.llm_manager.chat(
                messages=[{"role": "user", "content": "测试查询改写"}],
                task_type="query_rewriting",
                max_tokens=50
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