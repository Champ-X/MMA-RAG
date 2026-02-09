# 知识库「自动导入」能力设计（保持模块化）

## 1. 现状简要

- **上传入口**：仅支持本地上传 → `POST /api/upload/file`、`/api/upload/batch`（multipart）。
- **核心管道**：`IngestionService.process_file_upload(file_content, file_path, kb_id, user_id)` 是唯一「把一份内容写入知识库」的入口，内部完成：解析 → MinIO → 向量 → Qdrant。
- **结论**：只要能得到 `(bytes, filename)`，就可以复用整条管道，无需改 ingestion 内部逻辑。

因此，自动导入（如从网络下载）应做成「多种内容来源」接入同一条管道，而不是重写上传逻辑。

---

## 2. 设计原则

- **管道不变**：`process_file_upload` 保持为唯一写入入口，参数与行为不变。
- **来源可扩展**：新增「自动导入」方式 = 新增一种「内容来源」实现，统一产出 `(content, suggested_filename)` 后交给现有管道。
- **API 职责清晰**：上传（upload）= 用户主动传文件；导入（import）= 系统按配置/请求从外部拉取再写入，两者在 API 层区分，在 ingestion 层统一。

---

## 3. 推荐结构：Ingestion Sources（内容来源层）

在 **ingestion 模块内** 增加「内容来源」子层，专门负责「从某处拿到 bytes + 建议文件名」，不负责解析/存 MinIO/向量。

```
backend/app/modules/ingestion/
├── service.py              # 不变，仍只认 (bytes, path, kb_id, user_id)
├── parsers/
├── splitters/
├── storage/
└── sources/                # 新增：内容来源
    ├── __init__.py
    ├── base.py             # 抽象接口 / 协议
    ├── url.py              # 从 URL 下载
    └── (后续) rss.py, s3.py, ...
```

- **base**：定义「来源」协议，例如返回 `(content: bytes, suggested_filename: str)`，可选 `content_type` 等。
- **url**：实现「给定 URL，下载得到 bytes + 文件名」（可从 URL 路径或 Content-Disposition 解析）。
- 后续可加：RSS、S3、Git 等，均实现同一接口，由 API 或任务调度按需选用。

这样：

- 不破坏现有模块边界：ingestion 仍然负责「一切进知识库的输入」的协调，sources 只是输入的一种可扩展方式。
- 与现有 `ParserFactory`、`MinIOAdapter` 等并列，职责清晰：sources = 从哪里拿；parsers = 怎么解析；storage = 怎么存。

---

## 4. API 设计建议

- **保留现有**  
  - `POST /api/upload/file`  
  - `POST /api/upload/batch`  
  行为与路由前缀不变，仍只处理「本地上传」。

- **新增「导入」路由**（建议单独前缀，便于权限/审计/限流）：  
  - `POST /api/import/url`  
    - Body：`{ "url": "https://...", "kb_id": "...", "filename": "可选覆盖名" }`  
    - 逻辑：用 `sources.url` 拉取 → 得到 `(content, filename)` → 调用 `ingestion_service.process_file_upload(...)` → 返回与上传接口一致的字段（如 `file_id`, `processing_id`, `status` 等），便于前端复用进度/结果展示。
  - `POST /api/import/folder`（扩展 1：指定本地文件夹导入，已实现）  
    - Body：`{ "folder_path": "/data/docs", "kb_id": "...", "recursive": true, "extensions": [".pdf", ".txt", ".md"], "exclude_patterns": ["__pycache__", "*.tmp"], "max_files": 500 }`  
    - 逻辑：API 层校验 `folder_path` 必须在配置的白名单目录（`IMPORT_FOLDER_ALLOWED_BASE_PATHS`）下 → 用 `FolderSource.fetch_folder(...)` 遍历目录得到 `List[ContentSourceResult]` → 对每个文件调用 `process_file_upload`，返回与搜索导入一致的 `total/success_count/failed_count/results`。  
    - 安全：未配置白名单或路径不在白名单内时返回 400；不配置则禁用文件夹导入。

- 若后续有多种自动来源，可二选一：  
  - 每种一个端点：`/api/import/url`、`/api/import/rss`、…  
  - 或统一：`POST /api/import`，Body 中带 `source_type: "url" | "rss" | ...` 和对应参数，由一层薄薄的 dispatcher 选对应 source 实现。

推荐先实现 `POST /api/import/url`，再按需抽象成通用 `POST /api/import` + `source_type`。

---

## 5. 与前端/任务的可复用性

- **进度**：导入与上传共用同一 `process_file_upload`，故可复用现有 `processing_id` 与进度查询接口（若有），前端同一套「上传中/处理中」状态与轮询逻辑可复用于「从 URL 导入」。
- **结果**：返回结构（file_id、status、chunks/vectors 等）与上传一致，列表、预览、删除等已有逻辑无需区分来源。
- **后续自动化**：若要做「定时从某 URL/RSS 拉取并导入」，只需在 worker/定时任务里调用同一套「source 取内容 → process_file_upload」，不新增管道，仅新增调度与参数。

---

## 6. 依赖与安全注意点

- **URL 下载**：使用 `httpx` 或 `aiohttp` 做异步请求，限制重定向次数、超时、最大 body 大小，避免 SSRF 与过大文件；可配置允许的 scheme（如仅 `https`）和域名白名单（可选）。
- **依赖**：若项目尚无，在 `requirements.txt` 增加 `httpx`（或现有 HTTP 客户端）即可，不必为「导入」引入一整套新框架。
- **权限**：若将来有用户体系，`/api/import/*` 与 `/api/upload/*` 应使用同一套「知识库写权限」校验，避免绕过。

---

## 7. 多渠道媒体下载器集成（已实现）

- **来源**：从 `temp/MultiMediaDownloader.py` 提取下载与搜索逻辑，去掉 PyQt/信号，放入 `ingestion/sources/media_downloader.py`。
- **能力**：
  - **单 URL 导入**：`POST /api/import/url`，Body `{ "url", "kb_id", "filename?" }`，使用 `UrlSource` 拉取后走 `process_file_upload`。
  - **按关键词搜索图片导入**：`POST /api/import/search`，Body `{ "kb_id", "query", "source", "quantity", ... }`，`source` 可选：`google_images`（SerpAPI）、`pixabay`、`internet_archive`；搜索+下载在后台线程执行，每个文件依次调用 `process_file_upload`。
- **依赖**：`google-search-results`（SerpAPI）、`internetarchive` 已加入 `requirements.txt`；视频/音频可后续加 `yt_dlp` 等。
- **环境变量**（可选，仅搜索导入需要）：
  - `SERPAPI_KEY`：SerpAPI 密钥，用于 Google 图片搜索。
  - `PIXABAY_API_KEY`：Pixabay API 密钥，用于 Pixabay 图片搜索。
  - Internet Archive 无需密钥。

---

## 8. 扩展 1：指定本地文件夹导入（已实现）

- **来源**：`ingestion/sources/folder.py` 的 `FolderSource`，遍历本地目录产出 `List[ContentSourceResult]`。
- **API**：`POST /api/import/folder`，参数见上文；路径须在服务端配置的 `IMPORT_FOLDER_ALLOWED_BASE_PATHS`（逗号分隔的绝对路径）白名单内，未配置则不允许文件夹导入。
- **环境变量**：`IMPORT_FOLDER_ALLOWED_BASE_PATHS`：允许的根路径，逗号分隔（如 `/data/kb_import,/var/docs`），不配置则禁用。

---

## 9. 小结

- **管道统一**：所有写入知识库的路径都收敛到 `IngestionService.process_file_upload(bytes, path, kb_id, user_id)`。
- **扩展点**：在 `ingestion/sources/` 下按「来源类型」实现不同 fetcher，产出 `(bytes, filename)` 后交给现有管道。
- **API**：保留 `/api/upload/*`，新增 `/api/import/url`、`/api/import/search`、`/api/import/folder`（及后续 `/api/import` + source_type），接口返回与上传一致，便于前端与任务复用。
- 这样可以在不破坏现有模块化与单一职责的前提下，平滑加入「自动下载网络资源导入知识库」及「指定本地文件夹导入」。多渠道媒体下载器已按上述方式接入，支持单 URL 与按关键词搜索图片导入；扩展 1 支持从白名单目录批量导入本地文件。
