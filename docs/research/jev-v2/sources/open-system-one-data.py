"""10,000 个决策任务：4 个公开分类基准各 2,500 条。

为什么是"混合"而不是单一数据集：Jev 宣称的能力是 classification / routing，
但这两个词底下的难度差一个数量级——二分类情感和 77 类意图路由，
对"编码器够不够用"这个问题给出的答案完全不同。只跑一个数据集会得到
一个看起来很确定、实际只在那一档难度上成立的结论。

四档难度：
  sst2       2 类  情感        —— 词汇线索极强，静态词向量就该赢
  ag_news    4 类  新闻主题    —— 主题级，词袋友好
  emotion    6 类  细粒度情感  —— 需要一点语义
  banking77 77 类  意图路由    —— 细粒度、选项之间高度混淆，最接近 Jev 的卖点

切分纪律（抄 select_best.py 的做法）：
  fit  集 —— 给 Fly 头算类质心/kNN 特征，给 (1+λ)-ES 搜权重
  dev  集 —— 只用来做超参/权重选型
  eval 集 —— 2500 条，从头到尾只在最后碰一次
"""
from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass, asdict
from pathlib import Path

CACHE = Path(__file__).parent / "cache"
CACHE.mkdir(exist_ok=True)

N_EVAL = 2500
N_FIT = 2000
N_DEV = 1000
SEED = 20260921


@dataclass
class Task:
    """一条决策任务。刻意和 Jev 的请求体同构：state + 一组候选 + 正确答案。"""
    dataset: str
    text: str            # -> Jev 的 state
    label: int           # 正确选项下标
    n_options: int


def _humanize(name: str) -> str:
    """banking77 的标签是 card_arrival 这种。选项描述对三条链路必须完全一致，
    否则比的就不是编码器而是提示词工程了。"""
    return name.replace("_", " ").replace(".", " ").strip()


SPECS = {
    "sst2":      ("stanfordnlp/sst2", "sentence", ["negative sentiment", "positive sentiment"]),
    "ag_news":   ("fancyzhx/ag_news", "text", None),
    "emotion":   ("dair-ai/emotion", "text", None),
    # PolyAI/banking77 是老式 loading script，新版 datasets 不再支持；
    # mteb 的镜像是 parquet，内容相同且带 label_text。
    "banking77": ("mteb/banking77", "text", None),
}


def build(force: bool = False) -> dict:
    out = CACHE / "tasks.json"
    if out.exists() and not force:
        return json.loads(out.read_text())

    from datasets import load_dataset, concatenate_datasets

    rng = random.Random(SEED)
    bundle = {"splits": {"fit": [], "dev": [], "eval": []}, "options": {}}

    for name, (hf_id, text_col, override) in SPECS.items():
        ds = load_dataset(hf_id)
        # 有标签的都收进来再自己切——sst2 的 test 是无标签的，emotion 的 test 只有 2000 条，
        # 直接用官方 test 会凑不满 2500。自己切，但保证 fit/dev/eval 完全不相交。
        parts = [ds[s] for s in ("train", "test", "validation") if s in ds]
        pool = concatenate_datasets(parts) if len(parts) > 1 else parts[0]
        if override:
            label_names = override
        elif hasattr(pool.features["label"], "names"):
            label_names = pool.features["label"].names
        else:
            # 没有 ClassLabel 的镜像（mteb/banking77）：从 label_text 反推，按 label 下标排好
            m = dict(zip(pool["label"], pool["label_text"]))
            label_names = [m[i] for i in sorted(m)]
        options = [_humanize(x) for x in label_names]
        bundle["options"][name] = options

        idx = list(range(len(pool)))
        rng.shuffle(idx)
        need = N_FIT + N_DEV + N_EVAL
        assert len(idx) >= need, f"{name} 只有 {len(idx)} 条，不够 {need}"
        cuts = {"fit": idx[:N_FIT],
                "dev": idx[N_FIT:N_FIT + N_DEV],
                "eval": idx[N_FIT + N_DEV:need]}
        for split, ids in cuts.items():
            sub = pool.select(ids)
            for row in sub:
                txt = " ".join(str(row[text_col]).split())
                if not txt:
                    continue
                bundle["splits"][split].append(
                    asdict(Task(name, txt, int(row["label"]), len(options)))
                )
        print(f"{name:10s} {len(options):3d} 类  池 {len(pool):6d}  ->  fit/dev/eval")

    for split, rows in bundle["splits"].items():
        rng.shuffle(rows)          # 打散数据集边界，避免按块跑造成缓存/温度偏差
        print(f"  {split:5s} {len(rows)}")
    out.write_text(json.dumps(bundle))
    return bundle


if __name__ == "__main__":
    build(force=bool(os.environ.get("FORCE")))
