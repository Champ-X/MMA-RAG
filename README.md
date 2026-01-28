# Multi-Modal 智能路由可扩展知识库RAG Agent

一个基于多模态智能路由的知识库RAG系统，支持文档和图像处理，具备可视化思考过程和深度调试功能。

## 🚀 项目特色

### 核心功能
- **多模态数据处理**: 支持PDF、文档、图片等多种格式的智能解析和向量化
- **智能路由系统**: 基于知识库画像的动态路由，支持实时路由决策
- **混合检索策略**: Dense + Sparse + Visual 三路融合检索，提升检索准确性
- **可视化思考过程**: 实时展示AI的意图识别、知识库路由、检索策略等思考步骤
- **深度RAG调试**: 提供完整的检索链路调试信息，支持结果溯源

### 技术架构
- **后端**: FastAPI + Python，模块化DDD架构
- **前端**: React + TypeScript + Vite，现代组件化设计
- **存储**: MinIO (文件) + Qdrant (向量) + Redis (缓存)
- **模型**: SiliconFlow API，支持多模型接入
- **部署**: Docker容器化，支持一键部署

## 📁 项目结构

```
multi-modal-rag-agent/
├── backend/                  # 后端主目录 (Python/FastAPI)
│   ├── app/                  # 应用代码核心
│   │   ├── api/              # [接口层] 路由定义
│   │   ├── core/             # [基础设施层] 核心配置与通用组件
│   │   ├── modules/          # [业务层] 五大核心模块实现
│   │   └── workers/          # [异步任务] Celery任务定义
│   ├── requirements.txt       # Python依赖
│   └── Dockerfile            # 后端容器配置
├── frontend/                 # 前端主目录 (React/TypeScript)
│   ├── src/
│   │   ├── components/       # React组件
│   │   ├── services/         # API服务
│   │   ├── store/           # 状态管理
│   │   └── hooks/          # 自定义Hooks
│   ├── package.json          # 前端依赖
│   └── vite.config.ts        # Vite配置
├── docker-compose.yml        # 容器编排
├── start-dev.sh            # 开发环境启动脚本
└── README.md               # 项目说明文档
```

## 🏗️ 核心模块

### 1. 数据输入处理与存储 (Ingestion Module)
- **文件解析器工厂**: 支持PDF、图像、文本的差异化解析
- **多模态向量化**: VLM + CLIP双路融合策略
- **智能存储**: MinIO持久化 + Qdrant向量存储

### 2. 知识库管理与画像 (Knowledge Module)
- **动态画像生成**: K-Means聚类算法分析知识内容
- **智能路由**: 基于画像分数的加权投票路由机制
- **实时画像更新**: 支持知识库内容的动态更新和画像重构

### 3. 语义路由与检索 (Retrieval Module)
- **One-Pass意图识别**: JSON结构化IntentObject输出
- **查询改写**: SPLADE稀疏检索 + Multi-view重构
- **混合检索**: Dense + Sparse + Visual三路融合
- **两阶段重排**: RRF粗排 + Cross-Encoder精排

### 4. LLM上下文构建 (Generation Module)
- **模态差异化模板**: 文档/图片Type A/B插槽设计
- **动态引用映射**: UUID到数字ID的智能转换
- **流式响应**: SSE实时通信，支持打字机效果

### 5. 模块化LLM管理器 (LLM Manager)
- **统一协议接口**: 支持SiliconFlow、OpenAI等多厂商
- **智能路由**: 基于任务类型和负载的模型选择
- **熔断与重试**: 完善的错误处理和降级策略
- **审计监控**: Token使用、响应时间等指标统计

## 🛠️ 快速开始

### 环境要求
- Docker & Docker Compose
- Node.js 18+ & npm
- Python 3.9+

### 1. 克隆项目
```bash
git clone <repository-url>
cd multi-modal-rag-agent
```

### 2. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，设置必要的API密钥
```

### 3. 启动开发环境
```bash
# 给启动脚本执行权限
chmod +x start-dev.sh

# 启动所有服务
./start-dev.sh
```

### 4. 访问应用
- **前端界面**: http://localhost:5173
- **后端API**: http://localhost:8000
- **API文档**: http://localhost:8000/docs
- **MinIO控制台**: http://localhost:9001 (admin/admin123)

## 🐳 Docker部署

### 生产环境部署
```bash
# 构建并启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 服务组件
- **app**: 主应用服务 (FastAPI)
- **minio**: 对象存储服务
- **qdrant**: 向量数据库
- **redis**: 缓存服务
- **nginx**: 反向代理 (生产环境)

## 🔧 配置说明

### 后端配置
主要配置文件：`backend/app/core/config.py`
- **数据库连接**: Qdrant、Redis、MinIO连接配置
- **模型配置**: LLM模型参数和路由策略
- **日志配置**: 审计日志和监控设置

### 前端配置
主要配置文件：`frontend/src/services/api_client.ts`
- **API基础URL**: 后端API地址配置
- **SSE配置**: 流式通信参数
- **主题配置**: UI主题和语言设置

### 环境变量
```bash
# API密钥
SILICONFLOW_API_KEY=your_siliconflow_api_key

# 数据库配置
QDRANT_HOST=localhost
QDRANT_PORT=6333
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO配置
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=admin123

# 应用配置
DEBUG=True
LOG_LEVEL=INFO
```

## 📊 系统监控

### 关键指标
- **Token使用量**: 各模型的Token消耗统计
- **响应时间**: API端点性能监控
- **检索质量**: 命中率、召回率等指标
- **系统资源**: CPU、内存、磁盘使用率

### 日志管理
- **应用日志**: 结构化日志输出
- **审计日志**: 操作记录和追踪
- **错误日志**: 异常信息收集
- **性能日志**: 关键路径耗时分析

## 🧪 测试

### 单元测试
```bash
cd backend
pytest tests/ -v
```

### 端到端测试
```bash
cd frontend
npm run test:e2e
```

### 性能测试
```bash
# 检索性能测试
python scripts/test_retrieval_performance.py

# 负载测试
python scripts/load_test.py
```

## 🔒 安全考虑

### 数据安全
- **敏感信息加密**: API密钥等敏感数据加密存储
- **访问控制**: 基于角色的权限管理
- **数据隔离**: 不同租户的数据完全隔离

### API安全
- **请求限流**: 防止API滥用
- **输入验证**: 严格的参数验证
- **CORS配置**: 跨域请求安全控制

## 🤝 贡献指南

### 开发流程
1. Fork项目到你的GitHub账户
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

### 代码规范
- **Python**: 遵循PEP 8规范，使用Black格式化
- **TypeScript**: 遵循ESLint规则，使用Prettier格式化
- **文档**: 重要功能需要添加文档和示例

## 📋 待办事项

### 短期目标
- [ ] 添加更多文件格式支持 (Excel、PPT等)
- [ ] 实现增量知识库更新
- [ ] 添加用户权限管理系统
- [ ] 优化移动端体验

### 长期目标
- [ ] 支持多语言对话
- [ ] 实现知识图谱可视化
- [ ] 添加语音输入/输出
- [ ] 集成更多AI模型提供商

## 📄 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 📞 联系我们

- **项目维护者**: MiniMax Agent
- **问题反馈**: [GitHub Issues](https://github.com/your-org/multi-modal-rag-agent/issues)
- **技术讨论**: [GitHub Discussions](https://github.com/your-org/multi-modal-rag-agent/discussions)

---

**⚡ 快速体验**: 
1. 启动开发环境: `./start-dev.sh`
2. 打开 http://localhost:5173
3. 上传你的第一个文档开始体验！

**🎯 核心价值**: 
让AI的思考过程透明化，让知识检索更智能，让多模态处理更简单！