/**
 * 我的每日 API
 *
 * 获取当日 JEV 评分结果，按评分排序返回。
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'my-daily-api' });

/**
 * 获取用户当日的评分文章列表
 */
export async function getDailyArticles(userId: number, date?: string) {
  const db = getDb();

  // 默认今天
  const scoreDate = date || new Date().toISOString().split('T')[0];

  // 联表查询：评分 + 文章 + 翻译
  const articles = await db
    .selectFrom('user_daily_scores as s')
    .innerJoin('articles as a', 'a.id', 's.article_id')
    .leftJoin('article_translations as t', 't.article_id', 'a.id')
    .where('s.user_id', '=', userId)
    .where('s.score_date', '=', scoreDate)
    .select([
      'a.id',
      'a.title',
      'a.url',
      'a.summary',
      'a.source_origin',
      'a.filter_status',
      'a.published_at',
      'a.created_at',
      's.relevance_score',
      's.matched_domain',
      't.title_zh',
      't.summary_zh',
    ])
    .orderBy('s.relevance_score', 'desc')
    .execute();

  return {
    date: scoreDate,
    total: articles.length,
    articles,
  };
}

/**
 * 获取可用的评分日期列表
 */
export async function getAvailableDates(userId: number) {
  const db = getDb();

  const dates = await db
    .selectFrom('user_daily_scores')
    .where('user_id', '=', userId)
    .select('score_date')
    .distinct()
    .orderBy('score_date', 'desc')
    .limit(30)
    .execute();

  return dates.map(d => d.score_date);
}
