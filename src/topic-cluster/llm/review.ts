/**
 * 深度综述合成（主题内每个语义子簇一次 LLM 调用）。
 *
 * 契约与多维分析同源：模型不判断相关性、不新增文献引用，所有论述必须回链到
 * 规则层给出的证据白名单。证据不足是合法输出。
 */

import { CLUSTER_CONFIG, CLUSTER_TASKS } from '../config.js';
import type { EvidencePack } from '../service/analysis-payload.js';
import { runClusterJsonTask } from './client.js';
import {
  parseEvidenceText,
  type EvidenceText,
  type EvidenceValidationInput,
} from './analysis.js';
import {
  ClusterSchemaError,
  filterAllowedIds,
  optionalText,
  requireText,
} from './schema.js';

export interface DeepReviewSections {
  researchQuestions: EvidenceText | null;
  theoreticalBasis: EvidenceText | null;
  methodsAndData: EvidenceText | null;
  findings: EvidenceText | null;
  debates: EvidenceText | null;
  limitations: EvidenceText | null;
  agenda: EvidenceText | null;
}

export interface DeepReview {
  title: string;
  abstract: string;
  sections: DeepReviewSections;
  citations: number[];
}

export interface DeepReviewInput extends EvidenceValidationInput {
  userId: number;
  topicName: string;
  topicKeywords: string[];
  groupStats: string;
  evidence: EvidencePack[];
  previousReview: { title: string; abstract: string } | null;
  newArticleIds: number[];
}

export async function synthesizeDeepReview(input: DeepReviewInput): Promise<DeepReview> {
  const evidenceJson = JSON.stringify(input.evidence, null, 2);
  const previous = input.previousReview
    ? `${input.previousReview.title}\n${input.previousReview.abstract}`
    : '无（首次生成）';
  const newIds = input.newArticleIds.length > 0 ? input.newArticleIds.join(', ') : '无';

  return runClusterJsonTask<DeepReview>({
    userId: input.userId,
    taskType: CLUSTER_TASKS.review,
    promptType: 'cluster_deep_review',
    label: 'cluster_deep_review',
    maxTokens: CLUSTER_CONFIG.reviewOutputTokens,
    temperature: 0.3,
    variables: {
      TOPIC_NAME: input.topicName,
      TOPIC_KEYWORDS: input.topicKeywords.join('、') || '未提供',
      GROUP_STATS: input.groupStats,
      EVIDENCE_JSON: evidenceJson,
      PREVIOUS_REVIEW: previous,
      NEW_ARTICLE_IDS: newIds,
    },
    validate: (raw) => parseDeepReview(raw, input),
  });
}

export function parseDeepReview(
  raw: Record<string, unknown>,
  input: EvidenceValidationInput
): DeepReview {
  const title = truncate(requireText(raw.title, 'title', 4), 60);
  const abstract = optionalText(raw.abstract) ?? '';
  const sectionsRaw =
    raw.sections && typeof raw.sections === 'object'
      ? (raw.sections as Record<string, unknown>)
      : {};

  const sections: DeepReviewSections = {
    researchQuestions: parseEvidenceText(sectionsRaw.research_questions, input, 'research_questions'),
    theoreticalBasis: parseEvidenceText(sectionsRaw.theoretical_basis, input, 'theoretical_basis'),
    methodsAndData: parseEvidenceText(sectionsRaw.methods_and_data, input, 'methods_and_data'),
    findings: parseEvidenceText(sectionsRaw.findings, input, 'findings'),
    debates: parseEvidenceText(sectionsRaw.debates, input, 'debates'),
    limitations: parseEvidenceText(sectionsRaw.limitations, input, 'limitations'),
    agenda: parseEvidenceText(sectionsRaw.agenda, input, 'agenda'),
  };

  const filled = Object.values(sections).filter((section) => section !== null);
  if (filled.length === 0) {
    throw new ClusterSchemaError('深度综述没有任何通过证据校验的小节');
  }

  const citations = filterAllowedIds(raw.citations, input.allowedArticleIds);

  return {
    title,
    abstract: truncate(abstract, 320),
    sections,
    citations: citations.length > 0
      ? citations
      : [...new Set(filled.flatMap((section) => section!.basisArticleIds))].slice(0, 20),
  };
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
