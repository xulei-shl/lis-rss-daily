# 聚类洞察与趋势判断 · 实现分析报告

> 项目：Agent Pulse
> 分析范围：聚类（clustering）、AI 洞察生成（insight）、评分与热度标签（scoring）、长期趋势阶段晋级（stage-promotion）、实时趋势告警（monitor-alert）、研究影响力（research-impact）
> 配套原始代码已复制到本项目 `refs/` 下，目录结构与 `src/`、`docs/` 保持一致，便于对照阅读。

## 0. 结论摘要

Agent Pulse 把"聚类洞察与趋势判断"拆成五层职责，刻意把**确定性的规则**放在 `src/domain/`（纯函数、可单测），把**需要语义理解的部分**交给受限 LLM（DeepSeek），且**每一处 LLM 输出都强制 Zod schema 校验 + 占位符检测 + evidence allowlist + inputHash 审计**。这与 `AGENTS.md` 中"LLM 生成的洞察必须可追溯到 evidence""未完成收敛不得用占位洞察发布"的原则一致。

| 能力 | 确定性规则层 | LLM 层 | 关键文件 |
| --- | --- | --- | --- |
| 聚类 | ✅ | — | `src/domain/clustering.ts`、`src/pipeline/cluster.ts` |
| 洞察生成 | 占位符/结构校验 | ✅ | `src/pipeline/ai-enrichment.ts` |
| 评分/热度标签 | ✅ | — | `src/domain/scoring.ts` |
| 长期趋势阶段 | 候选门槛+证据校验 | ✅（默认 hold） | `src/pipeline/stage-promotion.ts` |
| 实时趋势告警 | ✅（硬规则优先） | ✅（阈值门控） | `src/pipeline/monitor-alert.ts` |
| 研究影响力 | ✅ | —（override 需审计） | `src/pipeline/research-impact.ts` |

---

## 1. 聚类：把多源信号收敛为 Event

### 1.1 核心规则 `src/domain/clustering.ts`
- `titleTokens()` / `titleSimilarity()`（`clustering.ts:15`、`:26`）：标题做 NFKC 归一化、停用词过滤后形成 token 集合，用 Jaccard 相似度判断标题相近度。
- `eventFingerprint()`（`clustering.ts:56`）：用正则把标题映射为"模型家族指纹"，例如 `openai:gpt-5`、`deepseek:v3`、`qwen:2.5`、`kimi:k2`，把同一发布的多种写法对齐。
- `eventFacet()`（`clustering.ts:86`）：把事件分类为 `incident / capital / pricing / distribution / benchmark / capability / release / update`，`eventFacetBucket()` 做进一步归并（如 `update→release`、`benchmark→capability`）。
- `belongsToEvent()`（`clustering.ts:35`）：聚类判定主函数。
  - 先按指纹 + 面桶做**强匹配**：同指纹且面桶相同，incident 类 7 天内、其余 21 天内直接归并；
  - 否则**弱匹配**：96 小时内标题相似度 ≥ `0.46`（阈值）才归并；
  - 超 21 天直接拒绝。

### 1.2 编排 `src/pipeline/cluster.ts`
- `clusterSignals()`（`cluster.ts:15`）：拉取未聚类信号，按 `eventabilityScore` 降序排序后逐个匹配 Event；找不到且事件性 < 70 则 `deferSignal`（搁置为"insufficient_eventability"）；找到则 `attachSignal` 并记录相似度，并回溯同簇已搁置信号。
- `eventabilityScore()`（`cluster.ts:141`）：聚类门槛，综合
  - 来源 tier（T1=25，T2=10）、role（primary/policy +20，research +10）；
  - 来源 category（frontier-lab / china-lab / company / open-source / agent-devtool / policy / infra-chip-cloud / research-eval +15）；
  - 标题是否含发布/融资/监管等动作词（+20）；
  - 是否命中模型指纹（+20）；
  - 原始质量分 ≥70 再 +10；
  - **聚合器来源直接 0 分**（呼应 `AGENTS.md`：聚合站只能用于候选发现）。
- `rescoreEvent()`（`cluster.ts:189`）：每次归并后用 `src/domain/scoring.ts` 重算四分数，且 `manual_override=1` 时跳过自动重算。

---

## 2. 洞察：把事实转成可复述、可行动的结论

`src/pipeline/ai-enrichment.ts` 是"洞察"生成层：
- `enrichReviewEvents()`（`ai-enrichment.ts:94`）：只处理通过 readiness 门禁（`evaluateEventReadiness`）的 `review` 事件，调用 DeepSeek（`src/ai/deepseek.ts` 的 `completeJson`）。
- `enrichmentSchema`（`ai-enrichment.ts:18`）强制结构化 JSON 输出：
  - `technicalInsight`（技术含义：能力/成本/工程路线）
  - `industryInsight`（产业影响：竞争结构/分工）
  - `futureOutlook`（下一步要观察的可验证信号）
  - `businessValue`（CEO/投资/业务负责人应取动作）
  - 外加 `factSummary`、`summary`、`company`、`category`、`keywords`、`trackSlugs`、`usedEvidenceUrls`
- `superRefine`（`ai-enrichment.ts:32`）拒绝：占位符（待编辑/TBD）、泛化公司名（industry/unknown）、泛化 category、非 URL 证据。
- 每个 prompt 计算 `createHash("sha256")` 作为 `inputHash`，保证可审计、可复现。

这正对应 `AGENTS.md` 要求的"发生了什么、为什么重要、影响谁、下一步观察、可以采取什么动作"。

---

## 3. 评分与趋势热度标签

`src/domain/scoring.ts` 用纯函数计算四分数：
- `scoreEvent()`（`scoring.ts:16`）：
  - `confidence` = 来源权威（max authority）×0.62 + 独立源（封顶4）×7 + 一手证据（封顶2）×10；
  - `heat` = 独立作者 log 缩放×30 + 推文 log 缩放×20 + 独立源×8 + 平台广度×7 + 地区广度×6 + 新鲜度衰减×0.08；
  - `impact` = 默认 55（可人工/上游注入）；
  - `value` = confidence×0.3 + impact×0.3 + heat×0.25 + freshness×0.15；
  - 并暴露 `factors`（含 `crossRegion`、`platformBreadth`、`regionBreadth`、`velocity` 等）。
- `heatLabel()`（`scoring.ts:61`）：把分数映射为**趋势语义标签**：
  - `跨圈热点`（heat≥70 ∧ conf≥60 ∧ crossRegion）
  - `高关注`（heat≥60 ∧ conf≥55）
  - `升温中`（heat≥40）
  - `观察信号`（其余）
  这是最轻量的"趋势判断"输出，前端直接展示。

---

## 4. 趋势判断 · 长期主线阶段晋级（stage-promotion）

这是项目对"趋势"最严格、最低频的一层，`src/pipeline/stage-promotion.ts`：

### 4.1 候选筛选 `selectStagePromotionCandidate()`（`stage-promotion.ts:190`）
门槛极高：
- 事件需 `confidence≥92 ∧ impact≥98 ∧ value≥85`；
- 发生在 14 天内；
- 挂在 `milestone` 主线的**开放阶段**（end = `9999-12-31`）上；
- 距上一阶段 ≥ 45 天；
- 具备**独立阶段证据**（`hasIndependentStageEvidence`，`:588`）：≥2 证据、≥2 来源 slug、≥2 来源名、≥2 域名、且至少 1 个 tier-1 trusted role；
- 聚合器/heat 来源证据被剔除。

### 4.2 LLM 决策 `evaluateStagePromotion()`（`stage-promotion.ts:243`）
- 系统提示明确"默认答案是 hold"，只有旧阶段失去解释力才 promote；
- 使用 `deepseek-v4-pro` + thinking + `reasoningEffort: high` + `temperature: 0`；
- 输出经 `verdictSchema` 判别为 `hold` 或 `promote`。

### 4.3 强校验 `validatePromoteVerdict()`（`stage-promotion.ts:434`）
- `confidence < 95` 直接抛错拒绝；
- `trackSlug`、`sourceEventSlugs`、`usedEvidenceUrls` 只能从输入 allowlist 选择；
- anchor 事件必须被选中、`stage.start` 必须等于 anchor 发生日 UTC 日期；
- evidence 必须绑定到被选中的事件；禁止占位符。

### 4.4 合并落库 `mergeStagePromotions()`（`stage-promotion.ts:312`）
- 把晋级写入 `data/narratives/stage-promotions.json`（Zod `stagePromotionFileSchema`）；
- 关闭旧阶段（`previous.end = promotion.start 前一天`），追加新阶段，更新 track 的 `now`/`next`；
- 全程校验：id 由 `trackSlug:start:anchorSlug` 派生、label 不可重复、阶段必须单调、间距 ≥45 天。

这实现了 `AGENTS.md` 主线的"阶段、里程碑、转折"，以及"角色已收录 vs 已被有效观测必须分开"。

---

## 5. 趋势判断 · 实时告警（monitor-alert）

`src/pipeline/monitor-alert.ts` 的 `decideMonitorAlert()`（`monitor-alert.ts:88`）是运营侧异常/趋势判断，决策优先级：

1. **硬规则优先** `classifyHardFailure()`（`:254`）：
   - 公开站不可达 → `site_unreachable`；
   - monitor 自身崩溃 → `monitor_crashed`；
   - snapshot 缺失或持续陈旧 > 72h → `snapshot_persistently_stale`；
2. 非 `critical` 状态一律 `suppress`；
3. 同指纹 7 天冷却去重（`activeCooldown`，`:282`）；
4. **LLM 复核** `aiDecisionSchema`（`:36`）：仅当 `decision=alert ∧ confidence≥0.75` 才升级；
5. 模型不可用/校验失败 → `fallback` 保留为 evidence 不通知。

关键设计：低活跃覆盖但高审计健康分，被显式判定为"目录结构问题，非生产故障"（`fallbackReason`，`:328`），避免误报。

---

## 6. 研究影响力（辅助趋势信号）

`src/pipeline/research-impact.ts` 的 `assessResearchImpact()`（`:96`）：
- 把事件 arXiv 论文与 OpenAlex 指标比对；
- 路由：`established-field-impact`（age≥365d ∧ cited≥200）/ `accelerating-field-impact`（age≥120d ∧ cited≥50 ∧ 近90天新增≥80）/ `watch` / `rejected`；
- 判定条件：标题匹配 `titleMatchScore≥0.65`、`topicRelevant`（核心 AI 研究词）、发表日期与事件 ≤180 天；
- 支持审计过的 override（`auditedOverrideIsValid`，`:219`：≥2 证据 URL、validUntil 有效、`invalidatesWhen` 长度 ≥20）。
- 给"某研究方向是否在升温"提供量化证据，供阶段晋级与趋势判断引用。

---

## 7. 评估与自演进（闭环回填）

- `src/pipeline/evaluate.ts` 的 `evaluateSystem()`（`:89`）把聚类/来源/证据/实时性/价值等拆成 9 个维度，按 `measured / insufficient_data` 双态与样本量上限校准，避免"用不足样本装作已测量"。
- `src/pipeline/strategy.ts` 的 `generateEvolutionPlan()`（`:55`）从 monitor + quality 报告产生行动清单，其中明确把"增强跨语言聚类"（`enhance-clustering`，`:217`）与"事件趋势预测模型"（`add-capability`，`:203`）列为待办——说明当前聚类仍主要是中英标题相似度，跨语言 embedding、趋势预测尚属 roadmap。

---

## 8. 成熟度边界（重要提醒）

1. 聚类为**中文/英文标题相似度**，跨语言 embedding、实体链接尚未实现（`strategy.ts:217`）。
2. 趋势阶段晋级依赖**人工 curated 的行业叙事种子**（`src/catalog/history.ts` 的 `industryNarratives`），且当前六事件数据集仍是 seed/demo（`ARCHITECTURE.md:78`）。
3. 评分中 `impact` 默认 55、热度含人工覆盖评分保留原值（`scoring.ts` 与 `cluster.ts` 注释）。
4. 所有 LLM 输出均为"可审计的候选"，真正公开仍受 readiness 门禁与人工发布控制（`ARCHITECTURE.md:42`）。

---

## 附：refs 目录索引

```
refs/
├── README.md                          # 本索引
├── analysis-report.md                 # 本报告
├── src/
│   ├── domain/
│   │   ├── clustering.ts              # 聚类规则（指纹/面桶/相似度）
│   │   └── scoring.ts                 # 四分数与热度标签
│   ├── pipeline/
│   │   ├── cluster.ts                 # 聚类编排 + eventabilityScore
│   │   ├── ai-enrichment.ts           # AI 洞察生成（结构化 JSON）
│   │   ├── stage-promotion.ts         # 长期趋势阶段晋级（最严趋势判断）
│   │   ├── monitor-alert.ts           # 实时趋势告警决策
│   │   ├── research-impact.ts         # 研究影响力路由
│   │   ├── evaluate.ts                # 系统多维评估
│   │   └── strategy.ts                # 自演进行动规划
│   ├── ai/
│   │   └── deepseek.ts                # DeepSeek 客户端（JSON 补全 + 重试）
│   └── pipeline/static-site/
│       └── intelligence.ts            # 公开站情报聚合/密度
└── docs/
    ├── ARCHITECTURE.md                # 架构与成熟度边界
    └── specs/
        ├── 2026-07-14-major-stage-promotion/{PRD,SYSTEM}.md
        └── 2026-07-12-timeline-and-research-depth/PRD.md
```
