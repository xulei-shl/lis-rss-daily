/**
 * 深度综述编排（单个主题）。
 *
 * 增量纪律：
 *   - 成员集合未变且 input_hash 一致 → 跳过；
 *   - 成员只增/小幅变化（Jaccard ≥ 0.5）→ 续写同一行，把旧摘要与新增文献交给模型；
 *   - 明显变化 → 旧行 superseded，新建；
 *   - 失败不改写旧内容，保留 review_dirty 下轮重试。
 *
 * 调用频率由 review_dirty 决定，只有入链/回捞/整合后的主题才会重算。
 */

import { createHash } from 'node:crypto';
import { logger } from '../../logger.js';
import { CLUSTER_CONFIG } from '../config.js';
import { shortHash } from '../domain/hash.js';
import { centroidOf, vectorToBlob } from '../domain/vector.js';
import { synthesizeDeepReview, type DeepReview } from '../llm/review.js';
import { synthesizeSubtopicGaps } from '../llm/subtopic-gaps.js';
import { getTopicById, clearReviewDirty } from '../repo/topics.js';
import {
  listActiveSubtopicGaps,
  replaceSubtopicGaps,
  supersedeSubtopicGaps,
  type GapWriteRow,
} from '../repo/gaps.js';
import {
  getReviewByKey,
  insertReview,
  listActiveReviewsByTopic,
  supersedeReview,
  updateReview,
} from '../repo/reviews.js';
import type { ClusterTopicReviewsSelection } from '../../db.js';
import { getArticleBriefs } from '../source.js';
import { mapWithConcurrency } from '../util/pool.js';
import { loadTopicMembers } from './member-view.js';
import { buildReviewGroups, isSubset, jaccard, type ReviewGroup } from './review-builder.js';

const log = logger.child({ module: 'topic-cluster/review-runner' });

export interface TopicReviewRunResult {
  topicId: number;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  groups: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  gapsGenerated?: number;
  error: string | null;
}

export interface RunTopicReviewsOptions {
  force?: boolean;
}

export async function runTopicReviews(
  topicId: number,
  options: RunTopicReviewsOptions = {}
): Promise<TopicReviewRunResult> {
  const topic = await getTopicById(topicId);
  if (!topic) {
    return {
      topicId,
      status: 'failed',
      groups: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
      error: '主题不存在',
    };
  }

  const { members } = await loadTopicMembers(topicId);
  const briefs = await getArticleBriefs(members.map((member) => member.articleId));
  const groups = buildReviewGroups(members, briefs);
  const existing = await listActiveReviewsByTopic(topicId);

  if (groups.length === 0) {
    // 主题缩小到不足以综述：旧综述与子课题级空白不再代表当前成员，置为 superseded。
    for (const review of existing) await supersedeReview(review.id, null);
    await supersedeSubtopicGaps(topicId);
    await clearReviewDirty(topicId, new Date().toISOString());
    return {
      topicId,
      status: 'skipped',
      groups: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      gapsGenerated: 0,
      error: null,
    };
  }

  const keywords = parseKeywords(topic.keywords);
  const vectorById = new Map(members.map((member) => [member.articleId, member.vector]));
  const matchedIds = new Set<number>();
  const assignments = groups.map((group) => {
    const match = matchExisting(group, existing, matchedIds);
    if (match) matchedIds.add(match.id);
    return { group, match };
  });

  const obsoleteReviews = existing.filter((review) => !matchedIds.has(review.id));
  for (const review of obsoleteReviews) {
    await supersedeReview(review.id, null);
  }
  if (obsoleteReviews.length > 0) {
    await supersedeSubtopicGaps(
      topicId,
      obsoleteReviews.map((review) => review.review_key)
    );
  }

  const outcomes = await mapWithConcurrency(
    assignments,
    CLUSTER_CONFIG.llmConcurrency,
    async ({ group, match }) => {
      const reviewInputHash = computeReviewHash({
        topicId,
        topicName: topic.name,
        group,
      });
      const effectiveSubtopicKey = match
        ? match.review_key.replace(/^rv-/, '')
        : group.subtopicKey;
      const gapsInputHash = computeSubtopicGapHash({
        topicId,
        topicName: topic.name,
        subtopicKey: effectiveSubtopicKey,
        group,
      });

      let reviewAction: 'created' | 'updated' | 'skipped' = 'skipped';
      let deepReview: DeepReview | null =
        match && !options.force && match.input_hash === reviewInputHash && match.status === 'ok'
          ? parseStoredReview(match.review_json)
          : null;

      if (!deepReview) {
        const previous = match
          ? { title: match.title, abstract: match.abstract }
          : null;
        const previousMemberIds = match ? parseIdArray(match.member_ids_json) : [];
        const newArticleIds = match
          ? group.memberIds.filter((id) => !previousMemberIds.includes(id))
          : group.memberIds;

        const evidenceById = new Map(group.evidence.map((pack) => [pack.articleId, pack]));
        const allowedArticleIds = new Set(group.evidence.map((pack) => pack.articleId));

        try {
          deepReview = await synthesizeDeepReview({
            userId: topic.user_id,
            topicName: topic.name,
            topicKeywords: keywords,
            groupStats: group.statsText,
            evidence: group.evidence,
            previousReview: previous,
            newArticleIds,
            allowedArticleIds,
            evidenceByArticleId: evidenceById,
          });

          const row = {
            userId: topic.user_id,
            setVersion: topic.set_version,
            topicId,
            title: deepReview.title,
            abstract: deepReview.abstract,
            reviewJson: JSON.stringify(deepReview),
            memberIds: group.memberIds,
            representativeIds: group.representativeIds,
            centroid: vectorToBlob(group.centroid),
            centroidDim: group.centroid.length,
            inputHash: reviewInputHash,
            linkedCount: group.memberIds.length,
            status: 'ok' as const,
            supersedesId: match?.supersedes_id ?? null,
          };

          if (match) {
            await updateReview(match.id, { ...row, version: match.version + 1 });
            reviewAction = 'updated';
          } else {
            // 同一锚点的旧行可能已被 superseded：复活它，避免 UNIQUE(topic_id, review_key) 冲突。
            const duplicate = await getReviewByKey(topicId, group.key);
            if (duplicate) {
              await updateReview(duplicate.id, {
                ...row,
                supersedesId: null,
                version: duplicate.version + 1,
              });
              reviewAction = 'updated';
            } else {
              await insertReview({ ...row, reviewKey: group.key });
              reviewAction = 'created';
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(
            { topicId, group: group.key, error: message },
            '深度综述生成失败，保留旧内容并等待下一轮重试'
          );
          return { action: 'failed' as const, gapsGenerated: 0, error: message };
        }
      }

      // 第二步：对该子课题独立调用一次 LLM 生成结构化研究空白（复用子课题级缓存）
      const existingGaps = await listActiveSubtopicGaps(topicId, effectiveSubtopicKey);
      const gapsHit =
        !options.force &&
        existingGaps.length > 0 &&
        existingGaps.every((gap) => gap.source_analysis_hash === gapsInputHash);

      if (gapsHit) {
        return { action: reviewAction, gapsGenerated: 0, error: null };
      }

      try {
        const reviewContext = [
          `标题：${deepReview.title}`,
          deepReview.abstract ? `摘要：${deepReview.abstract}` : '',
          deepReview.sections.debates?.text ? `已有分歧：${deepReview.sections.debates.text}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        const gapItems = await synthesizeSubtopicGaps({
          userId: topic.user_id,
          topicName: topic.name,
          topicKeywords: keywords,
          subtopicStats: group.gapStatsText,
          reviewContext,
          members: group.gapMembers,
          allowedArticleIds: new Set(group.memberIds),
        });

        const gapRows: GapWriteRow[] = gapItems.map((item) => {
          const vectors = item.evidenceArticleIds
            .map((id) => vectorById.get(id))
            .filter((vector): vector is Float32Array => Boolean(vector));
          const embedding = vectors.length > 0 ? centroidOf(vectors) : group.centroid;
          return {
            userId: topic.user_id,
            setVersion: topic.set_version,
            topicId,
            gapKey: `sg-${shortHash(`${effectiveSubtopicKey}|${normalizeGap(item.gap)}`, 10)}`,
            subtopicKey: effectiveSubtopicKey,
            scope: 'subtopic',
            gap: item.gap,
            basis: item.basis,
            method: null,
            object: null,
            evidenceIds: item.evidenceArticleIds,
            embedding: embedding ? vectorToBlob(embedding) : null,
            embeddingDim: embedding ? embedding.length : null,
            sourceAnalysisHash: gapsInputHash,
          };
        });

        await replaceSubtopicGaps(topicId, effectiveSubtopicKey, gapRows);
        return { action: reviewAction, gapsGenerated: gapRows.length, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn(
          { topicId, group: group.key, subtopicKey: effectiveSubtopicKey, error: message },
          '子主题独立研究空白生成失败，保留旧空白并等待下一轮重试'
        );
        return { action: 'failed' as const, gapsGenerated: 0, error: message };
      }
    }
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let gapsGenerated = 0;
  let lastError: string | null = null;

  for (const outcome of outcomes) {
    gapsGenerated += outcome.gapsGenerated;
    if (outcome.action === 'created') created += 1;
    else if (outcome.action === 'updated') updated += 1;
    else if (outcome.action === 'skipped') skipped += 1;
    else {
      failed += 1;
      lastError = outcome.error;
    }
  }

  if (failed === 0) {
    await clearReviewDirty(topicId, new Date().toISOString());
  }

  return {
    topicId,
    status: failed === 0 ? 'ok' : failed === groups.length ? 'failed' : 'partial',
    groups: groups.length,
    created,
    updated,
    skipped,
    failed,
    gapsGenerated,
    error: lastError,
  };
}

function matchExisting(
  group: ReviewGroup,
  existing: ClusterTopicReviewsSelection[],
  used: ReadonlySet<number>
): ClusterTopicReviewsSelection | null {
  let best: ClusterTopicReviewsSelection | null = null;
  let bestScore = 0;

  for (const review of existing) {
    if (used.has(review.id)) continue;
    const memberIds = parseIdArray(review.member_ids_json);
    const score = jaccard(group.memberIds, memberIds);
    if (score > bestScore) {
      bestScore = score;
      best = review;
    }
  }

  if (!best || bestScore < 0.5) return null;

  // 只增成员时允许更低阈值续写；整体替换/分裂时要求更严格的 0.6。
  const existingIds = parseIdArray(best.member_ids_json);
  if (isSubset(existingIds, group.memberIds) && bestScore >= 0.5) return best;
  return bestScore >= 0.6 ? best : null;
}

function computeReviewHash(input: {
  topicId: number;
  topicName: string;
  group: ReviewGroup;
}): string {
  const hash = createHash('sha256');
  hash.update(
    `review:v1|topic:${input.topicId}|name:${input.topicName}|facet:${CLUSTER_CONFIG.facetContractVersion}`
  );
  hash.update(`|members:${input.group.memberIds.join(',')}`);
  hash.update(`|reps:${input.group.representativeIds.join(',')}`);
  hash.update(`|facets:${input.group.facetSignature}`);
  return hash.digest('hex');
}

function computeSubtopicGapHash(input: {
  topicId: number;
  topicName: string;
  subtopicKey: string;
  group: ReviewGroup;
}): string {
  const hash = createHash('sha256');
  hash.update(
    `subtopic-gaps:v1|topic:${input.topicId}|name:${input.topicName}|sub:${input.subtopicKey}|facet:${CLUSTER_CONFIG.facetContractVersion}`
  );
  hash.update(`|members:${input.group.memberIds.join(',')}`);
  hash.update(`|facets:${input.group.facetSignature}`);
  return hash.digest('hex');
}

function parseStoredReview(raw: string): DeepReview | null {
  try {
    const parsed = JSON.parse(raw) as DeepReview;
    return parsed && typeof parsed === 'object' && parsed.sections ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeGap(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}

function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [String(raw)];
  }
}

function parseIdArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => Number(item)).filter((id) => Number.isFinite(id))
      : [];
  } catch {
    return [];
  }
}

export { parseIdArray as parseReviewIdArray };
