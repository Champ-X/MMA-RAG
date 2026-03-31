# Multi-Modal RAG Agent 部署指南

本文档详细介绍了Multi-Modal RAG Agent的部署方案，包括开发环境、生产环境和云端部署。

## 📋 部署架构概览

### 系统组件
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │   Web Server    │    │   App Server    │
│     (Nginx)     │    │   (Frontend)    │    │   (Backend)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │    │  Object Store   │    │ Vector Database │
│   (FastAPI)     │    │    (MinIO)      │    │   (Qdrant)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cache Layer   │    │  Task Queue     │    │   Monitoring    │
│    (Redis)      │    │   (Celery)      │    │  (Prometheus)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 部署模式选择

| 模式 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| **本地开发** | 开发调试 | 快速启动、便于调试 | 仅限单机、资源有限 |
| **Docker单机** | 小型部署 | 部署简单、资源隔离 | 扩展性有限 |
| **Docker集群** | 中型部署 | 高可用、易扩展 | 配置复杂 |
| **云原生** | 大型部署 | 自动扩缩容、高可用 | 成本较高、技术要求高 |

## 🛠️ 本地开发环境部署

### 前置条件
- Docker 20.10+
- Docker Compose 2.0+
- Node.js 18+
- Python 3.9+
- Git
- LibreOffice（可选：`pptx/docx` 页内预览会用到 Office -> PDF 转换）
- FFmpeg（可选：视频切段与音频提取流程依赖）

### 快速启动

1. **克隆项目**
```bash
git clone https://github.com/your-org/multi-modal-rag-agent.git
cd multi-modal-rag-agent
```

2. **配置环境变量**
```bash
# 复制环境变量模板（仅使用 backend/.env，不使用项目根目录 .env）
cp backend/.env.example backend/.env

# 编辑配置文件
vim backend/.env
```

关键配置项：
```bash
# 必需配置
SILICONFLOW_API_KEY=your_api_key_here
API_DEBUG=false
LOG_LEVEL=INFO

# 数据库与缓存
QDRANT_HOST=localhost
QDRANT_PORT=6333
REDIS_URL=redis://localhost:6379/0
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# 安全配置
SECRET_KEY=your_secret_key_here

# 可选：二进制依赖路径（若命令不在 PATH，可显式配置）
LIBREOFFICE_PATH=/usr/bin/libreoffice
FFMPEG_PATH=/usr/bin/ffmpeg
```

3. **启动服务**
```bash
# 使用启动脚本（推荐）
chmod +x start-dev.sh
./start-dev.sh

# 或手动启动依赖与后端（Compose 需指定 env 文件）
docker compose --env-file backend/.env up -d
```

4. **验证部署**
```bash
# 检查服务状态
curl http://localhost:8000/health
curl http://localhost:3000

# 查看API文档
open http://localhost:8000/docs
```

### 开发工作流

1. **后端开发**
```bash
cd backend
source venv/bin/activate  # 激活虚拟环境
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

2. **前端开发**
```bash
cd frontend
npm install
npm run dev
```

3. **数据库管理**
```bash
# MinIO控制台
open http://localhost:9001

# Qdrant控制台
open http://localhost:6333/dashboard

# Redis监控
redis-cli monitor
```

## 🐳 Docker部署

### 单机部署

1. **构建镜像**
```bash
# 构建后端镜像
docker build -t multimodal-rag-backend ./backend

# 构建前端镜像
docker build -t multimodal-rag-frontend ./frontend
```

2. **启动服务**
```bash
# 后台运行（从 backend/.env 注入 Compose 变量）
docker compose --env-file backend/.env up -d

# 查看日志
docker compose --env-file backend/.env logs -f backend

# 查看状态
docker compose --env-file backend/.env ps
```

3. **服务访问**
- 应用首页: http://localhost
- API文档: http://localhost/api/docs
- MinIO控制台: http://localhost:9001
- Qdrant控制台: http://localhost:6333

### 生产环境优化

1. **docker-compose.prod.yml**
```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
      - frontend

  app:
    build: ./backend
    environment:
      - DEBUG=False
      - LOG_LEVEL=INFO
    volumes:
      - ./logs:/app/logs
      - ./uploads:/app/uploads
    depends_on:
      - qdrant
      - redis
      - minio

  frontend:
    build: ./frontend
    environment:
      - VITE_API_BASE_URL=http://localhost/api

  qdrant:
    image: qdrant/qdrant:latest
    volumes:
      - qdrant_data:/qdrant/storage
    ports:
      - "6333:6333"

  redis:
    image: redis:alpine
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

  minio:
    image: minio/minio:latest
    environment:
      - MINIO_ROOT_USER=admin
      - MINIO_ROOT_PASSWORD=admin123
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    command: server /data --console-address ":9001"

volumes:
  qdrant_data:
  redis_data:
  minio_data:
```

2. **Nginx配置**
```nginx
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server app:8000;
    }

    upstream frontend {
        server frontend:3000;
    }

    server {
        listen 80;
        server_name localhost;

        # 前端静态文件
        location / {
            proxy_pass http://frontend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # API代理
        location /api/ {
            proxy_pass http://backend/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # WebSocket支持（SSE）
        location /api/chat/stream {
            proxy_pass http://backend/chat/stream;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
        }
    }
}
```

## ☁️ 云端部署

### AWS部署

1. **EC2实例配置**
```bash
# 实例规格建议
实例类型: t3.large (2 vCPU, 8GB RAM)
存储: 50GB gp3
安全组: 开放80,443,22端口
```

2. **Docker安装**
```bash
# 安装Docker
sudo yum update -y
sudo yum install -y docker
sudo service docker start
sudo usermod -a -G docker ec2-user

# 安装Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

3. **部署脚本**
```bash
#!/bin/bash
# deploy-aws.sh

# 设置环境变量
export ENVIRONMENT=production
export AWS_REGION=us-west-2

# 拉取最新代码
git pull origin main

# 构建并启动服务
docker-compose -f docker-compose.prod.yml up -d --build

# 健康检查
sleep 30
curl -f http://localhost/health || exit 1

echo "部署完成！"
```

### 阿里云部署

1. **ECS配置**
```bash
# 规格建议
实例规格: ecs.t5-lc1m2.large
操作系统: Ubuntu 20.04
网络: 专有网络VPC
安全组: 开放80,443,22端口
```

2. **容器服务ACK**
```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: multimodal-rag-agent
spec:
  replicas: 3
  selector:
    matchLabels:
      app: multimodal-rag-agent
  template:
    metadata:
      labels:
        app: multimodal-rag-agent
    spec:
      containers:
      - name: app
        image: your-registry/multimodal-rag-agent:latest
        ports:
        - containerPort: 8000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: database-url
---
apiVersion: v1
kind: Service
metadata:
  name: multimodal-rag-agent-service
spec:
  selector:
    app: multimodal-rag-agent
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8000
  type: LoadBalancer
```

### Kubernetes部署

1. **创建命名空间**
```bash
kubectl create namespace multimodal-rag
kubectl config set-context --current --namespace=multimodal-rag
```

2. **部署配置**
```bash
# 应用所有配置
kubectl apply -f k8s/

# 查看部署状态
kubectl get pods -w
kubectl get services
kubectl get ingress
```

3. **监控配置**
```yaml
# monitoring.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: multimodal-rag-monitor
spec:
  selector:
    matchLabels:
      app: multimodal-rag-agent
  endpoints:
  - port: metrics
```

## 🔧 监控与运维

### 日志管理

1. **集中式日志收集**
```yaml
# 使用ELK Stack
version: '3.8'
services:
  elasticsearch:
    image: elasticsearch:7.14.0
    environment:
      - discovery.type=single-node
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data

  logstash:
    image: logstash:7.14.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    depends_on:
      - elasticsearch

  kibana:
    image: kibana:7.14.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch
```

2. **日志分析**
```bash
# 查看应用日志
docker-compose logs -f app

# 查看访问日志
tail -f /var/log/nginx/access.log

# 查看错误日志
tail -f /var/log/nginx/error.log
```

### 性能监控

1. **Prometheus + Grafana**
```yaml
# monitoring/docker-compose.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

2. **关键指标监控**
- API响应时间
- 内存和CPU使用率
- 数据库连接数
- 队列长度
- 错误率

### 备份策略

1. **数据备份**
```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/$DATE"

# 备份数据库
docker exec qdrant_container qdrantctl backup create $BACKUP_DIR/qdrant

# 备份文件存储
docker exec minio_container mc mirror minio/data $BACKUP_DIR/minio

# 备份Redis
docker exec redis_container redis-cli BGSAVE
cp /var/lib/redis/dump.rdb $BACKUP_DIR/redis/

echo "备份完成: $BACKUP_DIR"
```

2. **自动备份脚本**
```bash
# 添加到crontab
0 2 * * * /path/to/backup.sh
```

## 🚨 故障排除

### 常见问题

1. **服务启动失败**
```bash
# 检查服务状态
docker-compose ps

# 查看服务日志
docker-compose logs service_name

# 检查端口占用
netstat -tlnp | grep :8000

# 检查磁盘空间
df -h
```

2. **数据库连接失败**
```bash
# 测试数据库连接
docker exec qdrant_container qdrantctl health
docker exec redis_container redis-cli ping

# 检查网络连通性
docker network ls
docker network inspect network_name
```

3. **API响应异常**
```bash
# 检查API日志
docker-compose logs app | grep ERROR

# 测试API端点
curl -v http://localhost:8000/health

# 检查配置
docker exec app_container env | grep DATABASE
```

### 性能优化

1. **数据库优化**
```bash
# Qdrant配置优化
echo "
optimizers:
  default:
    max_optimization_threads: 4
    memmap_threshold_kb: 65536
" >> qdrant/config.yaml
```

2. **缓存优化**
```bash
# Redis配置优化
echo "
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
" >> redis.conf
```

## 📚 扩展阅读

- [Docker官方文档](https://docs.docker.com/)
- [Kubernetes部署指南](https://kubernetes.io/docs/setup/)
- [Prometheus监控](https://prometheus.io/docs/)
- [Nginx配置手册](https://nginx.org/en/docs/)

---

**💡 部署建议**:
- 生产环境务必启用HTTPS
- 定期备份重要数据
- 监控系统资源使用情况
- 及时更新安全补丁
- 建立完善的日志审计机制