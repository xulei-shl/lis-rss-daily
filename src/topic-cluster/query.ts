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

import { getDb, type ThreadArticlesSelection } from '../db.js';
import type { AnalysisStatus } from './config.js';
import type { Trend } from './domain/metrics.js';
import type { AnalysisResult, GapBasis } from './llm/analysis.js';
import type { MatrixResult } from './service/matrix.js';
import { listTopicMetrics, type MetricRow } from './repo/metrics.js';
import { listThreads, listThreadArticles } from './repo/threads.js';
import { getActiveSet } from './repo/sets.js';
import { getTopicBySlug, listTopicsByVersion } from './repo/topics.js';
import { listFacetsByArticleIds } from './repo/facets.js';
import { parseFacetFields, type DatePrecision, type FacetFields } from './domain/facet.js';
import { normalizeMethodKeys, normalizeObjectKeys } from './domain/vocab.js';
import { CLUSTER_CONFIG } from './config.js';
import { getArticleBriefs } from './source.js';

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
  relation: string;
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
}

export interface TopicAngle {
  threadId: number;
  angleKey: string;
  angleLabel: string | null;
  articleCount: number;
  trend: Trend | null;
  narrative: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  steps: TopicArticleStep[];
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
  setVersion: number;
  analysisStatus: AnalysisStatus | 'missing';
  analysisError: string | null;
  analysis: AnalysisResult | null;
  matrix: MatrixResult | null;
  angles: TopicAngle[];
  /** 未构成线索、平铺展示的文章（设计文档 §7.5 的降级路径） */
  looseArticles: TopicArticleStep[];
  metrics: MetricRow[];
  /** 同一版本下的邻近主题（用于「主题间关系」展示） */
  adjacent: Array<{ id: number; slug: string; name: string; sharedMethod: boolean; sharedObject: boolean }>;
}

/** 主题详情（slug 或数字 id） */
export async function getTopicDetail(slugOrId: string): Promise<TopicDetail | null> {
  const topic = await resolveTopic(slugOrId);
  if (!topic) return null;

  const [analysisRow, threads, threadArticles, members, metrics] = await Promise.all([
    getDb()
      .selectFrom('cluster_topic_analysis')
      .selectAll()
      .where('topic_id', '=', topic.id)
      .executeTakeFirst(),
    listThreads(topic.id),
    listThreadArticles(topic.id),
    listTopicMembersForQuery(topic.id),
    listTopicMetrics(topic.id),
  ]);

  const briefs = await getArticleBriefs(members.map((member) => member.articleId));

  const stepOf = (row: ThreadArticlesSelection): TopicArticleStep => {
    const member = members.find((item) => item.articleId === row.article_id);
    const brief = briefs.get(row.article_id);
    return {
      articleId: row.article_id,
      seq: row.seq,
      relation: row.relation ?? 'continue',
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

  const angles: TopicAngle[] = threads.map((thread) => ({
    threadId: thread.id,
    angleKey: thread.angle_key,
    angleLabel: thread.angle_label,
    articleCount: thread.article_count,
    trend: (thread.trend as Trend | null) ?? null,
    narrative: thread.summary,
    periodStart: thread.period_start,
    periodEnd: thread.period_end,
    steps: markCrossPrecision(
      threadArticles
        .filter((row) => row.thread_id === thread.id)
        .map(stepOf)
        .sort((a, b) => a.seq - b.seq)
    ),
  }));

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
    setVersion: topic.set_version,
    analysisStatus: (analysisRow?.status as AnalysisStatus | undefined) ?? 'missing',
    analysisError: analysisRow?.error_message ?? null,
    analysis: parseAnalysis(analysisRow?.analysis_json ?? null),
    matrix: parseMatrix(analysisRow?.matrix_json ?? null),
    angles,
    looseArticles,
    metrics,
    adjacent: await findAdjacentTopics(topic.id, topic.set_version, members),
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

async function resolveTopic(slugOrId: string) {
  const numeric = Number(slugOrId);
  if (Number.isInteger(numeric) && numeric > 0) {
    const row = await getDb()
      .selectFrom('cluster_topics')
      .selectAll()
      .where('id', '=', numeric)
      .executeTakeFirst();
    if (row) return row;
  }
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (!active) return undefined;
  return getTopicBySlug(active.version, slugOrId);
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
    const parsed = JSON.parse(raw) as AnalysisResult;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      overview: typeof parsed.overview === 'string' ? parsed.overview : '',
      angles: Array.isArray(parsed.angles) ? parsed.angles : [],
      trend: parsed.trend ?? { summary: '', direction: 'flat', evidenceArticleIds: [] },
      gaps: Array.isArray(parsed.gaps)
        ? parsed.gaps.map((gap) => ({ ...gap, basis: gap.basis as GapBasis }))
        : [],
      consensus: Array.isArray(parsed.consensus) ? parsed.consensus : [],
      controversies: Array.isArray(parsed.controversies) ? parsed.controversies : [],
      historySummary: typeof parsed.historySummary === 'string' ? parsed.historySummary : null,
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


