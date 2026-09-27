# 图片引用展示修复（2026-09-23）

## 诊断与范围

用户截图中的材料对应 test 知识库的《申请本科成绩单.pdf》。实际 5 张 JPEG 均存在，引用刷新接口及图片 GET 返回 200。不能据此将原始截图归因于文件丢失或 Jev。

用户提供的 b26b76de-e60b-4ed5-bd79-6eda0dbec1bc 会话未出现在本次可控制浏览器的本地历史中，后端 history 也未保留该会话；因此没有声称取得原回答的网络错误。本次使用相同 PDF 在真实聊天页面复测，并单独验证错误分支。

确认并修复：
- stream_manager 原来在正文全部生成后才下发 citation；现在在开始模型输出前发送一次，正文首次引用即可插图，异常结束时也保留来源。
- ParagraphImageDisplay 加载/刷新失败后会移除整张图，且 onError 未检查已刷新标记，刷新后的坏 URL 可能反复刷新。改用 ReferenceImage：过期地址预刷新、每次尝试最多自动刷新一次、加载超时提示、手动重试、卸载/切换后忽略旧响应。取消异步事件返回后操作 currentTarget 的做法。
- 原来流式内容变化会重新创建 p/li 组件类型，重挂载图片并重置加载状态。改为稳定的组件类型，通过上下文传递当前引用匹配结果；仍按首次出现去重。

## 验证

- 真实 UI 提问：如何申请哈尔滨工业大学本科成绩单？请结合操作截图说明步骤。
- 5 张图片实际解码且可见，naturalWidth 分别为 1007、1068、1054、1156、1153。
- restored-images.png：实际聊天页面的注册、服务选择等步骤及图片。
- browser-results.json：无签名参数的 DOM 加载证据。
- 临时浏览器回归页使用真实图片刷新接口，覆盖过期 URL、损坏 URL、对象不存在、手动重试、URL 更新恢复。
- 对“刷新后 URL 仍损坏”使用局部模拟响应：只刷新 1 次，保留错误和重试入口。
- 追加正文并重复引用：图片 DOM 身份保持不变，数量仍为 1。
- 390px 视口检查，随后恢复桌面视口。
- 后端 131 passed：test_stream_manager_terminal_error.py、test_jev*.py、test_conversation_context.py。
- 前端 npm run build、修改组件的 React Hooks lint、git diff --check 通过。已有 bundle 大小及 React Router future flag 提示。
- 新 SSE 测试断言 citation 在模型迭代启动前送出，正常/异常路径均只发送一次。Jev 集成测试保留“审计在完整正文之后、DONE 之前”的约束，更新了旧的引用事件顺序假设。
