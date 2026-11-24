/**
 * 读取模型（Read Model）。
 *
 * 面向页面与检索的只读查询统一收在这里，被 API 路由与命令行脚本共用。
 * 与 repo/ 的分工：
 *   - repo/   按表 CRUD，服务于写入路径；
 *   - query.ts 面向展示的联表查询与 JSON 反序列化，服务于读取路径。
 *
 * 版本约束（设计文档 §7.9 强制项）：所有查询都必须带 `set_version = active`，
 * 否则会把归档版本的旧主题混进来。
 */

import {
  getDb,
  type ClusterInsightReportsSelection,
  type ClusterTopicReviewsSelection,
  type ClusterTopicsSelection,
  type ThreadArticlesSelection,
} from '../db.js';
import type { AnalysisStatus } from './config.js';
import type { Trend } from './domain/metrics.js';
import { emptyAnalysisResult, type AnalysisResult, type GapBasis } from './llm/analysis.js';
import type { MatrixResult } from './service/matrix.js';
import { listTopicMetrics, type MetricRow } from './repo/metrics.js';
import { listThreads, listThreadArticles } from './repo/threads.js';
import { getActiveSet } from './repo/sets.js';
import { listTopicRunLogs } from './repo/run-logs.js';
import { getTopicById, getTopicBySlug, listTopicsByVersion } from './repo/topics.js';
import {
  findTopicIdBySlugAnyVersion,
  getMergedTopicIdById,
  getMergedTopicIdBySlug,
  getRemappedTopicId,
} from './repo/remap.js';
import { listFacetsByArticleIds } from './repo/facets.js';
import { parseFacetFields, type DatePrecision, type FacetFields } from './domain/facet.js';
import { deriveAngleLabel } from './domain/chaining.js';
import { normalizeMethodKeys, normalizeObjectKeys } from './domain/vocab.js';
import { CLUSTER_CONFIG } from './config.js';
import { getArticleBriefs } from './source.js';
import { listPublishedInsightReports } from './repo/insights.js';
import { listReviewsByTopic } from './repo/reviews.js';
import { listActiveGapsByTopic } from './repo/gaps.js';
import type { DeepReview } from './llm/review.js';
import type { InsightReport } from './llm/insight.js';

export type TopicSort = 'recent' | 'size' | 'name';

export interface TopicCard {
  id: number;
  slug: string;
  name: string;
  keywords: string[];
  status: string;
  linkedCount: number;
  primaryCount: number;
  periodAddedCount: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
  lastAnalyzedAt: string | null;
  analysisStatus: AnalysisStatus | 'missing';
  overview: string | null;
  trend: Trend | null;
  angleCount: number | null;
  gapCount: number | null;
  threadCount: number;
}

export interface TopicListParams {
  search?: string;
  sort?: TopicSort;
  limit?: number;
  offset?: number;
}

export interface TopicListResult {
  setVersion: number | null;
  total: number;
  items: TopicCard[];
}

/** 主题列表（支持检索与排序） */
export async function listTopicCards(params: TopicListParams = {}): Promise<TopicListResult> {
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (!active) return { setVersion: null, total: 0, items: [] };

  const limit = Math.min(Math.max(params.limit ?? 24, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const search = params.search?.trim();

  let base = getDb()
    .selectFrom('cluster_topics as t')
    .where('t.set_version', '=', active.version);

  if (search) {
    const like = `%${search}%`;
    base = base.where((eb) =>
      eb.or([
        eb('t.name', 'like', like),
        eb('t.keywords', 'like', like),
        // 检索也覆盖切面文本：命中「方法/对象/发现」的文章所在主题
        eb.exists(
          eb
            .selectFrom('article_topic_links as l')
            .innerJoin('article_cluster_facets as f', 'f.article_id', 'l.article_id')
            .select('l.article_id')
            .whereRef('l.topic_id', '=', 't.id')
            .where('f.facet_text', 'like', like)
        ),
      ])
    );
  }

  const countRow = await base.select((eb) => eb.fn.count('t.id').as('count')).executeTakeFirst();
  const total = Number(countRow?.count ?? 0);

  let listQuery = base
    .leftJoin('cluster_topic_analysis as a', 'a.topic_id', 't.id')
    .leftJoin('topic_threads as th', 'th.topic_id', 't.id')
    .select([
      't.id as id',
      't.slug as slug',
      't.name as name',
      't.keywords as keywords',
      't.status as status',
      't.linked_count as linked_count',
      't.primary_count as primary_count',
      't.period_added_count as period_added_count',
      't.first_event_date as first_event_date',
      't.last_event_date as last_event_date',
      't.last_analyzed_at as last_analyzed_at',
      'a.status as analysis_status',
      'a.analysis_json as analysis_json',
    ])
    .groupBy('t.id')
    .select((eb) => eb.fn.count('th.id').as('thread_count'));

  if (params.sort === 'size') {
    listQuery = listQuery.orderBy('t.linked_count', 'desc');
  } else if (params.sort === 'name') {
    listQuery = listQuery.orderBy('t.name', 'asc');
  } else {
    listQuery = listQuery
      .orderBy('t.period_added_count', 'desc')
      .orderBy('t.last_event_date', 'desc');
  }

  const rows = await listQuery.orderBy('t.id', 'asc').limit(limit).offset(offset).execute();

  return {
    setVersion: active.version,
    total,
    items: rows.map((row) => toTopicCard(row)),
  };
}

export interface TopicArticleStep {
  articleId: number;
  seq: number;
  /** divergent 角度为 null（不构造承接关系） */
  relation: string | null;
  similarityToPrev: number | null;
  sharedMethod: boolean;
  sharedObject: boolean;
  crossPrecision: boolean;
  isPrimary: boolean;
  similarity: number;
  eventDate: string | null;
  precision: DatePrecision;
  title: string;
  url: string | null;
  facet: FacetFields | null;
  academicRole: 'backbone' | 'divergent' | 'satellite' | 'frontier';
  isRepresentative: boolean;
}

export interface TopicAngle {
  threadId: number;
  angleKey: string;
  angleLabel: string | null;
  patternType: 'linear' | 'divergent';
  articleCount: number;
  trend: Trend | null;
  narrative: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  representatives: number[];
  steps: TopicArticleStep[];
}

/** 一轮流水线在单个主题上的执行记录 */
export interface TopicRunLog {
  id: number;
  trigger: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** 该主题本轮新增的聚类文献数 */
  addedCount: number;
  /** 该主题本轮新增/重写的深度综述数 */
  reviewAddedCount: number;
  /** 本轮生成的主题内洞察报告数（全局） */
  insightReports: number;
  errorMessage: string | null;
}

export interface TopicReviewSection {
  key: string;
  label: string;
  text: string;
  basisArticleIds: number[];
  quotes: string[];
  insufficient: boolean;
}

export interface TopicReviewGapItem {
  gapKey: string;
  gap: string;
  basis: string;
  method: string | null;
  object: string | null;
  evidenceArticleIds: number[];
}

export interface TopicReviewItem {
  id: number;
  reviewKey: string;
  subtopicKey: string;
  title: string;
  abstract: string;
  status: string;
  version: number;
  memberCount: number;
  representativeIds: number[];
  citations: number[];
  sections: TopicReviewSection[];
  gaps: TopicReviewGapItem[];
  generatedAt: string | null;
  updatedAt: string;
}

export interface TopicInsightLinkedText {
  text: string;
  reviewIds: number[];
  gapIds: number[];
}

export interface TopicInsightItem {
  id: number;
  title: string;
  thesis: string;
  convergences: TopicInsightLinkedText[];
  tensions: TopicInsightLinkedText[];
  gapMaturity: Array<{ gapId: number; gap: string; state: string; reason: string }>;
  agenda: TopicInsightLinkedText[];
  topicIds: number[];
  topics: Array<{ id: number; slug: string; name: string }>;
  version: number;
  updatedAt: string;
}

export interface TopicDetail {
  id: number;
  slug: string;
  name: string;
  keywords: string[];
  status: string;
  linkedCount: number;
  primaryCount: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  setVersion: number;
  analysisStatus: AnalysisStatus | 'missing';
  analysisError: string | null;
  analysis: AnalysisResult | null;
  matrix: MatrixResult | null;
  angles: TopicAngle[];
  /** 未构成线索、平铺展示的文章（设计文档 §7.5 的降级路径） */
  looseArticles: TopicArticleStep[];
  metrics: MetricRow[];
  /** 该主题最近若干轮的执行日志（最近的在前） */
  runLogs: TopicRunLog[];
  /** 同一版本下的邻近主题（用于「主题间关系」展示） */
  adjacent: Array<{ id: number; slug: string; name: string; sharedMethod: boolean; sharedObject: boolean }>;
  /** 主题内语义子簇的深度综述 */
  reviews: TopicReviewItem[];
  /** 该主题内部的洞察报告（综合本主题多个综述子簇） */
  insights: TopicInsightItem[];
  /** 研究空白等环节引用的证据文献（包含跨主题/邻近主题文献） */
  evidenceArticles?: Array<{ id: number; title: string; url: string | null }>;
}

/** 主题详情（slug 或数字 id） */
export async function getTopicDetail(slugOrId: string): Promise<TopicDetail | null> {
  const topic = await resolveTopic(slugOrId);
  if (!topic) return null;

  const [
    analysisRow,
    threads,
    threadArticles,
    members,
    metrics,
    runLogs,
    reviewRows,
    insightRows,
    versionTopics,
    gapRows,
  ] = await Promise.all([
    getDb()
      .selectFrom('cluster_topic_analysis')
      .selectAll()
      .where('topic_id', '=', topic.id)
      .executeTakeFirst(),
    listThreads(topic.id),
    listThreadArticles(topic.id),
    listTopicMembersForQuery(topic.id),
    listTopicMetrics(topic.id),
    listTopicRunLogs({
      userId: CLUSTER_CONFIG.userId,
      setVersion: topic.set_version,
      topicCreatedAt: topic.created_at,
      limit: 20,
    }),
    listReviewsByTopic(topic.id),
    listPublishedInsightReports(topic.set_version),
    listTopicsByVersion(topic.set_version),
    listActiveGapsByTopic(topic.id),
  ]);

  const analysis = parseAnalysis(analysisRow?.analysis_json ?? null);
  const gapArticleIds = (analysis?.gaps || []).flatMap((gap) => gap.evidenceArticleIds || []);
  const activeGapEvidenceIds = gapRows.flatMap((r) => parseNumberArray(r.evidence_ids_json));
  const allNeededArticleIds = [
    ...new Set([
      ...members.map((member) => member.articleId),
      ...gapArticleIds,
      ...activeGapEvidenceIds,
    ]),
  ];
  const briefs = await getArticleBriefs(allNeededArticleIds);

  const stepOf = (row: ThreadArticlesSelection): TopicArticleStep => {
    const member = members.find((item) => item.articleId === row.article_id);
    const brief = briefs.get(row.article_id);
    return {
      articleId: row.article_id,
      seq: row.seq,
      relation: row.relation ?? null,
      similarityToPrev: row.similarity_to_prev ?? null,
      sharedMethod: row.shared_method === 1,
      sharedObject: row.shared_object === 1,
      crossPrecision: false,
      isPrimary: member?.isPrimary ?? false,
      similarity: member?.similarity ?? 0,
      eventDate: member?.eventDate ?? null,
      precision: member?.precision ?? 'ingest',
      title: brief?.title ?? `#${row.article_id}`,
      url: brief?.url ?? null,
      facet: member?.facet ?? null,
      academicRole: row.academic_role,
      isRepresentative: row.is_representative === 1,
    };
  };

  /**
   * 跨精度标记：与**同线索上一篇**精度不同时置为 true（前端据此不画承接箭头）。
   * 必须排序后逐对比较——精度混杂是「假趋势」的主要来源（设计文档 §4.2）。
   */
  const markCrossPrecision = (steps: TopicArticleStep[]): TopicArticleStep[] => {
    for (let i = 1; i < steps.length; i += 1) {
      steps[i].crossPrecision = steps[i].precision !== steps[i - 1].precision;
    }
    return steps;
  };

  const threadedIds = new Set(threadArticles.map((row) => row.article_id));

  const memberById = new Map(members.map((member) => [member.articleId, member]));
  const angles: TopicAngle[] = threads.map((thread) => {
    const threadSteps = threadArticles.filter((row) => row.thread_id === thread.id);
    const threadMembers = threadSteps
      .map((row) => memberById.get(row.article_id))
      .filter((member): member is QueryMember => Boolean(member));
    return {
      threadId: thread.id,
      angleKey: thread.angle_key,
      // 旧数据可能没有 LLM 标签：先用规则侧高频方法/对象生成可读名，避免黑箱。
      angleLabel: thread.angle_label || deriveAngleLabel(threadMembers),
      patternType: thread.pattern_type,
      articleCount: thread.article_count,
      trend: (thread.trend as Trend | null) ?? null,
      narrative: thread.summary,
      periodStart: thread.period_start,
      periodEnd: thread.period_end,
      representatives: threadSteps
        .filter((row) => row.is_representative === 1)
        .map((row) => row.article_id),
      steps: markCrossPrecision(threadSteps.map(stepOf).sort((a, b) => a.seq - b.seq)),
    };
  });

  const looseArticles: TopicArticleStep[] = members
    .filter((member) => !threadedIds.has(member.articleId))
    .map((member) => {
      const brief = briefs.get(member.articleId);
      return {
        articleId: member.articleId,
        seq: 0,
        relation: 'loose',
        similarityToPrev: null,
        sharedMethod: false,
        sharedObject: false,
        crossPrecision: false,
        isPrimary: member.isPrimary,
        similarity: member.similarity,
        eventDate: member.eventDate,
        precision: member.precision,
        title: brief?.title ?? `#${member.articleId}`,
        url: brief?.url ?? null,
        facet: member.facet,
        academicRole: 'divergent' as const,
        isRepresentative: false,
      };
    })
    .sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''));

  return {
    id: topic.id,
    slug: topic.slug,
    name: topic.name,
    keywords: parseStringArray(topic.keywords),
    status: topic.status,
    linkedCount: topic.linked_count,
    primaryCount: topic.primary_count,
    firstEventDate: topic.first_event_date,
    lastEventDate: topic.last_event_date,
    createdAt: topic.created_at ?? null,
    updatedAt: topic.updated_at ?? null,
    setVersion: topic.set_version,
    analysisStatus: (analysisRow?.status as AnalysisStatus | undefined) ?? 'missing',
    analysisError: analysisRow?.error_message ?? null,
    analysis,
    matrix: parseMatrix(analysisRow?.matrix_json ?? null),
    angles,
    looseArticles,
    metrics,
    evidenceArticles: gapArticleIds.map((id) => {
      const brief = briefs.get(id);
      return {
        id,
        title: brief?.title ?? `#${id}`,
        url: brief?.url ?? null,
      };
    }),
    runLogs: runLogs.map((run) => ({
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      addedCount: run.topicDeltas[String(topic.id)] ?? 0,
      reviewAddedCount: run.reviewDeltas[String(topic.id)] ?? 0,
      insightReports: run.insightReports,
      errorMessage: run.errorMessage,
    })),
    adjacent: await findAdjacentTopics(topic.id, topic.set_version, members),
    reviews: reviewRows
      .map((row) => {
        const normKey = row.review_key.replace(/^rv-/, '');
        const matchingGaps = gapRows
          .filter((g) => {
            if (!g.subtopic_key) return false;
            const normSub = g.subtopic_key.replace(/^rv-/, '');
            return normSub === normKey;
          })
          .map((g) => ({
            gapKey: g.gap_key,
            gap: g.gap,
            basis: g.basis,
            method: g.method,
            object: g.object,
            evidenceArticleIds: parseNumberArray(g.evidence_ids_json),
          }));
        return toTopicReview(row, matchingGaps);
      })
      .filter((review): review is TopicReviewItem => review !== null),
    insights: insightRows
      .filter((row) => row.topic_id === topic.id)
      .map((row) => toTopicInsight(row, versionTopics))
      .filter((insight): insight is TopicInsightItem => insight !== null),
  };
}

export interface ClusterOverview {
  setVersion: number | null;
  topicCount: number;
  linkedArticleCount: number;
  facetCount: number;
  poolCount: number;
  analysisOkCount: number;
  analysisFailedCount: number;
  insufficientCount: number;
  topGrowing: Array<{ id: number; slug: string; name: string; added: number }>;
  rising: Array<{ id: number; slug: string; name: string; direction: Trend }>;
  cooling: Array<{ id: number; slug: string; name: string; direction: Trend }>;
  recentTopics: Array<{ id: number; slug: string; name: string; createdAt: string | null }>;
}

/** 全库概览（页面顶部统计条） */
export async function getClusterOverview(): Promise<ClusterOverview> {
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  const overview: ClusterOverview = {
    setVersion: active?.version ?? null,
    topicCount: 0,
    linkedArticleCount: 0,
    facetCount: 0,
    poolCount: 0,
    analysisOkCount: 0,
    analysisFailedCount: 0,
    insufficientCount: 0,
    topGrowing: [],
    rising: [],
    cooling: [],
    recentTopics: [],
  };
  if (!active) return overview;

  const topics = await listTopicsByVersion(active.version);
  overview.topicCount = topics.length;
  overview.topGrowing = [...topics]
    .filter((topic) => topic.period_added_count > 0)
    .sort((a, b) => b.period_added_count - a.period_added_count)
    .slice(0, 5)
    .map((topic) => ({
      id: topic.id,
      slug: topic.slug,
      name: topic.name,
      added: topic.period_added_count,
    }));
  overview.recentTopics = topics
    .slice()
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 5)
    .map((topic) => ({
      id: topic.id,
      slug: topic.slug,
      name: topic.name,
      createdAt: topic.created_at ?? null,
    }));

  const linkRow = await getDb()
    .selectFrom('article_topic_links')
    .where('set_version', '=', active.version)
    .select((eb) => eb.fn.count('article_id').distinct().as('articles'))
    .executeTakeFirst();
  overview.linkedArticleCount = Number(linkRow?.articles ?? 0);

  const facetRow = await getDb()
    .selectFrom('article_cluster_facets')
    .select((eb) => eb.fn.count('article_id').as('count'))
    .executeTakeFirst();
  overview.facetCount = Number(facetRow?.count ?? 0);
  overview.poolCount = Math.max(overview.facetCount - overview.linkedArticleCount, 0);

  const statusRows = await getDb()
    .selectFrom('cluster_topic_analysis as a')
    .innerJoin('cluster_topics as t', 't.id', 'a.topic_id')
    .where('t.set_version', '=', active.version)
    .select(['a.status as status'])
    .execute();
  for (const row of statusRows) {
    if (row.status === 'ok') overview.analysisOkCount += 1;
    else if (row.status === 'failed') overview.analysisFailedCount += 1;
    else overview.insufficientCount += 1;
  }

  // 升温/降温榜：取每个主题最近一次分析的趋势方向，样本不足（趋势为 null）的不列
  const trendRows = await getDb()
    .selectFrom('cluster_topic_analysis as a')
    .innerJoin('cluster_topics as t', 't.id', 'a.topic_id')
    .where('t.set_version', '=', active.version)
    .where('a.status', '=', 'ok')
    .select(['t.id as id', 't.slug as slug', 't.name as name', 'a.analysis_json as analysis_json'])
    .execute();

  for (const row of trendRows) {
    const analysis = parseAnalysis(row.analysis_json);
    const direction = analysis?.trend?.direction;
    if (!direction || direction === 'flat') continue;
    const entry = { id: row.id, slug: row.slug, name: row.name, direction };
    if (direction === 'up') overview.rising.push(entry);
    else overview.cooling.push(entry);
  }

  return overview;
}

/* ── 内部工具 ── */

const REVIEW_SECTION_LABELS: Record<string, string> = {
  researchQuestions: '研究问题',
  theoreticalBasis: '理论基础',
  methodsAndData: '方法与数据',
  findings: '主要发现',
  debates: '分歧与条件差异',
  limitations: '局限',
  agenda: '研究议程',
};

function toTopicReview(
  row: ClusterTopicReviewsSelection,
  gaps: TopicReviewGapItem[] = []
): TopicReviewItem | null {
  let parsed: DeepReview;
  try {
    parsed = JSON.parse(row.review_json) as DeepReview;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const sections: TopicReviewSection[] = [];
  for (const [key, label] of Object.entries(REVIEW_SECTION_LABELS)) {
    const section = (parsed.sections as unknown as Record<string, unknown> | undefined)?.[key];
    if (!section || typeof section !== 'object') continue;
    const record = section as Record<string, unknown>;
    if (typeof record.text !== 'string' || record.text.trim().length === 0) continue;
    sections.push({
      key,
      label,
      text: record.text,
      basisArticleIds: Array.isArray(record.basisArticleIds)
        ? record.basisArticleIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [],
      quotes: Array.isArray(record.quotes)
        ? record.quotes.filter((quote): quote is string => typeof quote === 'string')
        : [],
      insufficient: record.insufficient === true,
    });
  }

  return {
    id: row.id,
    reviewKey: row.review_key,
    subtopicKey: row.review_key.replace(/^rv-/, ''),
    title: row.title,
    abstract: row.abstract,
    status: row.status,
    version: row.version,
    memberCount: row.linked_count,
    representativeIds: parseNumberArray(row.representative_ids_json),
    citations: Array.isArray(parsed.citations)
      ? parsed.citations.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : [],
    sections,
    gaps,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  };
}

function toTopicInsight(
  row: ClusterInsightReportsSelection,
  topics: ClusterTopicsSelection[]
): TopicInsightItem | null {
  let parsed: InsightReport;
  try {
    parsed = JSON.parse(row.report_json) as InsightReport;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const topicIds = row.topic_id != null
    ? [row.topic_id]
    : parseNumberArray(row.topic_ids_json);
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));

  return {
    id: row.id,
    title: row.title,
    thesis: typeof parsed.thesis === 'string' ? parsed.thesis : '',
    convergences: Array.isArray(parsed.convergences) ? parsed.convergences : [],
    tensions: Array.isArray(parsed.tensions) ? parsed.tensions : [],
    gapMaturity: Array.isArray(parsed.gapMaturity) ? parsed.gapMaturity : [],
    agenda: Array.isArray(parsed.agenda) ? parsed.agenda : [],
    topicIds,
    topics: topicIds
      .map((id) => topicById.get(id))
      .filter((topic): topic is ClusterTopicsSelection => Boolean(topic))
      .map((topic) => ({ id: topic.id, slug: topic.slug, name: topic.name })),
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function parseNumberArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : [];
  } catch {
    return [];
  }
}

interface QueryMember {
  articleId: number;
  similarity: number;
  isPrimary: boolean;
  eventDate: string | null;
  precision: DatePrecision;
  facet: FacetFields | null;
  methodKeys: string[];
  objectKeys: string[];
}

async function listTopicMembersForQuery(topicId: number): Promise<QueryMember[]> {
  const links = await getDb()
    .selectFrom('article_topic_links')
    .selectAll()
    .where('topic_id', '=', topicId)
    .orderBy('is_primary', 'desc')
    .orderBy('similarity', 'desc')
    .execute();
  if (links.length === 0) return [];

  const facets = await listFacetsByArticleIds(links.map((link) => link.article_id));
  const facetMap = new Map(facets.map((facet) => [facet.article_id, facet]));

  return links.map((link) => {
    const facetRow = facetMap.get(link.article_id);
    const facet = facetRow ? parseFacetFields(facetRow.facet_json) : null;
    return {
      articleId: link.article_id,
      similarity: link.similarity,
      isPrimary: link.is_primary === 1,
      eventDate: facetRow?.event_date ?? null,
      precision: (facetRow?.date_precision ?? 'ingest') as DatePrecision,
      facet,
      methodKeys: facet ? normalizeMethodKeys(facet.method) : [],
      objectKeys: facet ? normalizeObjectKeys(facet.study_object) : [],
    };
  });
}

export async function resolveTopic(slugOrId: string) {
  const numeric = Number(slugOrId);
  if (Number.isInteger(numeric) && numeric > 0) {
    const row = await getDb()
      .selectFrom('cluster_topics')
      .selectAll()
      .where('id', '=', numeric)
      .executeTakeFirst();
    if (row) return row;
    const merged = await getMergedTopicIdById(numeric);
    if (merged) return getTopicById(merged);
  }
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (!active) return undefined;

  const current = await getTopicBySlug(active.version, slugOrId);
  if (current) return current;

  // 同版本微主题整合：被合并的旧 slug 直接跳到吸收它的主题。
  const mergedTopicId = await getMergedTopicIdBySlug(slugOrId);
  if (mergedTopicId) return getTopicById(mergedTopicId);

  // 旧版本 slug：按 remap 跳到新主题（重建后旧 URL 不 404）。
  const oldTopicId = await findTopicIdBySlugAnyVersion(slugOrId);
  if (!oldTopicId) return undefined;
  const newTopicId = await getRemappedTopicId(oldTopicId);
  return newTopicId ? getTopicById(newTopicId) : undefined;
}

/**
 * 邻近主题：共享方法或研究对象的其他主题（最多 5 个）。
 * 用途是给「交叉研究空白」提供上下文——两个相邻主题却从不共用某方法，就是候选空白。
 */
async function findAdjacentTopics(
  topicId: number,
  setVersion: number,
  members: QueryMember[]
): Promise<TopicDetail['adjacent']> {
  const myMethods = new Set(members.flatMap((member) => member.methodKeys));
  const myObjects = new Set(members.flatMap((member) => member.objectKeys));
  if (myMethods.size === 0 && myObjects.size === 0) return [];

  const others = await getDb()
    .selectFrom('article_topic_links as l')
    .innerJoin('cluster_topics as t', 't.id', 'l.topic_id')
    .where('l.set_version', '=', setVersion)
    .where('l.topic_id', '!=', topicId)
    .select(['t.id as id', 't.slug as slug', 't.name as name', 'l.article_id as article_id'])
    .execute();
  if (others.length === 0) return [];

  const facets = await listFacetsByArticleIds([...new Set(others.map((row) => row.article_id))]);
  const facetMap = new Map(facets.map((facet) => [facet.article_id, facet]));

  const scoreByTopic = new Map<
    number,
    { id: number; slug: string; name: string; sharedMethod: boolean; sharedObject: boolean; score: number }
  >();

  for (const row of others) {
    const facetRow = facetMap.get(row.article_id);
    const facet = facetRow ? parseFacetFields(facetRow.facet_json) : null;
    if (!facet) continue;

    const sharedMethod = normalizeMethodKeys(facet.method).some((key) => myMethods.has(key));
    const sharedObject = normalizeObjectKeys(facet.study_object).some((key) => myObjects.has(key));
    if (!sharedMethod && !sharedObject) continue;

    const existing = scoreByTopic.get(row.id);
    const score = (sharedMethod ? 1 : 0) + (sharedObject ? 1 : 0);
    if (existing) {
      existing.sharedMethod = existing.sharedMethod || sharedMethod;
      existing.sharedObject = existing.sharedObject || sharedObject;
      existing.score += score;
    } else {
      scoreByTopic.set(row.id, {
        id: row.id,
        slug: row.slug,
        name: row.name,
        sharedMethod,
        sharedObject,
        score,
      });
    }
  }

  return [...scoreByTopic.values()]
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, 5)
    .map(({ id, slug, name, sharedMethod, sharedObject }) => ({ id, slug, name, sharedMethod, sharedObject }));
}

function toTopicCard(row: {
  id: number;
  slug: string;
  name: string;
  keywords: string | null;
  status: string;
  linked_count: number;
  primary_count: number;
  period_added_count: number;
  first_event_date: string | null;
  last_event_date: string | null;
  last_analyzed_at: string | null;
  analysis_status: string | null;
  analysis_json: string | null;
  thread_count: number | bigint | string;
}): TopicCard {
  const analysis = parseAnalysis(row.analysis_json);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    keywords: parseStringArray(row.keywords),
    status: row.status,
    linkedCount: row.linked_count,
    primaryCount: row.primary_count,
    periodAddedCount: row.period_added_count,
    firstEventDate: row.first_event_date,
    lastEventDate: row.last_event_date,
    lastAnalyzedAt: row.last_analyzed_at,
    analysisStatus: (row.analysis_status as AnalysisStatus | null) ?? 'missing',
    overview: analysis?.overview ?? null,
    trend: analysis?.trend?.direction ?? null,
    angleCount: analysis ? analysis.angles.length : null,
    gapCount: analysis ? analysis.gaps.length : null,
    threadCount: Number(row.thread_count ?? 0),
  };
}

function parseAnalysis(raw: string | null | undefined): AnalysisResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AnalysisResult>;
    if (!parsed || typeof parsed !== 'object') return null;
    const base = emptyAnalysisResult();
    return {
      ...base,
      overview: typeof parsed.overview === 'string' ? parsed.overview : '',
      synthesis: parsed.synthesis ?? base.synthesis,
      angles: Array.isArray(parsed.angles) ? parsed.angles : [],
      trend: parsed.trend ?? base.trend,
      gaps: Array.isArray(parsed.gaps)
        ? parsed.gaps.map((gap) => ({ ...gap, basis: gap.basis as GapBasis }))
        : [],
      consensus: Array.isArray(parsed.consensus) ? parsed.consensus : [],
      controversies: Array.isArray(parsed.controversies) ? parsed.controversies : [],
      historySummary: typeof parsed.historySummary === 'string' ? parsed.historySummary : null,
      paradigmReviews: Array.isArray(parsed.paradigmReviews) ? parsed.paradigmReviews : [],
      frontierInsights: parsed.frontierInsights ?? null,
      bibliometrics: parsed.bibliometrics ?? null,
      phaseBStatus: parsed.phaseBStatus ?? 'pending',
    };
  } catch {
    return null;
  }
}

function parseMatrix(raw: string | null | undefined): MatrixResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MatrixResult;
    if (!parsed || !Array.isArray(parsed.cells) || !Array.isArray(parsed.holes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}


