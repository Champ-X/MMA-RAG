# 桌面端实施记录

基线为 `41691cd41e7f`。在 `codex/tessmora-desktop` 分支分阶段实现。原生打包先在 macOS Apple Silicon 上验证，Windows x64 使用独立的原生验证结果。各项发布承诺以真实产物和对应验收结果为准。

### 已验证的内部实现

| 范围 | 当前证据 | 验证边界 |
| --- | --- | --- |
| 客户端 | macOS arm64 上实际启动 Electron 45.4.1。两个隔离工作区完成 SSE、Range 206/416、4 MiB 上传校验和、隔离的历史与 IndexedDB 附件重开、受限 HTML 预览。执行 `npm --prefix packages/desktop run test:electron` 可复测。 | 使用受认证的本机模拟远程服务。真实模型生成和来源质量需独立验收。 |
| 本地运行 | 以锁定的 Python、Node、Qdrant、FFmpeg 和 Python 依赖生成 macOS 原生包。专用中文/空格目录实测免 Docker 启动，认证 API 返回索引与对象存储就绪。双开拒绝，关闭释放监听端口，重开保留 UUID 并轮换访问令牌。首次联合检查用时约 6.3 秒，含第二实例拒绝检查。 | 本机开发环境实测。此数值不代表最低配置或干净机冷启动预算。Windows 有独立依赖锁与构建入口。 |
| 存储与媒体 | 本地文件系统对象目录、SQLite 元数据、逻辑键、签名媒体 GET/HEAD 及 Range 已接入。服务器配置继续走 MinIO。运行 `backend/tests/test_desktop_objects.py`、`test_desktop_access.py` 可重放认证与对象测试。 | 已验证真实文件系统与 HTTP 路由，迁移后的旧引用另行测试。 |
| 模型与夹具 | 使用随包 Python 在独立目录复制的本地模型缓存中，断网模式实际执行 BGE-M3、CLIP、CLAP 推理准备，验证的文件尺寸合计分别为 2,295,419,800、1,714,256,474、617,866,170 字节。两次生成合成 PDF、XLSX、音频、图片、视频及同名附件的 SHA-256 清单一致。 | 使用已有模型缓存，下载量、云端生成、回答质量分别验收。 |

原生复测从仓库根目录执行，构建目标和夹具输出需使用新的目录。构建机需有 Python 3.12+、uv、npm；目标用户通过安装包运行。

```sh
python3 packages/desktop/runtime/packaging/assemble.py --cache ops/desktop-qa/downloads --output ops/desktop-qa/runtime
node packages/desktop/qa/native-workspace.mjs ops/desktop-qa/runtime
ops/desktop-qa/runtime/python/bin/python3.11 packages/desktop/qa/fixtures.py --runtime ops/desktop-qa/runtime --output ops/desktop-qa/fixtures
```

macOS 构建机已有 LibreOffice 时可传 `--office /Applications/LibreOffice.app`，Windows 接受含 `program/soffice.exe` 的安装目录。Windows 打包的解释器位于 `runtime/python/python.exe`。单机运行数据放在所选工作区，模型存于 `state/models`，原件与目录索引在 `state/objects` 和 `state/objects-metadata`，向量数据在 `qdrant`。正式签名、许可和干净系统验证结果单独记录。
