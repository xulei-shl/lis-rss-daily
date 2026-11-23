/**
 * 多维分析输入打包（设计文档 v2 §3.1）。
 *
 * 目标：输入也有预算。旧实现把每个角度下全部成员的五字段切面塞进 Prompt，
 * 243 篇可达 70k~140k 字符，模型在真正读到「结构」之前就被长尾文献淹没。
 *
 * 本模块按优先级打包五层，并在超过 24k 字符时按 L4 → L3 → L1 步骤 → L2 代表
 * 的顺序裁剪；角度列表与 angle_key 永不裁剪（它们是输出的结构约束）。
 */

import type { ThreadArticlesSelection, TopicThreadsSelection } from '../../db.js';
import type { MatrixResult } from './matrix.js';
import { renderMatrixSummary } from './matrix.js';
import type { MetricRow } from '../repo/metrics.js';
import { renderMetricsSummary } from './metrics-builder.js';
import type { TopicMemberView } from './member-view.js';
import type { ParadigmDomain } from './paradigm.js';
import type { CrossTopicGap } from './gap-builder.js';

export const ANALYSIS_INPUT_CHAR_BUDGET = 24_000;
/** L2 证据包总篇数上限；预算再紧也不低于每角度 3 篇核心代表 */
export const MAX_EVIDENCE_ARTICLES = 40;

export interface EvidencePack {
  articleId: number;
  title: string;
  year: number | null;
  researchQuestion: string;
  method: string;
  studyObject: string;
  coreFinding: string;
  limitation: string | null;
  evidenceQuotes: string[];
  /** ai_summary 前 600 字，仅代表文献 */
  summaryExcerpt: string;
}

export interface PackedAnalysisInput {
  chars: number;
  /** 记录裁剪了哪些层，写日志用 */
  truncated: string[];
  threadsJson: string;
  matrixSummary: string;
  statsText: string;
  changeContext: string;
  evidenceByArticleId: Map<number, EvidencePack>;
  anglePatterns: Map<string, 'linear' | 'divergent'>;
}

export interface PackAnalysisInputParams {
  topicName: string;
  topicKeywords: string[];
  members: TopicMemberView[];
  threads: TopicThreadsSelection[];
  threadArticles: ThreadArticlesSelection[];
  matrix: MatrixResult;
  metrics: MetricRow[];
  briefs: Map<number, { title: string; aiSummary: string | null; publishedYear: number | null }>;
  previousOverview?: string | null;
  newArticleIds?: number[];
  /** I3：范式域与跨主题空白候选（阶段 B 使用） */
  paradigmDomains?: ParadigmDomain[];
  crossTopicGaps?: CrossTopicGap[];
  budget?: number;
}

interface PackLimits {
  stepLimit: number;
  evidenceLimit: number;
  matrixCells: number;
  matrixHoles: number;
  months: number;
  newArticles: number;
  /** 全局证据包上限；预算越大，可覆盖的代表文献越多 */
  evidenceCap: number;
  compact: boolean;
}

const MAX_LIMITS: PackLimits = {
  stepLimit: 12,
  evidenceLimit: 10,
  matrixCells: 20,
  matrixHoles: 10,
  months: 12,
  newArticles: 10,
  evidenceCap: MAX_EVIDENCE_ARTICLES,
  compact: false,
};

export function packAnalysisInput(params: PackAnalysisInputParams): PackedAnalysisInput {
  const budget = params.budget ?? ANALYSIS_INPUT_CHAR_BUDGET;
  // 预算越大，角度步骤与代表文献同步放大；用 sqrt 防止线性膨胀导致全是长尾。
  const scale = Math.max(1, budget / ANALYSIS_INPUT_CHAR_BUDGET);
  const limits: PackLimits = {
    ...MAX_LIMITS,
    stepLimit: clamp(Math.round(12 * Math.sqrt(scale)), 12, 30),
    evidenceLimit: clamp(Math.round(10 * Math.sqrt(scale)), 10, 20),
    evidenceCap: clamp(Math.round(MAX_EVIDENCE_ARTICLES * scale), MAX_EVIDENCE_ARTICLES, 120),
  };
  const truncated: string[] = [];

  let packed = renderPayload(params, limits);

  // 按实际超出比例逐轮收缩，而不是「一超限就砍到最小」：
  // 大上下文窗口下应尽量保留代表与步骤，小预算才退到紧凑模式。
  for (let attempt = 0; packed.chars > budget && attempt < 8; attempt += 1) {
    const ratio = (budget / packed.chars) * 0.95;
    const next: PackLimits = {
      stepLimit: Math.max(3, Math.floor(limits.stepLimit * ratio)),
      evidenceLimit: Math.max(3, Math.floor(limits.evidenceLimit * ratio)),
      evidenceCap: Math.max(9, Math.floor(limits.evidenceCap * ratio)),
      matrixCells: Math.max(6, Math.floor(limits.matrixCells * ratio)),
      matrixHoles: Math.max(3, Math.floor(limits.matrixHoles * ratio)),
      months: Math.max(3, Math.floor(limits.months * ratio)),
      newArticles: Math.max(3, Math.floor(limits.newArticles * ratio)),
      compact: limits.compact || Math.floor(limits.stepLimit * ratio) <= 6,
    };

    if (
      next.stepLimit === limits.stepLimit &&
      next.evidenceLimit === limits.evidenceLimit &&
      next.evidenceCap === limits.evidenceCap &&
      next.matrixCells === limits.matrixCells
    ) {
      break;
    }

    Object.assign(limits, next);
    truncated.push(`按预算收缩：步骤 ${limits.stepLimit}、每角代表 ${limits.evidenceLimit}`);
    packed = renderPayload(params, limits);
  }

  // 仍超限（极端长文本）：用最小可读配置兜底，绝不让 Prompt 超过预算。
  if (packed.chars > budget) {
    limits.stepLimit = 3;
    limits.evidenceLimit = 3;
    limits.evidenceCap = 9;
    limits.matrixCells = 6;
    limits.matrixHoles = 3;
    limits.compact = true;
    truncated.push('紧凑模式：L1 步骤 3、L2 代表 3、字段短截断');
    packed = renderPayload(params, limits);
  }

  return { ...packed, truncated };
}

function renderPayload(
  params: PackAnalysisInputParams,
  limits: PackLimits
): Omit<PackedAnalysisInput, 'truncated'> {
  const memberMap = new Map(params.members.map((member) => [member.articleId, member]));
  const rowsByThread = new Map<number, ThreadArticlesSelection[]>();
  for (const row of params.threadArticles) {
    const bucket = rowsByThread.get(row.thread_id);
    if (bucket) bucket.push(row);
    else rowsByThread.set(row.thread_id, [row]);
  }

  const evidence = new Map<number, EvidencePack>();
  const perAngleEvidence = Math.min(
    limits.evidenceLimit,
    Math.max(4, Math.floor(limits.evidenceCap / Math.max(params.threads.length, 1)))
  );
  const angles = params.threads.map((thread) => {
    const rows = [...(rowsByThread.get(thread.id) ?? [])].sort((a, b) => a.seq - b.seq);
    const selected = selectSteps(rows, limits.stepLimit, perAngleEvidence, thread.pattern_type);
    for (const row of selected.evidenceRows) {
      if (evidence.size >= limits.evidenceCap) break;
      if (evidence.has(row.article_id)) continue;
      const member = memberMap.get(row.article_id);
      if (!member) continue;
      evidence.set(row.article_id, toEvidencePack(member, params.briefs.get(row.article_id)));
    }

    const continuePairs = rows.filter((row) => row.relation === 'continue').length;
    return {
      angle_key: thread.angle_key,
      label: thread.angle_label,
      pattern_type: thread.pattern_type,
      member_count: thread.article_count,
      period_start: thread.period_start,
      period_end: thread.period_end,
      trend: thread.trend,
      continuity: rows.length > 1 ? Number((continuePairs / (rows.length - 1)).toFixed(2)) : null,
      representative_ids: rows.filter((row) => row.is_representative === 1).map((row) => row.article_id),
      steps: selected.stepRows.map((row) => {
        const member = memberMap.get(row.article_id);
        return {
          article_id: row.article_id,
          year: yearOf(member, params.briefs.get(row.article_id)),
          relation: row.relation,
          academic_role: row.academic_role,
          method: truncate(member?.facet.method ?? '', 30),
          study_object: truncate(member?.facet.study_object ?? '', 30),
          core_finding: truncate(member?.facet.core_finding ?? '', 40),
        };
      }),
    };
  });

  const threadsJson = JSON.stringify(
    {
      angles,
      // 只序列化核对与写作必需的最小证据；完整 EvidencePack 留在内存里做引文校验。
      evidence: [...evidence.values()]
        .sort((a, b) => a.articleId - b.articleId)
        .map((pack) => ({
          article_id: pack.articleId,
          core_finding: truncate(pack.coreFinding, limits.compact ? 60 : 90),
          limitation: pack.limitation
            ? truncate(pack.limitation, limits.compact ? 50 : 70)
            : null,
          quotes: pack.evidenceQuotes
            .slice(0, 1)
            .map((quote) => truncate(quote, limits.compact ? 60 : 80)),
        })),
      ...(params.paradigmDomains && params.paradigmDomains.length > 0
        ? {
            paradigms: params.paradigmDomains.map((domain) => ({
              domain_key: domain.domainKey,
              name: domain.name,
              methods: domain.methods,
              objects: domain.objects,
              article_count: domain.articleCount,
              representative_ids: domain.representativeIds,
            })),
          }
        : {}),
      ...(params.crossTopicGaps && params.crossTopicGaps.length > 0
        ? {
            cross_topic_gaps: params.crossTopicGaps.map((gap) => ({
              method: gap.method,
              object: gap.object,
              method_count: gap.methodCount,
              object_count: gap.objectCount,
              adjacent_topic_id: gap.adjacentTopicId,
              adjacent_topic_name: gap.adjacentTopicName,
              evidence_article_ids: gap.evidenceArticleIds,
            })),
          }
        : {}),
    },
    null,
    2
  );
  const matrixSummary = renderMatrixSummary(params.matrix, limits.matrixCells, limits.matrixHoles);
  const statsText = renderMetricsSummary(params.metrics, { maxMonths: limits.months });
  const changeContext = renderChangeContext(params, limits.newArticles);

  const chars =
    threadsJson.length + matrixSummary.length + statsText.length + changeContext.length;

  return {
    chars,
    threadsJson,
    matrixSummary,
    statsText,
    changeContext,
    evidenceByArticleId: evidence,
    anglePatterns: new Map(params.threads.map((thread) => [thread.angle_key, thread.pattern_type])),
  };
}

/**
 * 每角度步骤与代表的选择。
 *
 * - linear：按 seq 取前 N 篇，保持时间链；
 * - divergent：先保留代表作（必须进入证据包），再按 seq 填充。
 */
function selectSteps(
  rows: ThreadArticlesSelection[],
  stepLimit: number,
  evidenceLimit: number,
  patternType: 'linear' | 'divergent'
): { stepRows: ThreadArticlesSelection[]; evidenceRows: ThreadArticlesSelection[] } {
  if (rows.length === 0) return { stepRows: [], evidenceRows: [] };

  const representatives = rows.filter((row) => row.is_representative === 1);
  const stepRows =
    patternType === 'divergent'
      ? uniqueRows([...representatives, ...rows]).slice(0, stepLimit).sort((a, b) => a.seq - b.seq)
      : rows.slice(0, stepLimit);

  const evidenceRows =
    patternType === 'linear'
      ? rows.slice(0, evidenceLimit)
      : uniqueRows([
          ...representatives,
          ...rows.filter((row) => row.academic_role === 'satellite'),
          ...rows,
        ]).slice(0, evidenceLimit);

  return { stepRows, evidenceRows };
}

function uniqueRows(rows: ThreadArticlesSelection[]): ThreadArticlesSelection[] {
  const seen = new Set<number>();
  const out: ThreadArticlesSelection[] = [];
  for (const row of rows) {
    if (seen.has(row.article_id)) continue;
    seen.add(row.article_id);
    out.push(row);
  }
  return out;
}

function toEvidencePack(
  member: TopicMemberView,
  brief: { title: string; aiSummary: string | null; publishedYear: number | null } | undefined
): EvidencePack {
  return {
    articleId: member.articleId,
    title: truncate(brief?.title ?? '', 80),
    year: yearOf(member, brief),
    researchQuestion: truncate(member.facet.research_question, 120),
    method: truncate(member.facet.method, 60),
    studyObject: truncate(member.facet.study_object, 80),
    coreFinding: truncate(member.facet.core_finding, 120),
    limitation: member.facet.limitation ? truncate(member.facet.limitation, 120) : null,
    evidenceQuotes: (member.facet.evidence_quotes ?? []).slice(0, 3).map((quote) => truncate(quote, 160)),
    summaryExcerpt: truncate(brief?.aiSummary ?? '', 600),
  };
}

function renderChangeContext(params: PackAnalysisInputParams, limit: number): string {
  const lines: string[] = [];
  if (params.previousOverview) {
    lines.push(`【上次综述摘要】${truncate(params.previousOverview, 300)}`);
  }
  const newIds = params.newArticleIds ?? [];
  if (newIds.length > 0) {
    lines.push(`【本轮新增文献】共 ${newIds.length} 篇，列出前 ${Math.min(limit, newIds.length)} 篇：`);
    for (const id of newIds.slice(0, limit)) {
      const member = params.members.find((item) => item.articleId === id);
      if (!member) continue;
      lines.push(
        `- #${id} ${truncate(member.facet.research_question, 60)}（${member.facet.method} / ${member.facet.study_object}）`
      );
    }
  }
  return lines.join('\n');
}

function yearOf(
  member: TopicMemberView | undefined,
  brief: { publishedYear: number | null } | undefined
): number | null {
  if (brief?.publishedYear) return brief.publishedYear;
  const date = member?.eventDate;
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 供日志/测试使用的摘要文本 */
export function describePackedInput(packed: PackedAnalysisInput): string {
  return `input ${packed.chars} chars, evidence ${packed.evidenceByArticleId.size} 篇` +
    (packed.truncated.length > 0 ? `, trimmed: ${packed.truncated.join('；')}` : '');
}
