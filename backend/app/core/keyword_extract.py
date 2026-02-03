"""
画像摘要关键词提取：使用 jieba 从 topic_summary 中提取词云关键词，供前端气泡图展示。
"""
from typing import List

try:
    import jieba.analyse as jieba_analyse
    _JIEBA_AVAILABLE = True
except ImportError:
    _JIEBA_AVAILABLE = False


def extract_keywords_for_portrait(text: str, top_k: int = 10) -> List[str]:
    """
    从画像摘要文本中提取关键词（词云用），支持中英文。
    使用 jieba 的 TF-IDF 关键词抽取，适合主题摘要的关键词展示。
    """
    text = str(text).strip()
    if not text:
        return []
    if not _JIEBA_AVAILABLE:
        return _fallback_extract(text, top_k)
    try:
        # extract_tags 默认 TF-IDF，topK 限制数量；withWeight=False 返回 list[str]，类型桩可能标成 tuple，统一按字符串取词
        tags = jieba_analyse.extract_tags(text, topK=top_k, withWeight=False)
        words: List[str] = []
        for t in tags:
            w = str(t[0] if isinstance(t, (tuple, list)) else t).strip()
            if w:
                words.append(w)
        return words[:top_k]
    except Exception:
        return _fallback_extract(text, top_k)


def _fallback_extract(text: str, top_k: int) -> List[str]:
    """无 jieba 或出错时：按标点/空格切分取前 top_k 个非空片段。"""
    import re
    parts = re.split(r"[，。、；：！？\s]+", text)
    return [p.strip() for p in parts if p.strip()][:top_k]
