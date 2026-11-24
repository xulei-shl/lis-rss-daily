/**
 * 跨主题洞察编排。
 *
 * 每次运行都会重新做二次聚类（纯代码、数百节点秒级），但只对「成员内容哈希变化」
 * 的元簇调用 LLM。元簇成员发生变化时按 Jaccard 续写同一行，旧报告置为 superseded。
 */

import { createHash } from 'node:crypto';
import { logger } from '../../logger.js';
import type { ClusterInsightReportsSelection } from '../../db.js';
import { CLUSTER_CONFIG, CLUSTER_LIMITS } from '../config.js';
import { vectorToBlob } from '../domain/vector.js';
import { synthesizeInsightReport, type InsightReport } from '../llm/insight.js';
import { listActiveGapsBySet } from '../repo/gaps.js';
import {
  getInsightReportByKey,
  insertInsightReport,
  listActiveInsightReports,
  supersedeInsightReport,
  updateInsightReport,
  type InsightMemberRef,
} from '../repo/insights.js';
import { listActiveReviewsBySet } from '../repo/reviews.js';
import { listTopicsByVersion } from '../repo/topics.js';
import { buildInsightClusters, refKey, type InsightCluster } from './insight-builder.js';

const log = logger.child({ module: 'topic-cluster/insight-runner' });

export interface InsightRunResult {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  clusters: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ clusterKey: string; error: string }>;
}

export interface RunInsightOptions {
  limit?: number;
  force?: boolean;
}

export async function runInsightReports(
  setVersion: number,
  options: RunInsightOptions = {}
): Promise<InsightRunResult> {
  const [reviews, gaps, topics, existing] = await Promise.all([
    listActiveReviewsBySet(setVersion),
    listActiveGapsBySet(setVersion),
    listTopicsByVersion(setVersion),
    listActiveInsightReports(setVersion),
  ]);

  const clusters = buildInsightClusters({ reviews, gaps, topics });
  if (clusters.length === 0) {
    for (const report of existing) await supersedeInsightReport(report.id, null);
    return { status: 'skipped', clusters: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  }

  const userId = topics[0]?.user_id ?? CLUSTER_CONFIG.userId;
  const usedExisting = new Set<number>();
  const matches = clusters.map((cluster) => {
    const match = matchExisting(cluster, existing, usedExisting);
    if (match) usedExisting.add(match.id);
    return { cluster, match };
  });

  // 没有任何新元簇对应的旧报告：成员已经散开，保留历史但标记替代。
  for (const report of existing) {
    if (!usedExisting.has(report.id)) await supersedeInsightReport(report.id, null);
  }

  const limit = Math.min(
    Math.max(options.limit ?? CLUSTER_LIMITS.insightMaxReports, 1),
    CLUSTER_LIMITS.insightMaxReports
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: InsightRunResult['errors'] = [];
  let attempted = 0;

  for (const { cluster, match } of matches) {
    if (attempted >= limit) {
      skipped += 1;
      continue;
    }

    const inputHash = computeReportHash(cluster, reviews, gaps);
    if (match && !options.force && match.input_hash === inputHash && match.status === 'ok') {
      skipped += 1;
      continue;
    }

    attempted += 1;
    const previous = match ? parsePreviousReport(match) : null;
    const previousRefs = match ? parseRefs(match.member_refs_json) : [];
    const previousKeys = new Set(previousRefs.map(refKey));
    const newRefKeys = cluster.refs
      .map(refKey)
      .filter((key) => !previousKeys.has(key));

    try {
      const report = await synthesizeInsightReport({
        userId,
        scope: cluster.scope,
        reviews: cluster.reviews,
        gaps: cluster.gaps,
        previousReport: previous,
        newRefKeys,
      });

      const row = {
        userId,
        setVersion,
        title: report.title,
        reportJson: JSON.stringify(report),
        memberRefs: cluster.refs,
        topicIds: cluster.topicIds,
        centroid: vectorToBlob(cluster.centroid),
        centroidDim: cluster.centroid.length,
        inputHash,
        status: 'ok' as const,
        supersedesId: match?.supersedes_id ?? null,
      };

      if (match) {
        await updateInsightReport(match.id, { ...row, version: match.version + 1 });
        updated += 1;
      } else {
        const duplicate = await getInsightReportByKey(setVersion, cluster.key);
        if (duplicate) {
          await updateInsightReport(duplicate.id, {
            ...row,
            supersedesId: null,
            version: duplicate.version + 1,
          });
          updated += 1;
        } else {
          await insertInsightReport({ ...row, reportKey: cluster.key });
          created += 1;
        }
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ clusterKey: cluster.key, error: message });
      log.warn({ setVersion, cluster: cluster.key, error: message }, '跨主题洞察生成失败');
    }
  }

  return {
    status: failed === 0 ? 'ok' : failed === attempted ? 'failed' : 'partial',
    clusters: clusters.length,
    created,
    updated,
    skipped,
    failed,
    errors,
  };
}

function matchExisting(
  cluster: InsightCluster,
  existing: ClusterInsightReportsSelection[],
  used: ReadonlySet<number>
): ClusterInsightReportsSelection | null {
  const clusterKeys = new Set(cluster.refs.map(refKey));
  let best: ClusterInsightReportsSelection | null = null;
  let bestScore = 0;

  for (const report of existing) {
    if (used.has(report.id)) continue;
    const reportKeys = parseRefs(report.member_refs_json).map(refKey);
    const score = jaccardStrings([...clusterKeys], reportKeys);
    if (score > bestScore) {
      bestScore = score;
      best = report;
    }
  }

  return best && bestScore >= 0.5 ? best : null;
}

function computeReportHash(
  cluster: InsightCluster,
  reviews: Awaited<ReturnType<typeof listActiveReviewsBySet>>,
  gaps: Awaited<ReturnType<typeof listActiveGapsBySet>>
): string {
  const reviewHash = new Map(reviews.map((review) => [review.id, review.input_hash]));
  const gapHash = new Map(gaps.map((gap) => [gap.id, `${gap.gap}|${gap.source_analysis_hash}`]));
  const parts = cluster.refs
    .map((ref) =>
      ref.kind === 'review'
        ? `${refKey(ref)}=${reviewHash.get(ref.id) ?? ''}`
        : `${refKey(ref)}=${gapHash.get(ref.id) ?? ''}`
    )
    .sort();

  return createHash('sha256').update(`insight:v1|${parts.join('|')}`).digest('hex');
}

function parsePreviousReport(
  report: ClusterInsightReportsSelection
): { title: string; thesis: string } | null {
  try {
    const parsed = JSON.parse(report.report_json) as Partial<InsightReport>;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : report.title,
      thesis: typeof parsed.thesis === 'string' ? parsed.thesis : '',
    };
  } catch {
    return { title: report.title, thesis: '' };
  }
}

function parseRefs(raw: string | null | undefined): InsightMemberRef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is InsightMemberRef =>
          Boolean(item) &&
          (item.kind === 'review' || item.kind === 'gap') &&
          Number.isFinite(Number(item.id)) &&
          Number.isFinite(Number(item.topicId))
      )
      .map((item) => ({ kind: item.kind, id: Number(item.id), topicId: Number(item.topicId) }));
  } catch {
    return [];
  }
}

function jaccardStrings(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
