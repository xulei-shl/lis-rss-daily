/**
 * 多归属链接仓储（article_topic_links）。
 *
 * ⚠️ 本文件是**归属的唯一写入点**（设计文档 §13.4.2）。
 * 路由 / 孵化 / 回捞三条路径都必须调用 `assignArticleToTopic()`，
 * 不得在别处直接操作 article_topic_links。这样未来增加人工干预时，
 * 只需在此函数内加一个条件即可覆盖全部路径。
 */

import { getDb, type ArticleTopicLinksSelection } from '../../db.js';
import { planLinks, type ExistingLink, type LinkPlan, type ScoredTopic } from '../domain/routing.js';

export type AssignMethod = 'init' | 'centroid' | 'incubation' | 'reclaim';

export interface AssignInput {
  articleId: number;
  setVersion: number;
  /** 本次打分得到的候选（需已按阈值筛过） */
  candidates: ScoredTopic[];
  assignMethod: AssignMethod;
  maxTopics: number;
}

export interface AssignResult {
  plan: LinkPlan;
  /** 受到影响的主题（新增链接的 + 被淘汰链接的），调用方据此刷新计数与脏标记 */
  affectedTopicIds: number[];
}

export async function getLinksForArticle(
  articleId: number,
  setVersion: number
): Promise<ArticleTopicLinksSelection[]> {
  return getDb()
    .selectFrom('article_topic_links')
    .selectAll()
    .where('article_id', '=', articleId)
    .where('set_version', '=', setVersion)
    .execute();
}

export async function listLinksByTopic(topicId: number): Promise<ArticleTopicLinksSelection[]> {
  return getDb()
    .selectFrom('article_topic_links')
    .selectAll()
    .where('topic_id', '=', topicId)
    .orderBy('link_rank', 'asc')
    .execute();
}

/** 这批文章是否已有归属链接（用于「重抽切面」前的安全检查） */
export async function countLinksForArticles(articleIds: number[]): Promise<number> {
  if (articleIds.length === 0) return 0;
  const row = await getDb()
    .selectFrom('article_topic_links')
    .select((eb) => eb.fn.count('article_id').as('count'))
    .where('article_id', 'in', articleIds)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/** 主题成员文章 id（按主归属优先、相似度降序） */
export async function getTopicMemberIds(topicId: number): Promise<number[]> {
  const rows = await getDb()
    .selectFrom('article_topic_links')
    .select('article_id')
    .where('topic_id', '=', topicId)
    .orderBy('is_primary', 'desc')
    .orderBy('similarity', 'desc')
    .execute();
  return rows.map((row) => row.article_id);
}

/** 主题下的主归属文章数（用于「样本是否足够」判定） */
export async function countTopicLinks(topicId: number): Promise<{ linked: number; primary: number }> {
  const rows = await getDb()
    .selectFrom('article_topic_links')
    .select(['is_primary', 'article_id'])
    .where('topic_id', '=', topicId)
    .execute();

  let primary = 0;
  for (const row of rows) if (row.is_primary === 1) primary += 1;
  return { linked: rows.length, primary };
}

/**
 * 归属唯一写入点。
 *
 * 语义：把该文章在 active 版本下的链接集合，收敛为 planLinks 计算出的结果。
 * 幂等：同一输入多次调用结果一致（rank / 主归属都会重排）。
 */
export async function assignArticleToTopic(input: AssignInput): Promise<AssignResult> {
  const db = getDb();
  const now = new Date().toISOString();

  const existingRows = await getLinksForArticle(input.articleId, input.setVersion);
  const existing: ExistingLink[] = existingRows.map((row) => ({
    topicId: row.topic_id,
    similarity: row.similarity,
  }));

  const plan = planLinks(existing, input.candidates, input.maxTopics);
  const affected = new Set<number>(plan.removals);
  for (const link of plan.links) affected.add(link.topicId);

  if (plan.links.length === 0 && plan.removals.length === 0) {
    return { plan, affectedTopicIds: [] };
  }

  await db.transaction().execute(async (trx) => {
    // 1) 先清空该文在本次版本下的主归属，避免 partial unique index 的瞬时冲突
    await trx
      .updateTable('article_topic_links')
      .set({ is_primary: 0 })
      .where('article_id', '=', input.articleId)
      .where('set_version', '=', input.setVersion)
      .execute();

    // 2) 删除被淘汰的链接
    if (plan.removals.length > 0) {
      await trx
        .deleteFrom('article_topic_links')
        .where('article_id', '=', input.articleId)
        .where('set_version', '=', input.setVersion)
        .where('topic_id', 'in', plan.removals)
        .execute();
    }

    // 3) 写入/更新保留的链接
    for (const link of plan.links) {
      await trx
        .insertInto('article_topic_links')
        .values({
          article_id: input.articleId,
          topic_id: link.topicId,
          set_version: input.setVersion,
          similarity: link.similarity,
          is_primary: link.rank === 1 ? 1 : 0,
          link_rank: link.rank,
          assign_method: input.assignMethod,
          assigned_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['article_id', 'topic_id']).doUpdateSet({
            similarity: link.similarity,
            is_primary: link.rank === 1 ? 1 : 0,
            link_rank: link.rank,
            assign_method: input.assignMethod,
            assigned_at: now,
          })
        )
        .execute();
    }
  });

  return { plan, affectedTopicIds: [...affected] };
}

/**
 * 刷新主题计数：linked_count = 链接数（= 主题内唯一文章数），primary_count = 主归属数。
 * 口径见设计文档 §6.0。
 */
export async function refreshTopicCounts(
  topicId: number
): Promise<{ linkedCount: number; primaryCount: number }> {
  const { linked, primary } = await countTopicLinks(topicId);
  await getDb()
    .updateTable('cluster_topics')
    .set({
      linked_count: linked,
      primary_count: primary,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', topicId)
    .execute();
  return { linkedCount: linked, primaryCount: primary };
}

/** 增加周期新增计数（前端 +N 角标） */
export async function addPeriodAdded(topicId: number, delta: number): Promise<void> {
  if (delta === 0) return;
  await getDb()
    .updateTable('cluster_topics')
    .set((eb) => ({
      period_added_count: eb('period_added_count', '+', delta),
    }))
    .where('id', '=', topicId)
    .execute();
}

