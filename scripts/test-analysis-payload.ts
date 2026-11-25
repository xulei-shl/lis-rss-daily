/**
 * 分析输入打包单测（纯函数，无 DB / LLM）。
 *
 * 覆盖 I2 的硬约束：243 篇输入 ≤24k 字符、角度 key 永不裁剪、L2 证据 ≤40 篇。
 */

import assert from 'node:assert/strict';
import {
  ANALYSIS_INPUT_CHAR_BUDGET,
  MAX_EVIDENCE_ARTICLES,
  packAnalysisInput,
} from '../src/topic-cluster/service/analysis-payload.js';
import type { TopicMemberView } from '../src/topic-cluster/service/member-view.js';
import type { ThreadArticlesSelection, TopicThreadsSelection } from '../src/db.js';
import type { MatrixResult } from '../src/topic-cluster/service/matrix.js';
import type { MetricRow } from '../src/topic-cluster/repo/metrics.js';
import { buildParadigmDomains } from '../src/topic-cluster/service/paradigm.js';
import { isLikelyTruncated } from '../src/topic-cluster/llm/client.js';
import {
  parsePhaseA,
  parsePhaseB,
  type ParadigmInput,
  type SynthesisInput,
} from '../src/topic-cluster/llm/analysis.js';
import { parseSubtopicGaps } from '../src/topic-cluster/llm/subtopic-gaps.js';
import { parseInsightReport } from '../src/topic-cluster/llm/insight.js';
import { ClusterSchemaError } from '../src/topic-cluster/llm/schema.js';
import { buildReviewGroups } from '../src/topic-cluster/service/review-builder.js';
import { buildTopicInsightClusters } from '../src/topic-cluster/service/insight-builder.js';
import { vectorToBlob } from '../src/topic-cluster/domain/vector.js';
import type {
  ClusterTopicGapsSelection,
  ClusterTopicReviewsSelection,
  ClusterTopicsSelection,
} from '../src/db.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

const LONG = '这是一段用于填充预算的切面文本，包含研究问题、方法、对象、发现与局限。'.repeat(4);

function member(id: number): TopicMemberView {
  return {
    articleId: id,
    vector: new Float32Array(16),
    eventDate: `2024-${String((id % 12) + 1).padStart(2, '0')}-01`,
    precision: 'day',
    methodKeys: ['实验研究'],
    objectKeys: ['高校图书馆'],
    similarity: 0.8,
    isPrimary: true,
    rank: id,
    facet: {
      research_question: `研究问题 ${id} ${LONG}`,
      method: '实验研究',
      study_object: '高校图书馆',
      core_finding: `核心发现 ${id} ${LONG}`,
      limitation: `局限 ${id} ${LONG}`,
      evidence_quotes: [`原文短句 ${id} ${LONG}`],
    },
  };
}

const members = Array.from({ length: 243 }, (_, index) => member(index + 1));

const threads: TopicThreadsSelection[] = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  topic_id: 1,
  angle_key: `a-key-${index + 1}`,
  angle_label: null,
  pattern_type: index % 2 === 0 ? 'linear' : 'divergent',
  article_count: 24,
  period_start: '2024-01-01',
  period_end: '2024-12-01',
  status: 'ACTIVE',
  trend: 'flat',
  summary: null,
  created_at: '2024-01-01',
  updated_at: '2024-12-01',
}));

const threadArticles: ThreadArticlesSelection[] = [];
for (let angle = 0; angle < 10; angle += 1) {
  for (let seq = 0; seq < 24; seq += 1) {
    const articleId = angle * 24 + seq + 1;
    threadArticles.push({
      thread_id: angle + 1,
      article_id: articleId,
      seq,
      relation: seq === 0 ? 'origin' : 'continue',
      similarity_to_prev: seq === 0 ? null : 0.9,
      shared_method: 1,
      shared_object: 1,
      academic_role: angle % 2 === 0 ? 'backbone' : seq % 6 === 0 ? 'divergent' : 'satellite',
      is_representative: angle % 2 === 1 && seq % 6 === 0 ? 1 : 0,
    } as ThreadArticlesSelection);
  }
}

const matrix: MatrixResult = {
  methods: ['实验研究', '问卷调查'],
  objects: ['高校图书馆', '公共图书馆'],
  cells: Array.from({ length: 4 }, (_, index) => ({
    method: index < 2 ? '实验研究' : '问卷调查',
    object: index % 2 === 0 ? '高校图书馆' : '公共图书馆',
    count: 20,
    articleIds: [index + 1],
  })),
  holes: Array.from({ length: 12 }, (_, index) => ({
    method: index % 2 === 0 ? '实验研究' : '问卷调查',
    object: index % 3 === 0 ? '高校图书馆' : '公共图书馆',
    methodCount: 30,
    objectCount: 30,
    weight: 30,
  })),
};

const metrics: MetricRow[] = Array.from({ length: 12 }, (_, index) => ({
  topicId: 1,
  period: `2024-${String(index + 1).padStart(2, '0')}`,
  addedLinkedCount: 20,
  addedPrimaryCount: 15,
  cumulativeLinkedCount: 20 * (index + 1),
  cumulativePrimaryCount: 15 * (index + 1),
  activeAngleCount: 10,
  avgSimilarity: 0.82,
  centroidDrift: 0.05,
  methodEntropy: 1.2,
  objectEntropy: 1.1,
}));

const briefs = new Map(
  members.map((item) => [
    item.articleId,
    { title: `文章 ${item.articleId}`, aiSummary: LONG.repeat(3), publishedYear: 2024 },
  ])
);

console.log('分析输入打包');

check('243 篇 + 10 角度的输入不超过 24k 字符', () => {
  const packed = packAnalysisInput({
    topicName: '测试主题',
    topicKeywords: ['测试'],
    members,
    threads,
    threadArticles,
    matrix,
    metrics,
    briefs,
  });
  assert.ok(
    packed.chars <= ANALYSIS_INPUT_CHAR_BUDGET,
    `实际 ${packed.chars} > ${ANALYSIS_INPUT_CHAR_BUDGET}`
  );
});

check('裁剪后角度列表与 angle_key 一个不少', () => {
  const packed = packAnalysisInput({
    topicName: '测试主题',
    topicKeywords: ['测试'],
    members,
    threads,
    threadArticles,
    matrix,
    metrics,
    briefs,
  });
  const parsed = JSON.parse(packed.threadsJson) as { angles: Array<{ angle_key: string }> };
  assert.deepEqual(
    parsed.angles.map((angle) => angle.angle_key).sort(),
    threads.map((thread) => thread.angle_key).sort()
  );
});

check('证据包总量不超过 40 篇，且每个角度至少保留代表作', () => {
  const packed = packAnalysisInput({
    topicName: '测试主题',
    topicKeywords: ['测试'],
    members,
    threads,
    threadArticles,
    matrix,
    metrics,
    briefs,
  });
  assert.ok(packed.evidenceByArticleId.size <= MAX_EVIDENCE_ARTICLES);
  const parsed = JSON.parse(packed.threadsJson) as {
    angles: Array<{ pattern_type: string; representative_ids: number[] }>;
  };
  for (const angle of parsed.angles.filter((item) => item.pattern_type === 'divergent')) {
    assert.ok(angle.representative_ids.length > 0);
  }
});

/* ── 输出契约与证据校验 ── */

const evidencePack = {
  articleId: 1,
  title: '证据文章',
  year: 2024,
  researchQuestion: '研究问题',
  method: '实验研究',
  studyObject: '高校图书馆',
  coreFinding: '核心发现',
  limitation: null,
  evidenceQuotes: ['这是一条可逐字引用的原文短句'],
  summaryExcerpt: '全文总结节选，包含理论框架与论证过程。',
};

const contractInput: SynthesisInput = {
  userId: 1,
  topicName: '测试主题',
  topicKeywords: ['测试'],
  statsText: '统计',
  threadsJson: '{}',
  matrixSummary: '矩阵',
  changeContext: '',
  allowedArticleIds: new Set([1, 2]),
  evidenceByArticleId: new Map([[1, evidencePack]]),
  anglePatterns: new Map([['a-1', 'linear']]),
};

check('overview 缺失时由 synthesis 归一化生成', () => {
  const result = parsePhaseA(
    {
      overview: '',
      synthesis: {
        theoretical_basis: {
          text: '理论基础综述',
          basis_article_ids: [1],
          quotes: ['这是一条可逐字引用的原文短句'],
        },
        historical_stages: { text: '历史分期综述', basis_article_ids: [1] },
      },
      angles: [
        {
          angle_key: 'a-1',
          label: '测试角度',
          pattern_type: 'linear',
          narrative: '该角度从起步走向当前关注点。',
          cited_article_ids: [1],
        },
      ],
    },
    contractInput
  );

  assert.equal(result.overview, '理论基础综述 历史分期综述');
  assert.equal(result.synthesis.theoreticalBasis?.quotes.length, 1);
  assert.equal(result.angles.length, 1);
});

check('无法在证据中匹配的 quotes 被丢弃，但论述本身保留', () => {
  const result = parsePhaseA(
    {
      synthesis: {
        theoretical_basis: {
          text: '有依据的论述',
          basis_article_ids: [1],
          quotes: ['这条原文并不存在'],
        },
      },
      angles: [],
    },
    contractInput
  );
  assert.equal(result.synthesis.theoreticalBasis?.quotes.length, 0);
  assert.equal(result.synthesis.theoreticalBasis?.text, '有依据的论述');
});

check('无引用且未以「证据不足：」开头的论述整条丢弃', () => {
  const result = parsePhaseA(
    {
      synthesis: {
        theoretical_basis: { text: '没有引用但写得很确定', basis_article_ids: [] },
        methodology_summary: { text: '证据不足：仅 1 篇涉及该方法', basis_article_ids: [] },
      },
      angles: [],
    },
    contractInput
  );
  assert.equal(result.synthesis.theoreticalBasis, null);
  assert.equal(result.synthesis.methodologySummary?.insufficient, true);
});

check('pattern_type 与输入不一致的角度被丢弃', () => {
  const result = parsePhaseA(
    {
      synthesis: {},
      angles: [
        {
          angle_key: 'a-1',
          label: '错误类型',
          pattern_type: 'divergent',
          narrative: '叙述',
        },
      ],
    },
    contractInput
  );
  assert.equal(result.angles.length, 0);
});

check('阶段 B 丢弃无法回链的空白，保留合法空白', () => {
  const phaseA = parsePhaseA({ synthesis: {}, angles: [] }, contractInput);
  const input: ParadigmInput = { ...contractInput, synthesis: phaseA.synthesis };
  const result = parsePhaseB(
    {
      paradigm_reviews: [],
      gaps: [
        { gap: '无菌空白', basis: 'matrix_hole', evidence_article_ids: [999] },
        { gap: '可检验空白', basis: 'matrix_hole', evidence_article_ids: [1] },
      ],
    },
    input
  );
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].gap, '可检验空白');
});

check('大上下文预算会放大证据与步骤，但不超预算', () => {
  const budget = 87_692;
  const packed = packAnalysisInput({
    topicName: '测试主题',
    topicKeywords: ['测试'],
    members,
    threads,
    threadArticles,
    matrix,
    metrics,
    briefs,
    budget,
  });
  assert.ok(packed.chars <= budget, `实际 ${packed.chars} > ${budget}`);
  assert.ok(packed.evidenceByArticleId.size > 40, `证据 ${packed.evidenceByArticleId.size} 未放大`);
  assert.ok(packed.evidenceByArticleId.size <= 120);
  const parsed = JSON.parse(packed.threadsJson) as {
    angles: Array<{ steps: unknown[] }>;
  };
  assert.ok(parsed.angles.some((angle) => angle.steps.length > 6));
});

check('阶段 B 携带范式域与跨主题空白时仍不超过 24k 字符', () => {
  const { domains } = buildParadigmDomains(matrix, members);
  const packed = packAnalysisInput({
    topicName: '测试主题',
    topicKeywords: ['测试'],
    members,
    threads,
    threadArticles,
    matrix,
    metrics,
    briefs,
    paradigmDomains: domains,
    crossTopicGaps: [
      {
        method: '实验研究',
        object: '公共图书馆',
        methodCount: 20,
        objectCount: 12,
        adjacentTopicId: 2,
        adjacentTopicName: '邻近主题',
        evidenceArticleIds: [1, 25],
      },
    ],
  });
  assert.ok(
    packed.chars <= ANALYSIS_INPUT_CHAR_BUDGET,
    `实际 ${packed.chars} > ${ANALYSIS_INPUT_CHAR_BUDGET}`
  );
  const parsed = JSON.parse(packed.threadsJson) as {
    paradigms?: Array<{ representative_ids: number[] }>;
    cross_topic_gaps?: Array<{ method: string }>;
  };
  assert.ok(parsed.paradigms && parsed.paradigms.length >= 3);
  assert.equal(parsed.cross_topic_gaps?.[0].method, '实验研究');
  assert.ok(parsed.paradigms.every((domain) => domain.representative_ids.length <= 7));
});

check('截断识别：无闭合符或接近 maxTokens 都判定为截断', () => {
  assert.equal(isLikelyTruncated('{"a": ', 100), true);
  assert.equal(isLikelyTruncated(`{"a":"${'x'.repeat(200)}"}`, 100), true);
  assert.equal(isLikelyTruncated('{"a":1}', 100), false);
  assert.equal(isLikelyTruncated('```json\n{}\n```', 100), false);
});

/* ── v3.1 子主题独立空白分析与洞察联动 ── */

check('子主题空白解析：白名单过滤、去重、上限 3 条，越界整组抛错', () => {
  const allowed = new Set([101, 102, 103]);
  const parsed = parseSubtopicGaps(
    {
      gaps: [
        { gap: '跨馆多模态数据缺乏统一评估基准。', evidence_article_ids: [101, 999] },
        { gap: '跨馆多模态数据缺乏统一评估基准。', evidence_article_ids: [102] },
        { gap: '缺少纵向对比验证。', evidence_article_ids: [102, 103] },
        { gap: '未验证老年用户可访问性。', evidence_article_ids: [103] },
        { gap: '第 4 条应被上限截断。', evidence_article_ids: [101] },
      ],
    },
    allowed
  );
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].basis, 'llm_analysis');
  assert.deepEqual(parsed[0].evidenceArticleIds, [101]);

  assert.throws(
    () =>
      parseSubtopicGaps(
        { gaps: [{ gap: '越界空白', evidence_article_ids: [999] }] },
        allowed
      ),
    ClusterSchemaError
  );
  assert.deepEqual(parseSubtopicGaps({ gaps: [] }, allowed), []);
});

check('综述组为子主题空白保留全量成员切面与局部矩阵统计', () => {
  const vec = new Float32Array(16);
  vec[0] = 1;
  const largeMembers: TopicMemberView[] = Array.from({ length: 24 }, (_, idx) => ({
    articleId: idx + 1,
    vector: vec,
    eventDate: `2025-${String((idx % 12) + 1).padStart(2, '0')}-01`,
    precision: 'day',
    methodKeys: ['实验研究'],
    objectKeys: ['高校图书馆'],
    similarity: 0.9,
    isPrimary: true,
    rank: idx + 1,
    facet: {
      research_question: `问题 ${idx + 1}`,
      method: '实验研究',
      study_object: '高校图书馆',
      core_finding: `发现 ${idx + 1}`,
      limitation: `局限 ${idx + 1}`,
    },
  }));
  const groups = buildReviewGroups(largeMembers, new Map());
  assert.equal(groups.length, 1);
  assert.ok(groups[0].evidence.length <= 18 && groups[0].evidence.length < 24);
  assert.equal(groups[0].gapMembers.length, 24);
  assert.ok(groups[0].gapStatsText.includes('实验研究'));
});

check('洞察聚类：先对综述聚元簇再挂载空白，不被大量空白拆散且兼容 16 条成熟度', () => {
  const v1 = new Float32Array(16);
  v1[0] = 1;
  const v2 = new Float32Array(16);
  v2[0] = 0.9;
  v2[1] = Math.sqrt(1 - 0.81);
  const blob1 = vectorToBlob(v1);
  const blob2 = vectorToBlob(v2);

  const topic = {
    id: 1,
    name: '智慧图书馆',
  } as ClusterTopicsSelection;

  const reviews: ClusterTopicReviewsSelection[] = [
    {
      id: 11,
      topic_id: 1,
      review_key: 'rv-a-sub1',
      title: '子群一综述',
      abstract: '摘要一',
      review_json: JSON.stringify({
        sections: {
          findings: { text: '主要发现一' },
          limitations: { text: '旧局限段落' },
        },
      }),
      centroid: blob1,
    } as ClusterTopicReviewsSelection,
    {
      id: 12,
      topic_id: 1,
      review_key: 'rv-a-sub2',
      title: '子群二综述',
      abstract: '摘要二',
      review_json: JSON.stringify({
        sections: {
          findings: { text: '主要发现二' },
          limitations: { text: '旧局限段落二' },
        },
      }),
      centroid: blob2,
    } as ClusterTopicReviewsSelection,
  ];

  // 构造 10 条子主题 LLM 空白 + 2 条宏观空白（其中 1 条旧 limitation 应被去重跳过）
  const subtopicGaps: ClusterTopicGapsSelection[] = Array.from({ length: 10 }, (_, idx) => ({
    id: 100 + idx,
    topic_id: 1,
    gap_key: `sg-${idx}`,
    subtopic_key: idx < 5 ? 'a-sub1' : 'a-sub2',
    scope: 'subtopic',
    gap: `分面空白 ${idx}`,
    basis: 'llm_analysis',
    method: null,
    object: null,
    evidence_ids_json: '[1]',
    embedding: idx < 5 ? blob1 : blob2,
    embedding_dim: 16,
    source_analysis_hash: 'h',
    status: 'active',
    created_at: '',
    updated_at: '',
  } as ClusterTopicGapsSelection));

  const macroGaps: ClusterTopicGapsSelection[] = [
    {
      id: 201,
      topic_id: 1,
      gap_key: 'gp-hole',
      subtopic_key: 'a-sub1',
      scope: 'topic',
      gap: '跨分面矩阵空白',
      basis: 'matrix_hole',
      method: '问卷调查',
      object: '公共图书馆',
      evidence_ids_json: '[1]',
      embedding: blob1,
      embedding_dim: 16,
      source_analysis_hash: 'h',
      status: 'active',
      created_at: '',
      updated_at: '',
    } as ClusterTopicGapsSelection,
    {
      id: 202,
      topic_id: 1,
      gap_key: 'gp-old-lim',
      subtopic_key: 'a-sub1',
      scope: 'topic',
      gap: '旧阶段 B limitation 空白',
      basis: 'limitation',
      method: null,
      object: null,
      evidence_ids_json: '[1]',
      embedding: blob1,
      embedding_dim: 16,
      source_analysis_hash: 'h',
      status: 'active',
      created_at: '',
      updated_at: '',
    } as ClusterTopicGapsSelection,
  ];

  const clusters = buildTopicInsightClusters({
    topic,
    reviews,
    gaps: [...subtopicGaps, ...macroGaps],
  });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].reviews.length, 2);
  // 已有 subtopic 空白时省略冗余 limitations 节，并跳过宏观旧 limitation
  assert.equal(clusters[0].reviews[0].sections.limitations, undefined);
  assert.equal(clusters[0].gaps.length, 11);
  assert.equal(clusters[0].gaps.some((g) => g.id === 202), false);
  assert.equal(clusters[0].gaps[0].sourceReviewId, 11);
  assert.equal(clusters[0].gaps[0].scope, 'subtopic');

  // 校验 parseInsightReport 允许超过 8 条空白的 gap_maturity
  const report = parseInsightReport(
    {
      title: '智慧图书馆跨分面研判',
      thesis: '核心判断。',
      convergences: [{ text: '收敛结论。', review_ids: [11, 12], gap_ids: [] }],
      tensions: [],
      gap_maturity: clusters[0].gaps.map((g) => ({
        gap_id: g.id,
        state: 'closing',
        reason: '已被另一分面回应',
      })),
      agenda: [{ text: '联合验证。', review_ids: [11], gap_ids: [100] }],
    },
    {
      userId: 1,
      scope: clusters[0].scope,
      reviews: clusters[0].reviews,
      gaps: clusters[0].gaps,
      previousReport: null,
      newRefKeys: [],
    }
  );
  assert.equal(report.gapMaturity.length, 11);
});

console.log(`\n全部通过：${passed} 项`);
