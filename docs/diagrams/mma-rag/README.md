# MMA-RAG 双语手写架构图

中文、英文各一张完整可编辑画布，均包含五个分区：系统全景、多模态入库与索引、检索与问答、Pi 运行时、部署与数据契约。每版有 400 个元素，包括 170 个手写文本和 93 条箭头。

图中架构对应 **2026-11-05、`main` 分支的 `658b0d1` 源码快照**。本次将既有成果归档到项目；未按后续代码变化重新修订图中内容。当前实现说明见 [系统架构](../../MMA_ARCHITECTURE.md)。

此后 Pi 已默认使用 Durable 恢复符合条件的未完成任务，并支持可选的原生图片 CLIP / 音频 CLAP 召回。完整图中“重启后中断任务”和“未接入原生 CLIP/CLAP”的描述属于旧快照；当前配置、恢复与检索边界见 [Pi Durable](../../pi-agent-durable.md)。

## 文件

| 版本 | 可编辑源文件 | 矢量预览 | PNG 预览 |
| --- | --- | --- | --- |
| 中文 | [MMA-RAG-cn.excalidraw](MMA-RAG-cn.excalidraw) | [SVG](MMA-RAG-cn-handwritten.svg) | [PNG](MMA-RAG-cn-handwritten.png) |
| English | [MMA-RAG-en.excalidraw](MMA-RAG-en.excalidraw) | [SVG](MMA-RAG-en-handwritten.svg) | [PNG](MMA-RAG-en-handwritten.png) |

- `.excalidraw` 是编辑母版：文字、形状、箭头及绑定关系均保留，可继续修改。
- SVG 的文字已转换为矢量轮廓，PNG 为 9100 × 3910 像素；预览无需安装字体，但不能像母版一样逐字编辑。
- [双语原始文案](architecture-text-source.json) 保留两种语言的文字对应关系；画布中的换行和少量符号经过排版调整。
- [文件清单](manifest.json) 记录源码快照、文件大小与 SHA-256 校验值。
- 项目 README 使用 [中文总览](overview-cn.png) / [English overview](overview-en.png) 裁切，便于在正文中阅读。两图仅截取系统全景；裁切坐标、来源哈希与输出哈希见 [展示资源清单](../../media/tessmora-intro/manifest.json)。原始画布与完整导出保持不变。

## 打开与切换

在 [Excalidraw](https://excalidraw.com/) 或兼容的本地编辑器中，从菜单选择“打开”，或将对应的 `.excalidraw` 文件拖入画布。英文打开 `MMA-RAG-en.excalidraw`，中文打开 `MMA-RAG-cn.excalidraw`；切换前先保存未归档的编辑。这些文件不依赖项目运行服务或特定的 MCP 会话。

编辑完成后，使用编辑器的“保存到文件”更新对应母版；载入画布不会自动写回仓库。内容更新时同时更新两语言文案、预览与文件清单。

## 手写字体

两版的原生文本均设为 `fontFamily: 5`（Excalifont）。中文由支持该字体方案的 Excalidraw 加载 Xiaolai 字体补充；字体资源由编辑器提供，不封装在 `.excalidraw` 文件中。离线展示或跨设备字体效果不一致时，可直接使用这里的 SVG / PNG 预览。
