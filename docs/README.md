# Tessmora 文档

从 [项目介绍与快速开始](../README.md) 安装并完成第一次带引用的问答。以下文档描述当前实现；API 请求字段以运行实例的 `/docs` 为准。

| 任务 | 文档 |
| --- | --- |
| 启动、停止、排查环境和恢复数据 | [本地启动](LOCAL_STARTUP.md) |
| 理解模块边界、数据流与会话持久化 | [系统架构](MMA_ARCHITECTURE.md) |
| 理解图片、音频、视频的索引与召回 | [多模态技术说明](MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC.md) |
| 配置自主研究与只读工具 | [Pi Agent](PI_AGENT_MODE.md) |
| 配置可选的需求核验与引用诊断 | [Decision 模型](DECISION_MODELS.md) |
| 使用行内文件与本机附件 | [引用与附件协议](chat-inline-references.md) |
| 排查服务商路由与连接 | [模型调用](MODEL_CALL_RELIABILITY.md) |
| 接入 CLI / Codex 或飞书 | [CLI](../skills/mma-rag/references/cli-reference.md) · [飞书](FEISHU_BOT_SETUP.md) |
| 复现检索及生成评测 | [RAG 基线](RAG_EVALUATION.md) · [检索评测](RETRIEVAL_EVALUATION_V2.md) |
| 修改代码、提交文件、控制仓库体积 | [贡献指南](../CONTRIBUTING.md) · [仓库维护](REPOSITORY.md) |
| 部署安全 | [安全说明](../SECURITY.md) |

实验笔记、逐次验收记录和私人语料不属于使用文档。历史材料可按提交查阅；新实验输出应放在忽略目录中。更新行为时同步修改对应技术文档，中英文 README 只保留稳定能力和入门路径。
