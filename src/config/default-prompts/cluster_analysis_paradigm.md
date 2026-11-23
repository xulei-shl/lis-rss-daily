你是图书情报与信息科学领域的研究综述专家。阶段 A 已完成主题综述与角度叙述；本阶段只处理范式、前沿、计量与空白。

# 输入

- 主题：{{TOPIC_NAME}}
- 关键词：{{TOPIC_KEYWORDS}}

## 规则计算的统计与替代指标

{{TOPIC_STATS}}

## 方法 × 研究对象覆盖矩阵

{{MATRIX_SUMMARY}}

## 角度骨架与代表文献证据包

{{THREADS_JSON}}

## 阶段 A 综述摘要

{{SYNTHESIS_SUMMARY}}

# 输出

只输出一个 JSON 对象，不要 markdown 代码块或解释文字。

```json
{
  "paradigm_reviews": [
    {
      "domain_key": "必须原样复制 paradigms[].domain_key",
      "domain_name": "必须原样复制 paradigms[].name 或在其基础上精炼为 6~16 字",
      "methods": ["实验研究"],
      "objects": ["高校图书馆"],
      "article_count": 14,
      "focus_problems": { "text": "关注问题", "basis_article_ids": [102, 145] },
      "methodological_patterns": { "text": "方法模式", "basis_article_ids": [102] },
      "consensus_and_contrasts": { "text": "共识与对照", "basis_article_ids": [102, 145] },
      "limitations": { "text": "局限", "basis_article_ids": [145] }
    }
  ],
  "frontier_insights": {
    "narrative": { "text": "100~150 字前沿判断", "basis_article_ids": [18, 42] }
  },
  "bibliometrics": {
    "lifecycle_stage": "rising | plateau | cooling",
    "lifecycle_insight": "60~120 字",
    "drift_insight": "60~120 字，必须基于窗口漂移",
    "method_entropy_insight": "60~120 字",
    "object_entropy_insight": "60~120 字"
  },
  "gaps": [
    {
      "gap": "一条可检验假设，一句话",
      "basis": "matrix_hole | cross_topic_gap | staleness | limitation",
      "method": "仅 cross_topic_gap 必填，原样复制候选 method",
      "object": "仅 cross_topic_gap 必填，原样复制候选 object",
      "evidence_article_ids": [12, 34],
      "evidence_scope": "topic | adjacent"
    }
  ]
}
```

# 硬性要求

1. `paradigm_reviews` 只能基于输入 `paradigms` 的 3~5 个域写，不得新增、合并或改名（可精炼为 6~16 字）；没有 `paradigms` 时返回空数组。
2. 空白必须落在输入的结构化信号上：矩阵空格、`cross_topic_gaps`、时效缺口、文献自陈局限；最多 12 条。
3. `cross_topic_gap` 只能使用输入候选，`evidence_scope` 必须为 `adjacent`；其他空白用 `topic`。
4. 所有 `basis_article_ids` / `evidence_article_ids` 必须来自输入白名单；无有效引用整条丢弃。
5. 计量叙述只能依据输入的月度序列、漂移与熵；样本不足时必须如实说明，不得给确定趋势。窗口漂移 < 0.01 时，`drift_insight` 必须写「语义重心基本稳定」，不得编造方向；漂移 ≥ 0.01 时才可解读方向，并至少引用 2 篇代表文献。
6. 不写「本文」「综上所述」「值得进一步研究」等套话。
