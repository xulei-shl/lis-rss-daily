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
import { vectorToBlob } from '../domain/vector.js';
import { synthesizeDeepReview } from '../llm/review.js';
import { getTopicById, clearReviewDirty } from '../repo/topics.js';
import {
  getReviewByKey,
  insertReview,
  listActiveReviewsByTopic,
  supersedeReview,
  updateReview,
} from '../repo/reviews.js';
import type { ClusterTopicReviewsSelection } from '../../db.js';
import { getArticleBriefs } from '../source.js';
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
    // 主题缩小到不足以综述：旧综述不再代表当前成员，保留历史但置为 superseded。
    for (const review of existing) await supersedeReview(review.id, null);
    await clearReviewDirty(topicId, new Date().toISOString());
    return {
      topicId,
      status: 'skipped',
      groups: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      error: null,
    };
  }

  const keywords = parseKeywords(topic.keywords);
  const matchedIds = new Set<number>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const group of groups) {
    const match = matchExisting(group, existing, matchedIds);
    if (match) matchedIds.add(match.id);

    const inputHash = computeReviewHash({
      topicId,
      topicName: topic.name,
      group,
    });

    if (match && !options.force && match.input_hash === inputHash && match.status === 'ok') {
      skipped += 1;
      continue;
    }

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
      const review = await synthesizeDeepReview({
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
        title: review.title,
        abstract: review.abstract,
        reviewJson: JSON.stringify(review),
        memberIds: group.memberIds,
        representativeIds: group.representativeIds,
        centroid: vectorToBlob(group.centroid),
        centroidDim: group.centroid.length,
        inputHash,
        linkedCount: group.memberIds.length,
        status: 'ok' as const,
        supersedesId: match?.supersedes_id ?? null,
      };

      if (match) {
        await updateReview(match.id, { ...row, version: match.version + 1 });
        updated += 1;
      } else {
        // 同一锚点的旧行可能已被 superseded：复活它，避免 UNIQUE(topic_id, review_key) 冲突。
        const duplicate = await getReviewByKey(topicId, group.key);
        if (duplicate) {
          await updateReview(duplicate.id, {
            ...row,
            supersedesId: null,
            version: duplicate.version + 1,
          });
          updated += 1;
        } else {
          await insertReview({ ...row, reviewKey: group.key });
          created += 1;
        }
      }
    } catch (error) {
      failed += 1;
      lastError = error instanceof Error ? error.message : String(error);
      log.warn(
        { topicId, group: group.key, error: lastError },
        '深度综述生成失败，保留旧内容并等待下一轮重试'
      );
    }
  }

  for (const review of existing) {
    if (matchedIds.has(review.id)) continue;
    await supersedeReview(review.id, null);
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
