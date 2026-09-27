# Jev 复现实验：前置编码器 + Fly 决策头 能不能平替 Jev

同一批 **10,000 个决策任务**（sst2 2500 / ag_news 2500 / emotion 2500 / banking77 2500），
同一台机器（Apple M5 Pro, 18 核, 64GB），全部 **CPU、batch=1**。

## 结论

**零样本下复现不了。** 最好的一条（ModernBERT-embed + Fly）是 65.6%，Jev 是 78.8%，**差 13.1 个百分点**，且四个任务上全面落后。所以 Jev 不是"通用句向量 + 线性头"——前置那一层它做了额外的事。

**但给 2000 条标注就反超。** ModernBERT-embed + Fly 头做到 82.6%，比 Jev 高 3.8 pp；
连 8M 的静态嵌入都有 78.2%，和 Jev 基本打平（差 -0.6 pp），而它端到端 0.11 ms、82 MB、纯 CPU、零边际成本。

**同尺寸的生成式小模型不是一个量级。** Qwen2.5-0.5B 只有 49.6%，还有 4.0% 的输出解析不出合法选项——这正是 Jev 那套"类型安全"要解决的问题，它确实解决了（0 个非法输出）。

**所以该不该用 Jev，取决于这个决策点有没有历史标注**：有，本地一个静态嵌入 + 8 个权重就打平了；没有，那十几个点就是它的定价依据。

## 主表：零样本（和 Jev / Qwen 信息量对等）

| 链路 | 参数量 | 准确率 | 最差任务 | 端到端 p50 | p95 | 模型 RAM | CPU-秒/千条 |
|---|---|---|---|---|---|---|---|
| Static (potion-8M) + Fly | 8M | **57.8%** | 41.7% | 0.04 ms | 0.07 ms | 82 MB | 0.04 |
| MiniLM-L6 + Fly | 23M | **59.6%** | 41.7% | 2.75 ms | 3.75 ms | 452 MB | 3.78 |
| ModernBERT-base + Fly | 149M | **35.0%** | 17.6% | 15.66 ms | 27.71 ms | 489 MB | 22.05 |
| ModernBERT-embed + Fly | 149M | **65.6%** | 52.9% | 15.70 ms | 28.10 ms | 490 MB | 22.89 |
| Qwen2.5-0.5B 生成 | 494M | **49.6%** | 14.2% | 112 ms | 331 ms | 2382 MB | 231.1 |
| **typesafe/jev** (CF 云端) | 未公开 | **78.8%** | 58.6% | 381 ms | 846 ms | 云端 | 云端 |

> Jev 实测成本：6,764,108 input tokens = **$0.2841** / 10,000 条决策（$0.042/M，output 免费），失败 0 条。

## 对照：给 Fly 头 2000 条带标签样本（few-shot）

Jev 拿不到这些样本，所以这一列**不能用来宣称平替**，只用来看编码器的天花板。

| 链路 | Fly few-shot | 最差任务 | 纯质心对照 | LogReg 参考 | 决策头 p50 |
|---|---|---|---|---|---|
| Static (potion-8M) | **78.2%** | 67.3% | 73.9% | 77.8% | 0.08 ms |
| MiniLM-L6 | **79.5%** | 64.2% | 74.5% | 79.0% | 0.08 ms |
| ModernBERT-base | **62.7%** | 46.7% | 55.8% | 70.5% | 0.08 ms |
| ModernBERT-embed | **82.6%** | 66.2% | 80.5% | 83.2% | 0.08 ms |

## 分任务准确率（难度递增）

| 链路 | sst2 (2类) | ag_news (4类) | emotion (6类) | banking77 (77类) |
|---|---|---|---|---|
| Static (potion-8M) zero | 73.3% | 58.6% | 41.7% | 57.6% |
| MiniLM-L6 zero | 65.1% | 69.4% | 41.7% | 62.0% |
| ModernBERT-base zero | 51.3% | 46.9% | 17.6% | 24.2% |
| ModernBERT-embed zero | 82.4% | 64.4% | 52.9% | 62.7% |
| Static (potion-8M) few | 78.3% | 87.7% | 67.3% | 79.4% |
| MiniLM-L6 few | 79.7% | 88.7% | 64.2% | 85.1% |
| ModernBERT-base few | 59.9% | 85.9% | 46.7% | 58.4% |
| ModernBERT-embed few | 85.8% | 89.5% | 66.2% | 88.8% |
| Qwen2.5-0.5B | 84.4% | 65.6% | 34.1% | 14.2% |
| **typesafe/jev** | 89.8% | 88.3% | 58.6% | 78.4% |

## 概率校准 (ECE，越低越好)

Jev 的卖点之一是"概率是校准过的"。打分头 + 温度标定能做到什么程度：

| 链路 | ECE zero-shot | ECE few-shot |
|---|---|---|
| Static (potion-8M) | 0.031 | 0.027 |
| MiniLM-L6 | 0.044 | 0.023 |
| ModernBERT-base | 0.042 | 0.045 |
| ModernBERT-embed | 0.038 | 0.018 |
| **typesafe/jev** | 0.122 | （拿不到带标签样本） |

## 测量注意事项（这些坑会让数字悄悄变假）

1. **ECE 这一列不是公平对比。** 本地各条的温度是在 1000 条带标签 dev 上标定的，Jev 一条标注都没拿到。公平的说法是：*Jev 零标注下 ECE 0.122；本地方案有 1000 条标注时能做到 0.02–0.04*。

2. **Jev 的 381 ms 几乎全是网络。** banking77 的输入 token 是其他任务的 5 倍（1612 vs ~320），p50 只从 374 ms 涨到 392 ms——token 涨 5 倍延迟涨 5%，说明模型计算时间小到测不出来。所以"本地快几千倍"省掉的是一次跨网往返，不是算力。

3. **RAM 必须一个模型一个进程。** 同进程里顺序加载多个模型，后加载的会复用前一个释放的内存池，RSS 增量甚至是负数。本表的 RAM/CPU/延迟全部由 `encode_isolated.sh` 在独立进程里重测（首轮同进程测出的 ModernBERT 是 29.7 ms，隔离后是 15.7 ms——首轮还撞上了 Jev 的并发请求，被拖慢近一倍）。

4. **Qwen 的解析失败按答错计。** 失败率 4.0%（396 条）。把解析失败静默丢弃是这类评测最常见的作弊方式，会让小模型凭空涨几个点。

5. **权重选型用训练目标，不是验证分数。** fit 前 1500 条建质心 → fit 后 500 条当 ES 目标 → dev 1000 条只标温度 → eval 2500×4 只碰一次。

## (1+λ)-ES 搜出来的权重

- **Static (potion-8M)** few-shot：`{"proto": 3.7233, "desc": 0.4448, "knn1": 3.0027, "knnk": 4.1251, "margin": 2.4977, "prior": 0.4307, "white": 1.5815, "tight": 0.6906}`（ES 耗时 0.1s）
- **MiniLM-L6** few-shot：`{"proto": 3.2395, "desc": 0.862, "knn1": 2.4314, "knnk": 3.2729, "margin": 3.5577, "prior": 1.5464, "white": 1.7355, "tight": -0.5972}`（ES 耗时 0.1s）
- **ModernBERT-base** few-shot：`{"proto": -0.0948, "desc": -0.0269, "knn1": 1.1319, "knnk": 1.8856, "margin": 1.2119, "prior": 0.0713, "white": 0.0627, "tight": 0.8059}`（ES 耗时 0.1s）
- **ModernBERT-embed** few-shot：`{"proto": 3.9147, "desc": 0.8717, "knn1": 2.5684, "knnk": 2.8151, "margin": 0.9435, "prior": 0.3723, "white": -0.9152, "tight": 0.0329}`（ES 耗时 0.1s）

## 复现
```bash
./encode_isolated.sh                  # 编码（一个模型一个进程，RAM 才可比）
.venv/bin/python run.py heads         # 搜权重 + 准确率
.venv/bin/python run.py qwen qwenprobe
.venv/bin/python run.py jev jevlat
.venv/bin/python report.py
```

补 Jev 那一列：给 Cloudflare AI Gateway 充值，或 BYOK 填 TypeSafe 的 key，然后
```bash
.venv/bin/python run.py jev      # 全量 10k，并发 8；JEV_LIMIT=1000 可省钱
.venv/bin/python run.py jevlat   # 干净的顺序延迟
```

真瓦数（powermetrics 要 root，得你自己跑）：
```bash
sudo ./power_probe.sh .venv/bin/python run.py encode
```