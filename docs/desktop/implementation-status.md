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

### 本机内测与交付范围

使用者已确认先交付 macOS Apple Silicon 的本地可验收内部版。安装磁盘映像内有 Tessmora.app，可拖到应用目录，也可安装到当前用户有写权限的目录。首次打开选择空目录或已有的 Tessmora 桌面工作区；旧 CLI、Compose 数据按[数据迁移说明](data-transfer.md)导入。启动器的远程选项连接已有、全站受认证的 Tessmora 根地址。关闭工作区窗口可以继续后台入库，菜单栏提供重新打开和退出。

本机通过 macOS 系统钥匙串实际执行了临时凭证新建、读取、轮换与删除。云端测试仅使用合成资料和隔离的工作区，完成后移除临时钥匙串项目。普通资料备份包含原件；诊断报告按白名单导出版本和组件状态。工作区菜单提供备份到新文件和恢复到新目录的入口。应用内「检查更新」仅在正式签名构建启用网络更新。内部版以替换应用安装，资料保存在独立工作区。

在 macOS 上复建内部安装包，可在仓库根目录运行以下命令。包含 Office 转换时给上述 assemble 步骤传入 LibreOffice 应用路径。

```sh
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix packages/desktop ci
TESSMORA_RUNTIME_DIR="$PWD/ops/desktop-qa/runtime" npm --prefix packages/desktop run dist
```

正式构建由发行者设置 `TESSMORA_SIGNED_RELEASE=1`、系统签名/公证参数和 `TESSMORA_UPDATE_TRUST_FILE`。信任文件仅含 HTTPS 渠道目录 `feed` 与 PEM 格式的 Ed25519 公钥 `publicKey`；Windows 另指定 `TESSMORA_WINDOWS_PUBLISHER`。原生签名成功后执行 `node packages/desktop/release/sign-manifest.mjs <产物目录> <darwin-arm64或win32-x64> <应用版本> <运行包版本> <私钥文件>`，由发布负责人分发平台更新元数据、签名清单和对应产物。构建命令默认禁止发布。正式签名身份、公开分发许可、Windows 真机和跨版本签名安装演练由后续发行阶段验收。

### 数据和资源实测

- 压力用例把 12 秒可播放视频用合法的 MP4 free box 填充到 128 MiB，分别提交一份和四份，在隔离工作区暂停入库 worker，采样 FastAPI 的 RSS。一次本机测量的峰值增量分别为 320 KiB 与 608 KiB，耗时 234 ms 与 1,003 ms。硬杀宿主后，五个已接收 ID 和完整的输入仍在 SQLite 与 spool 中。采样仅覆盖接收阶段，不包含后续解析或推理的峰值。
- 从真实 MinIO 和原生 Qdrant 迁移合成旧实例，停机备份并恢复后，再通过 HTTP 打开 PDF、视频和原有 Pi 来源。转移前后原件 SHA-256、multipart ETag、知识库/point ID 与媒体定位一致。本地模型和 Office 另有真实图片、音频和中文 PDF 渲染验收。[取证和复测命令](native-acceptance-2026-11-24.md)
- 授权的云端小样本采用本地原生运行包，真实测试 DeepSeek、SiliconFlow 和阿里云百炼模型连接，完成 PDF、视频入库并各做一次 Direct 问答。答案给出 `CEDAR-17` 以及蓝色矩形约在 0:06 出现。首轮 PDF 回答未给页码，此项单独跟踪修复。此两题只检验工作流，不作为与服务器等质的检索基准。
