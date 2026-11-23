/**
 * 多维分析合成：把「规则已算好的结构」写成可读叙述（每个 dirty 主题两阶段 LLM）。
 *
 * 关键设计（设计文档 v2 §3）：
 *   - 输入是**已成链的排序结构 + 覆盖矩阵 + 周期指标**，不是一堆无序文章；
 *   - LLM 的职责是「命名与叙述」，不是「判断相关性」——判定早已由规则完成；
 *   - 所有引用必须落在输入给出的 article_id 白名单内，越界整条丢弃；
 *   - 阶段 A 产出 overview / synthesis / angles，阶段 B 产出范式、前沿、计量与空白；
 *     阶段 A 成功即落库为 partial，避免阶段 B 失败导致整轮白干。
 */

import { CLUSTER_CONFIG, CLUSTER_TASKS } from '../config.js';
import type { Trend } from '../domain/metrics.js';
import type { EvidencePack } from '../service/analysis-payload.js';
import type { CrossTopicGap } from '../service/gap-builder.js';
import type { ParadigmDomain } from '../service/paradigm.js';
import { runClusterJsonTask } from './client.js';
import { oneOf, optionalText, textArray } from './schema.js';

/**
 * 空白的依据类型。
 *
 * 每一种都**必须**在提示词输入里有对应的结构化信号，否则模型只能编：
 *   - matrix_hole      方法×对象覆盖矩阵的空格（已喂入）
 *   - cross_topic_gap  邻近主题间从未动用的组合（I3 接入后喂入）
 *   - staleness        周期指标中的时效缺口（已喂入）
 *   - limitation       文献自陈局限字段（已喂入）
 */
export type GapBasis = 'matrix_hole' | 'cross_topic_gap' | 'staleness' | 'limitation';

const GAP_BASES: readonly GapBasis[] = [
  'matrix_hole',
  'cross_topic_gap',
  'staleness',
  'limitation',
];
const TRENDS: readonly Trend[] = ['up', 'flat', 'down'];
const LIFECYCLE_STAGES = ['rising', 'plateau', 'cooling'] as const;

/** 单条空白最多 12 条（v2 契约），超过截断 */
const MAX_GAPS = 12;

export interface EvidenceText {
  text: string;
  basisArticleIds: number[];
  quotes: string[];
  /** 证据不足是合法输出，前端用灰色标签展示，不计入共识 */
  insufficient: boolean;
}

export interface AnalysisSynthesis {
  theoreticalBasis: EvidenceText | null;
  studyObjectsSummary: EvidenceText | null;
  methodologySummary: EvidenceText | null;
  consensus: EvidenceText[];
  controversies: EvidenceText[];
  historicalStages: EvidenceText | null;
}

export interface AnalysisAngle {
  angleKey: string;
  label: string;
  patternType: 'linear' | 'divergent';
  narrative: string;
  citedArticleIds: number[];
}

export interface AnalysisGap {
  gap: string;
  basis: GapBasis;
  evidenceArticleIds: number[];
  evidenceScope: 'topic' | 'adjacent';
  /** cross_topic_gap 专用：必须与规则候选一致 */
  method?: string;
  object?: string;
}

export interface ParadigmReview {
  domainKey: string;
  domainName: string;
  methods: string[];
  objects: string[];
  articleCount: number;
  focusProblems: EvidenceText | null;
  methodologicalPatterns: EvidenceText | null;
  consensusAndContrasts: EvidenceText | null;
  limitations: EvidenceText | null;
}

export interface FrontierInsights {
  narrative: EvidenceText | null;
}

export interface Bibliometrics {
  lifecycleStage: 'rising' | 'plateau' | 'cooling' | null;
  lifecycleInsight: string;
  driftInsight: string;
  methodEntropyInsight: string;
  objectEntropyInsight: string;
}

export interface AnalysisResult {
  overview: string;
  synthesis: AnalysisSynthesis;
  angles: AnalysisAngle[];
  /** 旧字段保留，供现有前端与列表卡读取 */
  trend: {
    summary: string;
    direction: Trend;
    evidenceArticleIds: number[];
  };
  gaps: AnalysisGap[];
  consensus: string[];
  controversies: string[];
  historySummary: string | null;
  paradigmReviews: ParadigmReview[];
  frontierInsights: FrontierInsights | null;
  bibliometrics: Bibliometrics | null;
  /** pending: 阶段 A 已落库，阶段 B 尚未成功 */
  phaseBStatus: 'pending' | 'ok' | 'failed';
}

export interface PhaseAResult {
  overview: string;
  synthesis: AnalysisSynthesis;
  angles: AnalysisAngle[];
  trend: AnalysisResult['trend'];
}

export interface PhaseBResult {
  paradigmReviews: ParadigmReview[];
  frontierInsights: FrontierInsights | null;
  bibliometrics: Bibliometrics | null;
  gaps: AnalysisGap[];
}

export interface AnalysisInputBase {
  userId: number;
  topicName: string;
  topicKeywords: string[];
  statsText: string;
  threadsJson: string;
  matrixSummary: string;
  /** L5：上次综述摘要 + 新增文献 */
  changeContext: string;
  allowedArticleIds: ReadonlySet<number>;
  evidenceByArticleId: ReadonlyMap<number, EvidencePack>;
  anglePatterns: ReadonlyMap<string, 'linear' | 'divergent'>;
}

export type SynthesisInput = AnalysisInputBase;

export interface ParadigmInput extends AnalysisInputBase {
  synthesis: AnalysisSynthesis;
  /** 规则层给出的跨主题空白候选；LLM 不得新增 */
  crossTopicGaps?: readonly CrossTopicGap[];
  /** 规则层给出的范式域；LLM 只能写这些域 */
  paradigmDomains?: readonly ParadigmDomain[];
}

export async function synthesizeSynthesis(input: SynthesisInput): Promise<PhaseAResult> {
  return runClusterJsonTask<PhaseAResult>({
    userId: input.userId,
    taskType: CLUSTER_TASKS.analysis,
    promptType: 'cluster_analysis_synthesis',
    label: 'cluster_analysis_phase_a',
    maxTokens: CLUSTER_CONFIG.analysisPhaseATokens,
    temperature: 0.3,
    variables: {
      TOPIC_NAME: input.topicName,
      TOPIC_KEYWORDS: input.topicKeywords.join('、'),
      TOPIC_STATS: input.statsText,
      THREADS_JSON: input.threadsJson,
      MATRIX_SUMMARY: input.matrixSummary,
      CHANGE_CONTEXT: input.changeContext,
    },
    validate: (raw) => parsePhaseA(raw, input),
  });
}

export async function synthesizeParadigms(input: ParadigmInput): Promise<PhaseBResult> {
  const synthesisSummary = [
    input.synthesis.theoreticalBasis?.text,
    input.synthesis.studyObjectsSummary?.text,
    input.synthesis.methodologySummary?.text,
  ]
    .filter((text): text is string => Boolean(text))
    .join('\n');

  return runClusterJsonTask<PhaseBResult>({
    userId: input.userId,
    taskType: CLUSTER_TASKS.analysis,
    promptType: 'cluster_analysis_paradigm',
    label: 'cluster_analysis_phase_b',
    maxTokens: CLUSTER_CONFIG.analysisPhaseBTokens,
    temperature: 0.3,
    variables: {
      TOPIC_NAME: input.topicName,
      TOPIC_KEYWORDS: input.topicKeywords.join('、'),
      TOPIC_STATS: input.statsText,
      THREADS_JSON: input.threadsJson,
      MATRIX_SUMMARY: input.matrixSummary,
      SYNTHESIS_SUMMARY: synthesisSummary,
    },
    validate: (raw) => parsePhaseB(raw, input),
  });
}

/* ── 阶段 A ── */

export function parsePhaseA(raw: Record<string, unknown>, input: SynthesisInput): PhaseAResult {
  const synthesis = parseSynthesis(raw.synthesis, input);
  const angles = parseAngles(raw.angles, input);
  const overview = optionalText(raw.overview) ?? composeOverview(synthesis);

  return {
    overview,
    synthesis,
    angles,
    trend: parseTrend(raw.trend, input.allowedArticleIds),
  };
}

function parseSynthesis(value: unknown, input: SynthesisInput): AnalysisSynthesis {
  const record = asRecord(value);
  return {
    theoreticalBasis: parseEvidenceText(record.theoretical_basis, input, 'theoretical_basis'),
    studyObjectsSummary: parseEvidenceText(
      record.study_objects_summary,
      input,
      'study_objects_summary'
    ),
    methodologySummary: parseEvidenceText(record.methodology_summary, input, 'methodology_summary'),
    consensus: parseEvidenceList(record.consensus, input, 5),
    controversies: parseEvidenceList(record.controversies, input, 5),
    historicalStages: parseEvidenceText(record.historical_stages, input, 'historical_stages'),
  };
}

function parseAngles(value: unknown, input: SynthesisInput): AnalysisAngle[] {
  if (!Array.isArray(value)) return [];
  const out: AnalysisAngle[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const angleKey = typeof record.angle_key === 'string' ? record.angle_key : '';
    const expectedPattern = input.anglePatterns.get(angleKey);
    // angle_key 必须是输入里真实存在的角度，pattern_type 不允许 LLM 改写结构
    if (!expectedPattern || seen.has(angleKey)) continue;
    if (record.pattern_type !== expectedPattern) continue;

    const label = optionalText(record.label);
    const narrative = optionalText(record.narrative);
    if (!label || !narrative) continue;

    seen.add(angleKey);
    out.push({
      angleKey,
      label: truncate(label, 40),
      patternType: expectedPattern,
      narrative: truncate(narrative, 400),
      citedArticleIds: filterIds(record.cited_article_ids, input.allowedArticleIds),
    });
  }
  return out;
}

/* ── 阶段 B ── */

export function parsePhaseB(raw: Record<string, unknown>, input: ParadigmInput): PhaseBResult {
  return {
    paradigmReviews: parseParadigms(raw.paradigm_reviews, input),
    frontierInsights: parseFrontier(raw.frontier_insights, input),
    bibliometrics: parseBibliometrics(raw.bibliometrics),
    gaps: parseGaps(raw.gaps, input),
  };
}

function parseParadigms(value: unknown, input: ParadigmInput): ParadigmReview[] {
  if (!Array.isArray(value)) return [];
  const out: ParadigmReview[] = [];
  const allowedDomains = new Set((input.paradigmDomains ?? []).map((domain) => domain.domainKey));
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const domainName = optionalText(record.domain_name);
    const domainKey = typeof record.domain_key === 'string' ? record.domain_key : '';
    if (!domainName || !domainKey) continue;
    // 有规则域时必须原样引用；不允许 LLM 自行新增或重复
    if (allowedDomains.size > 0 && (!allowedDomains.has(domainKey) || seen.has(domainKey))) continue;

    seen.add(domainKey);
    out.push({
      domainKey,
      domainName: truncate(domainName, 40),
      methods: textArray(record.methods, 6).map((method) => truncate(method, 40)),
      objects: textArray(record.objects, 6).map((object) => truncate(object, 40)),
      articleCount: toCount(record.article_count),
      focusProblems: parseEvidenceText(record.focus_problems, input, 'focus_problems'),
      methodologicalPatterns: parseEvidenceText(
        record.methodological_patterns,
        input,
        'methodological_patterns'
      ),
      consensusAndContrasts: parseEvidenceText(
        record.consensus_and_contrasts,
        input,
        'consensus_and_contrasts'
      ),
      limitations: parseEvidenceText(record.limitations, input, 'limitations'),
    });
    if (out.length >= 5) break;
  }
  return out;
}

function parseFrontier(value: unknown, input: ParadigmInput): FrontierInsights | null {
  const record = asRecord(value);
  const narrative = parseEvidenceText(record.narrative, input, 'frontier_narrative');
  return narrative ? { narrative } : null;
}

function parseBibliometrics(value: unknown): Bibliometrics | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const lifecycleStage =
    typeof record.lifecycle_stage === 'string' &&
    (LIFECYCLE_STAGES as readonly string[]).includes(record.lifecycle_stage)
      ? (record.lifecycle_stage as Bibliometrics['lifecycleStage'])
      : null;

  return {
    lifecycleStage,
    lifecycleInsight: truncate(optionalText(record.lifecycle_insight) ?? '', 240),
    driftInsight: truncate(optionalText(record.drift_insight) ?? '', 240),
    methodEntropyInsight: truncate(optionalText(record.method_entropy_insight) ?? '', 240),
    objectEntropyInsight: truncate(optionalText(record.object_entropy_insight) ?? '', 240),
  };
}

function parseGaps(value: unknown, input: ParadigmInput): AnalysisGap[] {
  if (!Array.isArray(value)) return [];
  const out: AnalysisGap[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const gap = optionalText(record.gap);
    if (!gap) continue;

    const ids = filterIds(record.evidence_article_ids, input.allowedArticleIds);
    // 空白必须可回链；无有效引用的空白直接丢弃，避免退化成「AI 空话」
    if (ids.length === 0) continue;

    const basis = oneOf(record.basis, GAP_BASES, 'limitation');
    const evidenceScope = record.evidence_scope === 'adjacent' ? 'adjacent' : 'topic';
    const method = optionalText(record.method) ?? undefined;
    const object = optionalText(record.object) ?? undefined;

    // 跨主题空白只能引用规则层候选，且必须标 adjacent；否则 LLM 会自由发挥。
    if (basis === 'cross_topic_gap') {
      if (evidenceScope !== 'adjacent' || !method || !object) continue;
      const candidate = input.crossTopicGaps?.find(
        (item) => item.method === method && item.object === object
      );
      if (!candidate) continue;
      const allowedEvidence = new Set(candidate.evidenceArticleIds);
      if (!ids.every((id) => allowedEvidence.has(id))) continue;
    }

    out.push({
      gap: truncate(gap, 160),
      basis,
      evidenceArticleIds: ids,
      evidenceScope,
      ...(method && object ? { method, object } : {}),
    });
    if (out.length >= MAX_GAPS) break;
  }
  return out;
}

/* ── 证据校验 ── */

function parseEvidenceList(
  value: unknown,
  input: SynthesisInput,
  maxItems: number
): EvidenceText[] {
  if (!Array.isArray(value)) return [];
  const out: EvidenceText[] = [];
  for (const item of value) {
    const parsed = parseEvidenceText(item, input, 'evidence_item');
    if (parsed) out.push(parsed);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 解析一条带证据的论述。
 *
 * 规则：
 *   - basis_article_ids 必须 ⊆ 白名单；非法整条丢弃；
 *   - quotes 必须能在对应文献的切面原句或 ai_summary 中找到（忽略标点/空白）；
 *   - 无引用时只接受 `证据不足：…` 且 ≤80 字，避免把空话当结论。
 */
function parseEvidenceText(
  value: unknown,
  input: SynthesisInput,
  field: string
): EvidenceText | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const text = optionalText(record.text);
  if (!text) return null;

  const basisArticleIds = filterIds(record.basis_article_ids, input.allowedArticleIds);
  const insufficientText = text.startsWith('证据不足：') && text.length <= 80;

  if (basisArticleIds.length === 0) {
    if (!insufficientText) return null;
    return { text: truncate(text, 160), basisArticleIds: [], quotes: [], insufficient: true };
  }

  const quotes = supportedQuotes(record.quotes, basisArticleIds, input.evidenceByArticleId);
  return {
    text: truncate(text, 600),
    basisArticleIds,
    quotes,
    insufficient: false,
  };
}

function supportedQuotes(
  value: unknown,
  basisIds: number[],
  evidence: ReadonlyMap<number, EvidencePack>
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const quote = item.trim();
    if (quote.length < 4) continue;
    const normalizedQuote = normalizeEvidence(quote);
    if (normalizedQuote.length < 4) continue;

    const supported = basisIds.some((id) => {
      const pack = evidence.get(id);
      if (!pack) return false;
      return [...pack.evidenceQuotes, pack.summaryExcerpt].some((source) =>
        normalizeEvidence(source).includes(normalizedQuote)
      );
    });
    if (supported && !out.includes(quote)) out.push(truncate(quote, 160));
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeEvidence(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s，,。.；;：:、！!？?（）()【】\[\]「」“”"'—-]/g, '');
}

/* ── 合并与空骨架 ── */

export function mergeAnalysisResult(
  phaseA: PhaseAResult,
  phaseB: PhaseBResult | null,
  phaseBStatus: AnalysisResult['phaseBStatus']
): AnalysisResult {
  return {
    overview: phaseA.overview,
    synthesis: phaseA.synthesis,
    angles: phaseA.angles,
    trend: phaseA.trend,
    gaps: phaseB?.gaps ?? [],
    consensus: phaseA.synthesis.consensus.map((item) => item.text),
    controversies: phaseA.synthesis.controversies.map((item) => item.text),
    historySummary: phaseA.synthesis.historicalStages?.text ?? null,
    paradigmReviews: phaseB?.paradigmReviews ?? [],
    frontierInsights: phaseB?.frontierInsights ?? null,
    bibliometrics: phaseB?.bibliometrics ?? null,
    phaseBStatus,
  };
}

export function emptySynthesis(): AnalysisSynthesis {
  return {
    theoreticalBasis: null,
    studyObjectsSummary: null,
    methodologySummary: null,
    consensus: [],
    controversies: [],
    historicalStages: null,
  };
}

export function emptyAnalysisResult(): AnalysisResult {
  return mergeAnalysisResult(
    {
      overview: '',
      synthesis: emptySynthesis(),
      angles: [],
      trend: { summary: '', direction: 'flat', evidenceArticleIds: [] },
    },
    null,
    'pending'
  );
}

function composeOverview(synthesis: AnalysisSynthesis): string {
  return truncate(
    [synthesis.theoreticalBasis?.text, synthesis.historicalStages?.text]
      .filter((text): text is string => Boolean(text))
      .join(' '),
    600
  );
}

/* ── 工具 ── */

function parseTrend(
  value: unknown,
  allowed: ReadonlySet<number>
): AnalysisResult['trend'] {
  const record = asRecord(value);
  return {
    summary: truncate(optionalText(record.summary) ?? '', 400),
    direction: oneOf(record.direction, TRENDS, 'flat'),
    evidenceArticleIds: filterIds(record.evidence_article_ids, allowed),
  };
}

function filterIds(value: unknown, allowed: ReadonlySet<number>): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const id = typeof item === 'number' ? item : Number(item);
    if (!Number.isFinite(id)) continue;
    if (allowed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toCount(value: unknown): number {
  const count = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}
