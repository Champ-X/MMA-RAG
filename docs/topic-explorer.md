# 主题星图：点簇群落设计与维护契约

本文记录知识库详情内当前点簇实现，替代旧矩形分区说明；旧版视觉结论不作为本版验收证据。范围仅限局部组件，不扩展根 `DESIGN.md`、`PRODUCT.md` 或 `.impeccable/design.json` 的 `/architecture` 设计范围。

## 实现与数据边界

- [TopicAtlas.tsx](../frontend/src/components/knowledge/TopicAtlas.tsx) 负责主题群落、目录、搜索与常驻阅读；[topicAtlas.css](../frontend/src/components/knowledge/topicAtlas.css) 是局部视觉值的来源。
- [topicConstellationLayout.ts](../frontend/src/components/knowledge/topicConstellationLayout.ts) 根据主题 ID 和样本量生成确定性布局。原 [portraitAtlasLayout.ts](../frontend/src/components/knowledge/portraitAtlasLayout.ts) 的圆形算法仍保留，当前组件不调用它。
- `cluster_size` 来自聚类样本数量，不表示文件数或知识库覆盖率。显示前将负值、非有限值归零，小数向下取整，最大值限制为 `Number.MAX_SAFE_INTEGER`；百分比分母为全部返回主题的规范化样本总量，搜索不改变分母。
- 头部 [PortraitStatistics.tsx](../frontend/src/components/knowledge/PortraitStatistics.tsx) 使用 `buildPortraitSourceStats` 汇总文本块、图片、音频、视频片段四类已解析样本，分母与星图的已归类样本总量独立；视频数量为 Shot，不是文件数。文档数仅在正值时作小字附注，不进入总量，也不重复展示主题数。四类始终可见，零值淡化；全零显示 `0` 和“等待内容解析”，不生成虚构份额。
- 每主题最多显示 80 个点符号。80 以内每点权重为 1；更大主题分配正整数 `weight`，权重总和保持该主题规范化样本量。零样本主题保留文字，不生成点或包络。
- 点簇表达真实样本数量及主题归属；位置由排布与种子随机算法生成，**不是 embedding 投影、语义距离或点级身份**。包络面积与点半径不承诺严格数量比例；点不能链接到虚构的文件或来源。目录、阅读区和移动端缩略图复用主图同一布局节点的点与包络，保持形态对应。
- 标题优先取首个关键词，无关键词时从摘要切分；完整摘要在阅读区保留。[KnowledgeList.tsx](../frontend/src/components/knowledge/KnowledgeList.tsx) 当前传入 `onClusterSelect={() => {}}`，不承诺选择主题会过滤素材列表。

## 交互契约

| 操作 / 状态 | 行为 |
| --- | --- |
| 初次进入 | 按样本量降序、同量按 ID 排序；预览最大主题，不设置选择或触发回调。 |
| 点击主题 | 选择并阅读；重复点击不取消，幂等保护位于 `selectTopic`。选择不改变画布坐标。 |
| 聚类视图 / 主题目录 | 手动切换，共享搜索与选择。目录按样本量展示同形点簇缩略图、主题、关键词、真实摘要节选、样本数和占比。 |
| 目录当前阅读 | `data-reading` 与 `aria-current` 标记当前预览或选中主题，`aria-pressed` 仅表示显式选择；默认预览已有阅读标记，仍不触发选择回调。 |
| 搜索 | 匹配标题、关键词和完整摘要，忽略大小写及首尾空白；输入变化清除显式选择，预览首个匹配项。 |
| 桌面画布搜索 | 同尺寸下仍以全部主题计算布局，非匹配主题原位淡化并 `disabled`；不能通过点击或方向键选中。无匹配时显示清空入口并移除旧摘要。 |
| 点击阅读区关键词 | 将该词写入搜索、清除显式选择、聚焦搜索框；沿关键词查找相关主题。桌面关键词位于摘要滚动区之外，阅读长摘要时仍可直接使用。 |
| 上一个 / 下一个 | 按当前匹配顺序选择主题，首尾禁用，不循环。 |
| 移动端返回主题 | 将当前阅读主题滚入可见位置并聚焦；保留选择与搜索，不调用清除回调。 |
| 清除选择 / Escape | 清除选择后预览首项，焦点返回原主题；Escape 优先清查询并聚焦搜索框，再次按下才清选择。清查询本身不清选择。 |

画布坐标稳定限于主题数据与容器宽度不变时；宽度变化或画像数据更新可重新布局。搜索仍使用完整主题集合决定画布高度，不因匹配数量减少而收缩。窄屏点簇流与手动目录只显示匹配项，不承诺筛选前后的行位置不变。

## 视觉与响应式

主要层次是浅底点簇画布、松散二维群落、宋体主题名和常驻摘要。包络默认轻淡，阅读、悬停、选择与焦点各有轮廓状态；画布选择同时显示勾选。目录去除序号，当前阅读使用书本图标及主题淡底，普通悬停底色更轻；摘要节选为单行，完整内容在阅读区。

| 局部 token | 浅色 / 深色 | 用途 |
| --- | --- | --- |
| `--atlas-bg` / `--atlas-panel` | `#f5f7f3` / `#fff`；深色 `#1e2e29` / `#182523` | 画布与外层面板 |
| `--atlas-ink` / `--atlas-muted` | `#293b3e` / `#647277`；深色 `#e4ede8` / `#a6b8b4` | 主要文字与摘要 |
| `--atlas-border` / `--atlas-accent` | `#e3e8e5` / `#46766d`；深色 `#34443f` / `#a2cabe` | 分隔、焦点与操作 |

六组主题色由 ID 顺序分配并循环：teal、blue、violet、amber、rose、sage。`--topic-color` 用于点与包络，`--topic-ink` 用于主题文字，`--topic-tint` 用于关键词和选中背景；完整浅深色值保留在 CSS，不另建全局色表。

- 字体：`--atlas-display: 'Songti SC', 'STSong', Georgia, serif` 用于主题标题，正文继承应用字体。组件标题 25px / 700，群落和目录标题 21px / 700，阅读标题 32px / 700；摘要 13px、行高 1.95；数字使用 `tabular-nums`。阅读区缩略图为 66×64px，桌面目录缩略图为 54×50px。
- 间距与形状：外卡片横向内边距 28px、圆角 16px，标题区内边距 `19px 28px 14px`，工具栏下间距 12px，模式切换以 2px 下划线标识当前项；画布圆角 13px、双栏间距 27px、关键词间距 6px，卡片无阴影。普通焦点描边 2px，画布聚焦通过包络 2.5px 描边表达。
- 统计条与标题、重新生成按钮同处卡片头部，使用静态数值和一条 3px 占比色带；统计项没有按钮或选择行为。样式来源为 [portraitStatistics.css](../frontend/src/components/knowledge/portraitStatistics.css)：卡片容器不超过 1000px 时统计条移到标题下方，不超过 500px 时四类改为两列，不超过 260px 时总量与分类上下排列。
- 容器至少 900px 时并排显示，阅读列为 `clamp(285px, 30%, 420px)`。`getTopicConstellationHeight` 按全部主题数量和画布宽度计算高度，组件通过 `--atlas-canvas-height` 同时传给画布与阅读面板；阅读面板高为 `max(480px, 画布高度 + 95px)`。画布宽度不超过 960px 时五主题为 440px、六至八主题为 480px；不超过五主题的宽画布最多减高 20px，总高度范围为 260–560px。
- 布局以原 18° 散落群落为起点，保留左右、上下关系，按可见内容与点击边界收拢中心；局部点云形态、成员和权重不因收拢改变。`contentBounds` 包含点云及标题/计数行的估算边界，标签 CSS 上限为 `min(180px, calc(100% - 10px))`，与文字估宽上限一致，长标题在内部文本节点省略截断。`hitBounds` 每边外扩 5px，桌面收拢方案以点击区至少间隔 8px 为约束。`ResizeObserver` 只追踪宽度，避免画布与自然高度点簇流切换产生高度反馈。
- 桌面摘要独立滚动，预留滚动条空间并限制滚动传递；关键词区常驻摘要区下方，关键词列表最高 112px、单独滚动，清除选择操作位于最下方。容器小于 900px 时面板、摘要与关键词全部自然展开，点击主题滚入阅读区，“返回主题”保留返回路径。
- 画布宽小于 600px，或任一群落半径 `rx < 54` / `ry < 52` 时，聚类视图改为点簇流：每项仍含点簇小图、主题及样本量。它不自动切成普通目录；容器不超过 480px 时点簇流为单列，搜索与模式切换各占一行。

## 可访问性与验证

桌面群落使用单一 Tab 入口，方向键在可用主题间移动焦点，Enter / Space 激活；点簇流与目录逐项 Tab，并以 `aria-current` 表示当前阅读。摘要区域可聚焦并有可见焦点，桌面长摘要可键盘滚动。按钮提供 `aria-pressed`、`aria-controls`，结果数量和阅读序号播报状态。统计条使用 `dl` 呈现类别、数量与屏幕阅读器可读的占比；色带设为 `aria-hidden`，避免重复播报。

深色使用独立色值；`forced-colors` 使用 `Canvas`、`ButtonText` 和 `Highlight` 保留点、包络与选择轮廓；`prefers-reduced-motion` 关闭局部动画、过渡和平滑滚动。

在 `frontend` 目录执行：

```sh
npx tsx --test tests/topicConstellationLayout.test.ts tests/portraitAtlasNavigation.test.ts tests/portraitAtlasLayout.test.ts tests/portraitSourceStats.test.ts
npm run test:dom
npm run type-check
```

[布局测试](../frontend/tests/topicConstellationLayout.test.ts) 验证权重总和、最多 80 点、零值不造点、确定性、几何边界与标签避让，以及自适应高度、散落中心关系、可读尺寸和收拢后的点击区分离；[方向导航测试](../frontend/tests/portraitAtlasNavigation.test.ts) 验证方向、边界与无效矩形。原圆形算法测试只验证保留代码。

[DOM 测试](../frontend/tests/topicAtlas.dom.tsx) 覆盖默认预览、重复点击、搜索原位禁用、关键词搜索、返回保留选择与焦点恢复，以及目录当前阅读与显式选择的区分、摘要节选来源；后续调整继续维护这些契约。DOM 测试不证明真实 CSS 布局或视觉质量。

[统计条 DOM 测试](../frontend/tests/portraitStatistics.dom.tsx) 验证已解析总量与文档数分离、视频片段计数、零值类别可见且无伪交互、全零等待状态，以及规范化计数和极小非零占比；[来源统计单元测试](../frontend/tests/portraitSourceStats.test.ts) 验证汇总与百分比计算。

浏览器检查少量/较多主题的桌面和宽屏、320/390px 移动视口、深色、中英文、无结果、超 80 样本、零样本、键盘和系统显示偏好；五主题桌面须保持散落点簇，核对文字不重叠、摘要滚动时关键词保持可用、头部统计四类始终可读，以及“主题—阅读—关键词—返回”的完整路径。本轮截图与检查记录统一放在 `.impeccable/review/topic-header-stats/`，它们是本地检查材料，不等同于生产上线记录。
