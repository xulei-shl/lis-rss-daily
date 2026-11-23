/**
 * 主题聚类离线校准（只读，不落库）。
 *
 * 输出 continuity 分布、不同 chainThreshold 下的 linear 占比、角度成员-质心
 * 相似度分位、卫星/前沿数量，并写入 docs/项目文档/cluster-calibration-YYYYMMDD.md。
 *
 * 运行：pnpm run cluster:calibrate
 */

import fs from 'node:fs';
import path from 'node:path';

import { sql } from 'kysely';

import { closeDb, getDb } from '../src/db.js';
import { CLUSTER_CONFIG } from '../src/topic-cluster/config.js';
import { centroidOf, cosine } from '../src/topic-cluster/domain/vector.js';
import { getActiveSet } from '../src/topic-cluster/repo/sets.js';
import { listTopicsByVersion } from '../src/topic-cluster/repo/topics.js';
import { getArticleAngleMap } from '../src/topic-cluster/repo/threads.js';
import { loadTopicMembers } from '../src/topic-cluster/service/member-view.js';

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main(): Promise<void> {
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (!active) {
    console.log('当前没有 active 主题集合版本，请先执行 pnpm run cluster:init。');
    return;
  }

  const db = getDb();
  const topics = await listTopicsByVersion(active.version);
  const threadRows = await db
    .selectFrom('topic_threads as th')
    .innerJoin('cluster_topics as t', 't.id', 'th.topic_id')
    .where('t.set_version', '=', active.version)
    .select(['th.id as id', 'th.topic_id as topic_id'])
    .execute();
  const threadIds = threadRows.map((row) => row.id);

  const columnRows = await sql<{ name: string }>`PRAGMA table_info(thread_articles)`.execute(db);
  const hasAcademicRole = columnRows.rows.some((row) => row.name === 'academic_role');

  const stepRows = threadIds.length
    ? await db
        .selectFrom('thread_articles')
        .where('thread_id', 'in', threadIds)
        .select(['thread_id', 'relation', ...(hasAcademicRole ? (['academic_role'] as const) : [])])
        .execute()
    : [];

  const byThread = new Map<number, typeof stepRows>();
  for (const row of stepRows) {
    const list = byThread.get(row.thread_id);
    if (list) list.push(row);
    else byThread.set(row.thread_id, [row]);
  }

  const continuity: number[] = [];
  for (const thread of threadRows) {
    const steps = byThread.get(thread.id) ?? [];
    const pairs = Math.max(steps.length - 1, 0);
    if (pairs === 0) continue;
    const continued = steps.filter((step) => step.relation === 'continue').length;
    continuity.push(continued / pairs);
  }

  const linearShares = [0.72, 0.75, 0.78].map((threshold) => {
    const total = Math.max(continuity.length, 1);
    const linear = continuity.filter((value) => value >= threshold).length;
    return { threshold, share: linear / total, count: linear };
  });

  // 角度成员-质心相似度：只统计成员数 ≥2 的角度。
  const angleSimilarities: number[] = [];
  for (const topic of topics) {
    const { members } = await loadTopicMembers(topic.id);
    const angleMap = await getArticleAngleMap(topic.id);
    const groups = new Map<string, typeof members>();
    for (const member of members) {
      const angle = angleMap.get(member.articleId);
      if (!angle) continue;
      const group = groups.get(angle);
      if (group) group.push(member);
      else groups.set(angle, [member]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const centroid = centroidOf(group.map((member) => member.vector));
      for (const member of group) {
        angleSimilarities.push(cosine(member.vector, centroid));
      }
    }
  }

  const roles = new Map<string, number>();
  for (const step of stepRows) {
    if (hasAcademicRole && step.academic_role) {
      roles.set(step.academic_role, (roles.get(step.academic_role) ?? 0) + 1);
    }
  }

  const p20 = percentile(angleSimilarities, 20);
  const p30 = percentile(angleSimilarities, 30);
  const continuityMedian = median(continuity);
  const satellite = roles.get('satellite') ?? 0;
  const frontier = roles.get('frontier') ?? 0;
  const linked = stepRows.length;

  const lines = [
    `# 主题聚类校准报告（${new Date().toISOString().slice(0, 10)}）`,
    '',
    `- 集合版本：v${active.version}`,
    `- 主题数：${topics.length}`,
    `- 角度数：${threadRows.length}`,
    `- 脉络成员：${linked}`,
    '',
    '## continuity 分布',
    '',
    `- 样本数：${continuity.length}`,
    `- 中位数：${continuityMedian === null ? '—' : continuityMedian.toFixed(3)}`,
    `- P20 / P30：${percentile(continuity, 20)?.toFixed(3) ?? '—'} / ${percentile(continuity, 30)?.toFixed(3) ?? '—'}`,
    '',
    '## chainThreshold 下的 linear 占比（按 continue 边比例近似）',
    '',
    '| chainThreshold | linear 角度 | 占比 |',
    '|---|---|---|',
    ...linearShares.map(
      (item) =>
        `| ${item.threshold.toFixed(2)} | ${item.count} | ${(item.share * 100).toFixed(1)}% |`
    ),
    '',
    '## 角度成员-质心相似度',
    '',
    `- 样本数：${angleSimilarities.length}`,
    `- P20：${p20 === null ? '—' : p20.toFixed(3)}`,
    `- P30：${p30 === null ? '—' : p30.toFixed(3)}`,
    '',
    '## 角色分布',
    '',
    '| 角色 | 数量 | 占比 |',
    '|---|---|---|',
    ...[...roles.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([role, count]) =>
          `| ${role} | ${count} | ${linked > 0 ? ((count / linked) * 100).toFixed(1) : '0.0'}% |`
      ),
    '',
    (hasAcademicRole
      ? `卫星比例：${linked > 0 ? ((satellite / linked) * 100).toFixed(1) : '0.0'}%；` +
        `前沿比例：${linked > 0 ? ((frontier / linked) * 100).toFixed(1) : '0.0'}%`
      : '当前库尚未应用迁移 047，academic_role 不存在，卫星/前沿统计跳过。'),
    '',
    '> continuity 为 `continue` 边占相邻对的比例；阈值占比用于近似 chainThreshold 敏感度。',
  ];

  const output = path.join(
    process.cwd(),
    'docs/项目文档',
    `cluster-calibration-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.md`
  );
  fs.writeFileSync(output, lines.join('\n'), 'utf8');

  console.log(lines.join('\n'));
  console.log(`\n已写入 ${output}`);
}

main()
  .catch((error) => {
    console.error('❌ 校准失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
