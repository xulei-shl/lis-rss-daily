# refs/ 索引

本目录收集 Agent Pulse 项目中与**聚类（clustering）、AI 洞察（insight）、评分与趋势标签（scoring）、长期趋势阶段晋级（stage-promotion）、实时趋势告警（monitor-alert）、研究影响力（research-impact）** 相关的原始文件与实现分析，便于离线对照阅读。

## 阅读顺序建议

1. `analysis-report.md` — 实现分析总报告（含分层职责、关键函数行号、成熟度边界）
2. `docs/ARCHITECTURE.md` — 架构图与成熟度边界说明
3. `src/domain/clustering.ts` → `src/pipeline/cluster.ts` — 先看纯规则，再看编排
4. `src/domain/scoring.ts` — 四分数与热度标签
5. `src/pipeline/ai-enrichment.ts` — LLM 生成结构化洞察
6. `src/pipeline/stage-promotion.ts` — 最严格的长期趋势判断（默认 hold）
7. `src/pipeline/monitor-alert.ts` — 实时趋势/异常告警决策
8. `src/pipeline/research-impact.ts` — 论文影响力路由，辅助趋势信号
9. `src/ai/deepseek.ts` — 底层模型客户端（JSON 补全 + 重试/退避）

## 文件清单

| 路径 | 作用 |
| --- | --- |
| `analysis-report.md` | 聚类洞察与趋势判断实现分析 |
| `src/domain/clustering.ts` | 聚类规则：标题 token、指纹、面桶、相似度阈值 |
| `src/domain/scoring.ts` | confidence/heat/impact/value 与 heatLabel |
| `src/pipeline/cluster.ts` | 信号→Event 聚类编排、eventabilityScore、rescoreEvent |
| `src/pipeline/ai-enrichment.ts` | review 事件 AI 洞察生成（结构化 JSON + 校验） |
| `src/pipeline/stage-promotion.ts` | 趋势阶段晋级候选/决策/合并（Zod + allowlist） |
| `src/pipeline/monitor-alert.ts` | 实时告警决策（硬规则→状态→冷却→LLM→fallback） |
| `src/pipeline/research-impact.ts` | arXiv/OpenAlex 影响力路由 |
| `src/pipeline/evaluate.ts` | 系统多维评估（measured/insufficient_data 校准） |
| `src/pipeline/strategy.ts` | 自演进策略：聚类增强、趋势预测列 roadmap |
| `src/ai/deepseek.ts` | DeepSeek JSON 补全客户端 |
| `src/pipeline/static-site/intelligence.ts` | 公开站情报聚合/月度密度/覆盖定义 |
| `docs/ARCHITECTURE.md` | 架构与成熟度边界 |
| `docs/specs/2026-07-14-major-stage-promotion/PRD.md` | 阶段晋级 PRD |
| `docs/specs/2026-07-14-major-stage-promotion/SYSTEM.md` | 阶段晋级系统设计 |
| `docs/specs/2026-07-12-timeline-and-research-depth/PRD.md` | 时间线与研究深度 PRD |

> 说明：所有文件均按原仓库 `src/`、`docs/` 相对路径复制，行号引用以原仓库为准。
