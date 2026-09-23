/**
 * 我的每日 API
 *
 * 获取当日 JEV 评分结果，按评分排序返回。
 *
 * 日期语义与「每日期刊 / 每日资讯」总结保持一致：
 * score_date 是用户时区下的本地自然日（YYYY-MM-DD），
 * 文章通常在凌晨抓取，因此查询时必须换算成对应的 UTC 区间。
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { getUserLocalDate, getUserTimezone, buildUtcRangeFromLocalDate } from './timezone.js';

const log = logger.child({ module: 'my-daily-api' });

/** 可评分日期回溯窗口（自然日） */
const SCORABLE_DAYS_WINDOW = 30;

/**
 * 获取用户当日的评分文章列表
 */
export async function getDailyArticles(userId: number, date?: string) {
  const db = getDb();

  // 默认用户时区下的当天
  const scoreDate = date || (await getUserLocalDate(userId));

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
 * 按自然日平移日期字符串（YYYY-MM-DD）
 */
function shiftLocalDate(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().split('T')[0];
}

/**
 * 获取最近若干自然日中「有可评分文章」的日期
 *
 * 与计分口径保持一致：每个自然日都按用户时区换算成 UTC 区间，
 * 只要该自然日存在任何新增文章（不限于已通过预过滤的），就认为可评分。
 */
async function getScorableDates(timezone: string, todayLocal: string): Promise<string[]> {
  const db = getDb();
  const dates: string[] = [];

  for (let offset = 0; offset < SCORABLE_DAYS_WINDOW; offset++) {
    const date = shiftLocalDate(todayLocal, -offset);
    const [startUtc, endUtc] = buildUtcRangeFromLocalDate(date, timezone);

    const hit = await db
      .selectFrom('articles')
      .where('created_at', '>=', startUtc)
      .where('created_at', '<=', endUtc)
      .select('id')
      .limit(1)
      .executeTakeFirst();

    if (hit) dates.push(date);
  }

  return dates;
}

/**
 * 获取可用的评分日期列表
 *
 * 合并两类日期（去重后按时间倒序，最多 30 个）：
 * 1. 已经产生评分结果的日期
 * 2. 有可评分文章的日期（最近 30 个自然日内，当日有新增文章）
 *
 * 第 2 类保证用户在尚未评分时，仍然能选择该日期进行评分。
 */
export async function getAvailableDates(userId: number) {
  const db = getDb();
  const limit = 30;

  const [timezone, todayLocal] = await Promise.all([
    getUserTimezone(userId),
    getUserLocalDate(userId),
  ]);

  const scoredDates = await db
    .selectFrom('user_daily_scores')
    .where('user_id', '=', userId)
    .select('score_date')
    .distinct()
    .orderBy('score_date', 'desc')
    .limit(limit)
    .execute();

  const scorableDates = await getScorableDates(timezone, todayLocal);

  const dates = new Set<string>();
  for (const d of scoredDates) dates.add(d.score_date);
  for (const d of scorableDates) dates.add(d);

  log.info({ userId, timezone, today: todayLocal, count: dates.size }, '获取可评分日期列表');

  return {
    dates: Array.from(dates).sort().reverse().slice(0, limit),
    today: todayLocal,
  };
}
