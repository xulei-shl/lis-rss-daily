/**
 * 脉络仓储（topic_threads + thread_articles）。
 *
 * 写入策略：按主题**整体替换**（先删后插），保证重跑幂等，
 * 也顺带解决「文章被移出主题后 thread_articles 留下幽灵节点」的问题。
 */

import { getDb, type ThreadArticlesSelection, type TopicThreadsSelection } from '../../db.js';
import type { Relation } from '../domain/chaining.js';
import type { Trend } from '../domain/metrics.js';

export interface ThreadStepRow {
  articleId: number;
  seq: number;
  relation: Relation;
  similarityToPrev: number | null;
  sharedMethod: boolean;
  sharedObject: boolean;
}

export interface ThreadWriteRow {
  angleKey: string;
  angleLabel: string | null;
  steps: ThreadStepRow[];
  periodStart: string | null;
  periodEnd: string | null;
  trend: Trend | null;
  summary: string | null;
}

/** 整体替换某主题的脉络 */
export async function replaceTopicThreads(
  topicId: number,
  rows: ThreadWriteRow[]
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('topic_threads').where('topic_id', '=', topicId).execute();

    for (const row of rows) {
      const inserted = await trx
        .insertInto('topic_threads')
        .values({
          topic_id: topicId,
          angle_key: row.angleKey,
          angle_label: row.angleLabel,
          article_count: row.steps.length,
          period_start: row.periodStart,
          period_end: row.periodEnd,
          status: 'ACTIVE',
          trend: row.trend,
          summary: row.summary,
          updated_at: now,
        })
        .executeTakeFirst();

      const threadId = Number(inserted.insertId);
      if (threadId && row.steps.length > 0) {
        await trx
          .insertInto('thread_articles')
          .values(
            row.steps.map((step) => ({
              thread_id: threadId,
              article_id: step.articleId,
              seq: step.seq,
              relation: step.relation,
              similarity_to_prev: step.similarityToPrev,
              shared_method: step.sharedMethod ? 1 : 0,
              shared_object: step.sharedObject ? 1 : 0,
            }))
          )
          .execute();
      }
    }
  });
}

export async function listThreads(topicId: number): Promise<TopicThreadsSelection[]> {
  return getDb()
    .selectFrom('topic_threads')
    .selectAll()
    .where('topic_id', '=', topicId)
    .orderBy('article_count', 'desc')
    .execute();
}

export async function listThreadArticles(topicId: number): Promise<ThreadArticlesSelection[]> {
  return getDb()
    .selectFrom('thread_articles as ta')
    .innerJoin('topic_threads as t', 't.id', 'ta.thread_id')
    .selectAll('ta')
    .where('t.topic_id', '=', topicId)
    .orderBy('ta.thread_id', 'asc')
    .orderBy('ta.seq', 'asc')
    .execute();
}

/** 文章 → 角度键 映射（周期指标的「活跃角度数」需要） */
export async function getArticleAngleMap(topicId: number): Promise<Map<number, string>> {
  const rows = await getDb()
    .selectFrom('thread_articles as ta')
    .innerJoin('topic_threads as t', 't.id', 'ta.thread_id')
    .select(['ta.article_id as article_id', 't.angle_key as angle_key'])
    .where('t.topic_id', '=', topicId)
    .execute();

  const map = new Map<number, string>();
  for (const row of rows) map.set(row.article_id, row.angle_key);
  return map;
}

/** 仅更新 LLM 产出的叙述与角度名（规则部分不变时避免整体重写） */
export async function updateThreadNarrative(
  threadId: number,
  angleLabel: string | null,
  summary: string | null
): Promise<void> {
  await getDb()
    .updateTable('topic_threads')
    .set({ angle_label: angleLabel, summary, updated_at: new Date().toISOString() })
    .where('id', '=', threadId)
    .execute();
}
