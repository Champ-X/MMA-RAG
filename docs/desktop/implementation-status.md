# 桌面端实施记录

基线为 `41691cd41e7f`。在 `codex/tessmora-desktop` 分支分阶段实现。2026-11-24 已交付通过本机安装验收的 macOS Apple Silicon 内部版。Windows x64 原生验收、正式签名、公证和公开发行另排。

## 0.1.1 打开本机已有资料

启动器会检测 `http://localhost:3001/`。当首页显示「本机服务在线」时，点「打开已有资料」进入该服务的素材空间。网页和桌面窗口读写同一服务上的知识库，原有文件、索引和模型设置可以直接使用。保持原来的服务运行即可，无需创建桌面账号、迁移资料或再填一遍模型密钥。

「在浏览器打开」适合继续浏览器里已保存的对话。桌面窗口有独立的浏览器存储；需要转入会话时，可在支持会话导出的网页版设置中导出，再在桌面窗口的「工作区 → 导入或导出会话…」中导入。该实例需要登录时，启动器会提示使用浏览器认证。

「本地文件夹」用于新建或打开独立的桌面工作区。「连接服务器」用于具备访问凭证的其他 Tessmora 实例，凭证由服务管理员签发。默认仅在本次会话使用远程凭证；勾选记住或读取已保存的凭证时才访问系统凭证库。首页与本机资料入口无需钥匙串授权。本机服务重新启动后可在启动器选择「重新检测」。

本机交付的 `ops/desktop-qa/launcher-0.1.1/Tessmora-0.1.1-mac-arm64.dmg` 的 SHA-256 为 `2800b0fdc203b664dc2d4bf270e1cec99450c6261317266e414cf973be8753a5`。从 DMG 更新安装后，实际窗口中的所有素材空间名称与原服务清单逐项匹配，关闭应用后仍可访问原服务。独立文件夹工作区、远程连接回归、窄窗口深色英文界面及键盘返回均通过。安装窗口的取证在同一产物目录的 `installed/report.json` 和 `installed-folder/report.json`。

## 0.1.0 安装与试用

产物在构建工作区的 `ops/desktop-qa/internal-0.1.0/`。以下 SHA-256 对应本次交付的文件。运行包记录的源码版本为 `17db18a22848d9c7bbc0f04c4b1177342ac4561d`。

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `Tessmora-0.1.0-mac-arm64.dmg` | 986,032,760 字节 | `b4e465304c841b4a5514f1fff80d19f2c2bd07bc2be458803d0b30c63775c277` |
| `acceptance/cloud-fixtures.workspace.zip` | 68,822,390 字节 | `4ce00a75cb44fe9d15bd24195bef7f2b05ad2a8b64e32c37fa566674fcc283e8` |

1. 打开 DMG，把 `Tessmora.app` 拖到有写权限的应用目录，弹出磁盘映像后启动。本次在 macOS 27.2.1、arm64 上使用独立目录完成安装，应用约占 2.9 GiB；工作区和可选模型另占空间。
2. 想查看现成资料时，在 macOS 菜单栏选择「工作区 → 从备份恢复…」，选择表中的 ZIP，指定一个尚不存在的工作区目录。回到启动器，打开刚恢复的工作区，在首次设置页选择「浏览本地资料」。两张素材空间卡片分别包含 `manual.pdf` 和 `recording.mp4`。
3. 无模型密钥也可浏览和读取原件。手册第 2 页印有 `CEDAR-17`，将视频拖到第 7 秒可见蓝色矩形。样本只包含合成资料，重新发起云端解析或问答需配置自己的模型服务。备份没有附带 QA 对话历史。
4. 想使用自己的资料时，从启动器选择「本地工作区」，填写名称、选择资料目录并「创建并打开」。连接现有服务则选「连接服务器」，输入启用了全站认证的 Tessmora 地址与访问凭证。本地工作区数据和远程服务各自独立。

### 最终安装包验收

| 测什么 | 对该产物实际做过的检查 |
| --- | --- |
| 安装和退出 | `hdiutil verify` 通过。以只读方式挂载 DMG，用 `ditto` 复制到含中文和空格的安装目录，再卸载映像。安装副本通过 `codesign --verify --deep --strict`，签名为 ad-hoc，标识符为 `com.tessmora.desktop`。两次从该副本启动均正常退出，随后再次校验签名通过。 |
| 首次使用 | 使用新的 Electron 用户目录打开本地工作区，读取能力和认证状态，完成 Qdrant、文件系统检查并创建素材空间。在首次设置页实际进入资料库，确认新建空间可见。 |
| 恢复后使用 | 使用安装副本的传输命令校验并恢复样本归档。真实安装窗口另外打开同一归档的恢复副本，两个原件逐一匹配夹具 SHA-256。签名视频请求返回 HTTP 206 及所请求的 32 字节；Chromium 实际解码并跳到第 7 秒，中心像素 RGB 为 `(0, 0, 255)`。 |
| 打包内容 | 审计核对了前端 289 个文件、后端应用 199 个文件、Pi 源码 7 个文件及 ASAR。内部包使用本地安装包更新。样本归档的 7,045 个条目扫描了实测用的三项服务商密钥值，匹配数为 0。 |

复测时，在产物目录运行 `shasum -a 256 -c SHA256SUMS` 和 `hdiutil verify Tessmora-0.1.0-mac-arm64.dmg`。自动化窗口检查从仓库根目录运行以下命令。参数分别为从 DMG 复制的可执行文件、新的取证目录；第二次另传入刚恢复的**测试副本**和夹具清单。驱动会创建一个测试素材空间，因此要使用可丢弃的工作区。

```sh
binary='/absolute/install/Tessmora.app/Contents/MacOS/Tessmora'
node packages/desktop/qa/installed-window.mjs "$binary" ops/desktop-qa/retest-empty
node packages/desktop/qa/installed-window.mjs "$binary" ops/desktop-qa/retest-restored \
  /absolute/disposable/restored-workspace ops/desktop-qa/fixtures/manifest.json
```

本次日志、截图和 JSON 报告保存在同工作区的 `ops/desktop-qa/final-evidence/`。包内含 Python、Node、Qdrant、FFmpeg、ffprobe 和 LibreOffice，使用 macOS 系统框架、字体和钥匙串。样本备份排除了模型缓存，首次使用相应的本地编码器需另行准备权重。

旧版 macOS 的最低支持版本尚待实机验收。应用清单声明 macOS 13，随 Torch 分发的 `libomp.dylib` 声明最低 macOS 14，macOS 13 的完整本地功能不能据此承诺。随 Python 依赖分发的 `vba_extract.py` 和 `runxlrd.py` 脚本首行保留构建目录，桌面应用没有调用这两个辅助命令。

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
- 授权的云端小样本采用本地原生运行包，实际测试 DeepSeek、SiliconFlow 和阿里云百炼模型连接，完成 PDF、视频入库并各做一次 Direct 问答。答案给出 `CEDAR-17` 以及蓝色矩形约在 0:06 出现。首轮 PDF 回答缺少页码。随后修复了按物理页切分以及提示词、JSON、SSE 和历史中的引用传递。冻结后端离线复测确认同一 PDF 的 `CEDAR-17` 对应第 2 页；独立 Electron 用例从引用打开原件第 2 页。原云端回答和样本备份保留首次测试结果。旧跨页索引保留页码范围，重新入库后可获得更精细的定位。两题的结果仅用于验证工作流。
- 备份现对索引进行流式压缩，恢复时重建稀疏文件。在同一个两份资料的工作区，14.00 GiB 逻辑数据得到 65.63 MiB 归档。一次计时的备份及校验花费 35.21 秒，恢复花费 20.33 秒、实际占盘 205.86 MiB，9 个对象均校验通过。该比率取决于样本索引中的稀疏页。
- 打包前回归通过前端 339 项、桌面 Node 16 项、Pi Node 110 项、CLI 83 项。真实 Electron 客户端通过 15 个断言，包含双工作区隔离、流、媒体和 PDF 引用。最终使用随包 Python 的后端定向回归通过 72 项。
