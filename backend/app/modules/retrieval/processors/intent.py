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
        chat_history: Optional[List[Dict[str, str]]] = None,
        attachment_context_block: Optional[str] = None,
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
            
            block = (attachment_context_block or "").strip()
            if not block:
                block = "（本轮无用户上传的图片/音频摘要）"

            # 构建提示词
            prompt = self.prompt_engine.render_template(
                "one_pass_intent",
                chat_history=chat_history_text,
                raw_query=query,
                attachment_context_block=block,
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
            
            # 视觉意图判断（基于关键词的简单fallback逻辑）
            visual_keywords_explicit = [
                "visual", "图片", "图表", "架构图", "示意图", "流程图", "设计图", "可视化",
                "查看图片", "显示图片", "展示图片", "图片中", "图表中", "图中", "看看",
                "image", "chart", "diagram", "graph", "figure", "visualization",
                "结构图", "系统图", "网络图", "拓扑图"
            ]
            has_explicit_visual = any(keyword in content_lower for keyword in visual_keywords_explicit)
            
            # 简单的视觉意图判断（fallback逻辑）
            if has_explicit_visual:
                visual_intent = "explicit_demand"
                visual_reasoning = "检测到明确的视觉相关关键词"
            else:
                # 简单的隐性判断（fallback，实际应该由LLM判断）
                visual_intent = "unnecessary"
                visual_reasoning = "未检测到明确的视觉需求"
            
            # 音频意图判断（fallback，与视觉意图结构对齐：explicit > implicit > unnecessary）
            explicit_audio_keywords_fallback = [
                "找音频", "找音乐", "找歌", "有录音吗", "有音乐吗", "播放", "听一下", "听这段", "放一下", "给我听",
                "有没有音频", "play", "listen to", "find the song", "audio", "music", "podcast", "recording",
                "音频", "音乐", "歌曲", "播客", "录音", "语音", "播放一下"
            ]
            implicit_audio_keywords_fallback = [
                "歌词", "旋律", "创作背景", "播客", "访谈", "会议纪要", "演讲", "培训录音",
                "lyrics", "melody", "podcast", "interview", "meeting", "recording"
            ]
            has_explicit_audio = any(kw in content_lower for kw in explicit_audio_keywords_fallback)
            has_implicit_audio = any(kw in content_lower for kw in implicit_audio_keywords_fallback)
            if has_explicit_audio:
                audio_intent = "explicit_demand"
                audio_reasoning = "检测到明确的音频请求关键词"
            elif has_implicit_audio:
                audio_intent = "implicit_enrichment"
                audio_reasoning = "检测到与音频载体强相关的主题（歌词/播客/会议等）"
            else:
                audio_intent = "unnecessary"
                audio_reasoning = "未检测到音频需求"
            # 视频意图（与视觉/音频对齐：explicit > implicit > unnecessary）
            explicit_video_keywords_fallback = [
                "视频", "片段", "视频片段", "视频画面", "画面解释", "结合视频", "结合画面",
                "有视频吗", "找视频", "播放视频", "看一下视频", "看视频", "展示视频",
                "video", "clip", "segment", "show me the video", "play the clip"
            ]
            implicit_video_keywords_fallback = [
                "教程", "演示", "录屏", "回放", "直播", "纪录片", "演讲视频", "会议录像",
                "操作演示", "教学视频", "发布会", "录播", "直播回放", "教程视频", "录播课",
                "tutorial", "demo", "recording", "playback", "webinar", "keynote"
            ]
            has_explicit_video = any(kw in content_lower for kw in explicit_video_keywords_fallback)
            has_implicit_video = any(kw in content_lower for kw in implicit_video_keywords_fallback)
            if has_explicit_video:
                video_intent = "explicit_demand"
                video_reasoning = "检测到明确的视频请求关键词"
            elif has_implicit_video:
                video_intent = "implicit_enrichment"
                video_reasoning = "检测到与视频载体强相关的主题（教程、演示、录播等），判为隐性增益"
            else:
                video_intent = "unnecessary"
                video_reasoning = "未检测到视频需求"
            return {
                "reasoning": content[:200],
                "intent_type": intent_type,
                "is_complex": is_complex,
                "visual_intent": visual_intent,
                "visual_reasoning": visual_reasoning,
                "audio_intent": audio_intent,
                "audio_reasoning": audio_reasoning,
                "video_intent": video_intent,
                "video_reasoning": video_reasoning,
                "search_strategies": {
                    "dense_query": content.split("dense_query")[-1] if "dense_query" in content else content[:100],
                    "sparse_keywords": ["查询", "信息"],
                    "multi_view_queries": [content[:100]]
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
                "visual_intent": analysis.get("visual_intent", "unnecessary"),
                "visual_reasoning": analysis.get("visual_reasoning", "未检测到明确的视觉需求"),
                "audio_intent": analysis.get("audio_intent", "unnecessary"),
                "audio_reasoning": analysis.get("audio_reasoning", "未检测到音频需求"),
                "video_intent": analysis.get("video_intent", "unnecessary"),
                "video_reasoning": analysis.get("video_reasoning", "未检测到视频需求"),
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
            
            # 验证 visual_intent（与 audio_intent 逻辑对齐：显式请求词优先，无效时按显式/隐性关键词推断）
            valid_visual_intents = ["explicit_demand", "implicit_enrichment", "unnecessary"]
            # 明确的视觉请求词（优先级最高，必须判断为 explicit_demand）
            explicit_visual_request_keywords = [
                "看看", "给我看", "看一下", "展示", "显示",
                "有图吗", "有图片吗", "有图表吗", "有架构图吗", "有示意图吗",
                "show me", "let me see", "display", "view",
                "图片", "图表", "示意图", "流程图", "设计图", "可视化",
                "查看图片", "显示图片", "展示图片", "图片中", "图表中", "图中",
                "image", "chart", "diagram", "graph", "figure", "visualization",
                "架构图", "结构图", "系统图", "网络图", "拓扑图"
            ]
            # 隐性视觉相关主题（无明确请求时可推断为 implicit_enrichment：空间结构性/视觉审美性/数据对比性）
            implicit_visual_keywords = [
                "风光", "景色", "日出", "日落", "建筑", "外观", "造型", "界面", "UI", "布局",
                "系统架构", "技术架构", "架构设计", "拓扑", "数据对比", "营收对比", "性能对比", "指标对比",
                "产品图", "实物图", "截图", "照片", "实拍", "设计", "可视化展示",
                "landscape", "architecture", "layout", "design", "screenshot", "photo"
            ]
            query_lower = original_query.lower()
            has_explicit_visual_request = any(kw in query_lower for kw in explicit_visual_request_keywords)
            has_implicit_visual_topic = any(kw in query_lower for kw in implicit_visual_keywords)
            if validated["visual_intent"] not in valid_visual_intents:
                if has_explicit_visual_request:
                    logger.info("检测到明确的视觉请求关键词，设置visual_intent=explicit_demand: {}", original_query)
                    validated["visual_intent"] = "explicit_demand"
                    validated["visual_reasoning"] = "检测到明确的视觉请求关键词"
                elif has_implicit_visual_topic:
                    validated["visual_intent"] = "implicit_enrichment"
                    validated["visual_reasoning"] = "检测到与视觉/空间/展示强相关的主题（架构、风光、对比等），判为隐性增益"
                else:
                    validated["visual_intent"] = "unnecessary"
                    validated["visual_reasoning"] = "未检测到明确的视觉需求"
            elif has_explicit_visual_request and validated["visual_intent"] != "explicit_demand":
                logger.info(
                    "检测到明确的视觉请求关键词，强制覆盖visual_intent: {} -> explicit_demand, 查询: {}",
                    validated["visual_intent"], original_query
                )
                validated["visual_intent"] = "explicit_demand"
                validated["visual_reasoning"] = (
                    "检测到明确的视觉请求关键词，优先判断为显式需求"
                )
            elif has_implicit_visual_topic and validated["visual_intent"] == "unnecessary":
                # 与音频一致：查询具有隐性视觉主题但 LLM 判为 unnecessary 时，用关键词补正为 implicit_enrichment
                logger.info(
                    "检测到隐性视觉相关主题，补正visual_intent: unnecessary -> implicit_enrichment, 查询: {}",
                    original_query
                )
                validated["visual_intent"] = "implicit_enrichment"
                validated["visual_reasoning"] = "检测到与视觉/空间/展示强相关的主题（架构、风光、对比等），判为隐性增益"
            
            # 确保sparse_keywords是列表
            if not isinstance(validated["search_strategies"]["sparse_keywords"], list):
                validated["search_strategies"]["sparse_keywords"] = []
            
            # 确保multi_view_queries是列表
            if not isinstance(validated["search_strategies"]["multi_view_queries"], list):
                validated["search_strategies"]["multi_view_queries"] = []
            
            # 验证 audio_intent（与 visual_intent 逻辑对齐：明确请求词优先，无效时按关键词推断）
            valid_audio_intents = ["explicit_demand", "implicit_enrichment", "unnecessary"]
            # 明确的音频请求词（优先级最高，必须判断为 explicit_demand）
            explicit_audio_request_keywords = [
                "找音频", "找音乐", "找歌", "有录音吗", "有音乐吗", "播放", "听一下", "听这段", "放一下", "给我听",
                "有没有音频", "play", "listen to", "find the song", "audio", "music", "podcast", "recording",
                "音频", "音乐", "歌曲", "播客", "录音", "语音", "播放一下"
            ]
            # 隐性音频相关词（无明确请求时可推断为 implicit_enrichment）
            implicit_audio_keywords = [
                "歌词", "旋律", "创作背景", "播客", "访谈", "会议纪要", "演讲", "培训录音",
                "lyrics", "melody", "interview", "meeting"
            ]
            query_lower_audio = original_query.lower()
            has_explicit_audio_request = any(kw in query_lower_audio for kw in explicit_audio_request_keywords)
            has_implicit_audio_topic = any(kw in query_lower_audio for kw in implicit_audio_keywords)
            if validated["audio_intent"] not in valid_audio_intents:
                if has_explicit_audio_request:
                    logger.info("检测到明确的音频请求关键词，设置audio_intent=explicit_demand: {}", original_query)
                    validated["audio_intent"] = "explicit_demand"
                    validated["audio_reasoning"] = "检测到明确的音频请求关键词"
                elif has_implicit_audio_topic:
                    validated["audio_intent"] = "implicit_enrichment"
                    validated["audio_reasoning"] = "检测到与音频载体强相关的主题（歌词/播客/会议等）"
                else:
                    validated["audio_intent"] = "unnecessary"
                    validated["audio_reasoning"] = "未检测到音频需求"
            elif has_explicit_audio_request and validated["audio_intent"] != "explicit_demand":
                logger.info(
                    "检测到明确的音频请求关键词，强制覆盖audio_intent: {} -> explicit_demand, 查询: {}",
                    validated["audio_intent"], original_query
                )
                validated["audio_intent"] = "explicit_demand"
                validated["audio_reasoning"] = (
                    "检测到明确的音频请求关键词，优先判断为显式需求"
                )
            # 视频意图（与视觉/音频对齐：显式请求词优先，无效时按显式/隐性关键词推断）
            valid_video_intents = ["explicit_demand", "implicit_enrichment", "unnecessary"]
            explicit_video_keywords = [
                "视频", "片段", "视频片段", "视频画面", "画面解释", "结合视频", "结合画面",
                "有视频吗", "找视频", "播放视频", "看一下视频", "看视频", "展示视频",
                "video", "clip", "segment", "show me the video", "play the clip"
            ]
            implicit_video_keywords = [
                "教程", "演示", "录屏", "回放", "直播", "纪录片", "演讲视频", "会议录像",
                "操作演示", "教学视频", "发布会", "录播", "直播回放", "教程视频", "录播课",
                "tutorial", "demo", "recording", "playback", "webinar", "keynote"
            ]
            query_lower_video = original_query.lower()
            has_explicit_video_request = any(kw in query_lower_video for kw in explicit_video_keywords)
            has_implicit_video_topic = any(kw in query_lower_video for kw in implicit_video_keywords)
            if validated.get("video_intent") not in valid_video_intents:
                if has_explicit_video_request:
                    logger.info("检测到明确的视频请求关键词，设置video_intent=explicit_demand: {}", original_query)
                    validated["video_intent"] = "explicit_demand"
                    validated["video_reasoning"] = "检测到明确的视频请求关键词"
                elif has_implicit_video_topic:
                    validated["video_intent"] = "implicit_enrichment"
                    validated["video_reasoning"] = "检测到与视频载体强相关的主题（教程、演示、录播等），判为隐性增益"
                else:
                    validated["video_intent"] = "unnecessary"
                    validated["video_reasoning"] = "未检测到视频需求"
            elif has_explicit_video_request and validated.get("video_intent") != "explicit_demand":
                logger.info(
                    "检测到明确的视频请求关键词，强制覆盖video_intent: {} -> explicit_demand, 查询: {}",
                    validated["video_intent"], original_query
                )
                validated["video_intent"] = "explicit_demand"
                validated["video_reasoning"] = "检测到明确的视频请求关键词（如'结合视频'、'看视频'等），优先判断为显式需求"
            elif has_implicit_video_topic and validated.get("video_intent") == "unnecessary":
                logger.info(
                    "检测到隐性视频相关主题，补正video_intent: unnecessary -> implicit_enrichment, 查询: {}",
                    original_query
                )
                validated["video_intent"] = "implicit_enrichment"
                validated["video_reasoning"] = "检测到与视频载体强相关的主题（教程、演示、录播等），判为隐性增益"
            
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
            "visual_intent": "unnecessary",
            "visual_reasoning": "使用默认规则，未检测到明确的视觉需求",
            "audio_intent": "unnecessary",
            "audio_reasoning": "使用默认规则，未检测到音频需求",
            "video_intent": "unnecessary",
            "video_reasoning": "使用默认规则，未检测到视频需求",
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