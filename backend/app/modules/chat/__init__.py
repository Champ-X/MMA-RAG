"""对话相关能力（附件摘要等，与知识库入库链路隔离）。"""

from .attachment_summarizer import ChatAttachmentSummarizer, summarize_chat_attachments

__all__ = ["ChatAttachmentSummarizer", "summarize_chat_attachments"]
