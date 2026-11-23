# 知识库的主题星图

知识库详情按主题展示聚类样本。点簇和目录使用同一组数据，可以按关键词查找主题，或打开摘要查看它包含哪些内容。

## 实现与数据边界

- [TopicAtlas.tsx](../frontend/src/components/knowledge/TopicAtlas.tsx) 负责主题群落、目录、搜索与常驻阅读；[topicAtlas.css](../frontend/src/components/knowledge/topicAtlas.css) 是局部视觉值的来源。
- 星图按主题 ID 和样本量生成确定性布局。[布局实现](../frontend/src/components/knowledge/topicConstellationLayout.ts)
- `cluster_size` 来自聚类样本数量，不表示文件数或知识库覆盖率。显示前将负值、非有限值归零，小数向下取整，最大值限制为 `Number.MAX_SAFE_INTEGER`；百分比分母为全部返回主题的规范化样本总量，搜索不改变分母。
- 头部 [PortraitStatistics.tsx](../frontend/src/components/knowledge/PortraitStatistics.tsx) 使用 `buildPortraitSourceStats` 汇总文本块、图片、音频、视频片段四类已解析样本，分母与星图的已归类样本总量独立；视频数量为 Shot，不是文件数。文档数仅在正值时作小字附注，不进入总量，也不重复展示主题数。四类始终可见，零值淡化；全零显示 `0` 和“等待内容解析”，不生成虚构份额。
- 每主题最多显示 80 个点符号。80 以内每点权重为 1；更大主题分配正整数 `weight`，权重总和保持该主题规范化样本量。零样本主题保留文字，不生成点或包络。
- 点簇表达真实样本数量及主题归属；位置由排布与种子随机算法生成，**不是 embedding 投影、语义距离或点级身份**。包络面积与点半径不承诺严格数量比例；点不能链接到虚构的文件或来源。目录与阅读区缩略图复用主图同一布局节点的点与包络，保持形态对应。
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

画布坐标稳定限于主题数据与容器宽度不变时；宽度变化或画像数据更新可重新布局。搜索仍使用完整主题集合决定画布高度，不因匹配数量减少而收缩。手动目录只显示匹配项，不承诺筛选前后的行位置不变。窄屏仍使用有界二维画布，不自动切换为点簇列表。

## 桌面与窄屏布局

桌面并排展示星图与阅读面板，摘要独立滚动，关键词常驻下方。容器宽度低于 900 像素时改为垂直排列，点击主题会滚到阅读区，「返回主题」回到原位置。搜索始终以全部主题计算坐标和画布高度，目录只列出匹配项。

每个主题的颜色按 ID 顺序分配。布局按点云、标签和点击区域计算边界，再整体缩放以适应宽度。显示主题较多时可切换到目录逐项阅读。统计条使用独立的容器断点，保留文本块、图片、音频和视频镜头四类计数。[星图样式](../frontend/src/components/knowledge/topicAtlas.css) · [统计条样式](../frontend/src/components/knowledge/portraitStatistics.css)

## 可访问性与验证

群落画布使用单一 Tab 入口，方向键在可用主题间移动焦点，Enter / Space 激活；目录逐项 Tab，并以 `aria-current` 表示当前阅读。摘要区域可聚焦并有可见焦点，桌面长摘要可键盘滚动。按钮提供 `aria-pressed`、`aria-controls`，结果数量和阅读序号播报状态。统计条使用 `dl` 呈现类别、数量与屏幕阅读器可读的占比；色带设为 `aria-hidden`，避免重复播报。

深色使用独立色值；`forced-colors` 使用 `Canvas`、`ButtonText` 和 `Highlight` 保留点、包络与选择轮廓；`prefers-reduced-motion` 关闭局部动画、过渡和平滑滚动。

在 `frontend` 目录执行：

```sh
npx tsx --test tests/topicConstellationLayout.test.ts tests/portraitAtlasNavigation.test.ts tests/portraitSourceStats.test.ts
npm run test:dom
npm run type-check
```

[布局测试](../frontend/tests/topicConstellationLayout.test.ts) 验证权重总和、最多 80 点、零值不造点、确定性、几何边界与标签避让，以及有界高度、散落中心关系、密集/窄屏整体缩放和点击区分离。[方向导航测试](../frontend/tests/portraitAtlasNavigation.test.ts) 验证方向、边界与无效矩形。

[DOM 测试](../frontend/tests/topicAtlas.dom.tsx) 覆盖默认预览、重复点击、搜索原位禁用、关键词搜索、返回保留选择与焦点恢复，以及目录当前阅读与显式选择的区分、摘要节选来源；后续调整继续维护这些契约。DOM 测试不证明真实 CSS 布局或视觉质量。

[统计条 DOM 测试](../frontend/tests/portraitStatistics.dom.tsx) 验证已解析总量与文档数分离、视频片段计数、零值类别可见且无伪交互、全零等待状态，以及规范化计数和极小非零占比；[来源统计单元测试](../frontend/tests/portraitSourceStats.test.ts) 验证汇总与百分比计算。

浏览器检查少量/较多主题的桌面和宽屏、320/390px 移动视口、深色、中英文、无结果、超 80 样本、零样本、键盘和系统显示偏好；五主题桌面须保持散落点簇，核对文字不重叠、摘要滚动时关键词保持可用、头部统计四类始终可读，以及“主题—阅读—关键词—返回”的完整路径。截图与检查记录保存在被忽略的本地评审目录；不将它们作为当前版本的长期验收结论。
