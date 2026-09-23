/**
 * 我的每日评分调度器
 *
 * 定时为每个 user 角色的用户执行 JEV 评分：
 * 1. 获取所有 role='user' 的用户
 * 2. 获取每个用户的主题领域和关键词
 * 3. 获取当日新增且通过筛选的文章
 * 4. 并行调用 JEV 评分
 * 5. 结果写入 user_daily_scores 表
 */

import cron from 'node-cron';
import { getDb } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { scoreArticlesBatch, resolveJevConfig, type TopicInfo } from './jev.js';

const log = logger.child({ module: 'my-daily-scorer' });

/**
 * 获取用户的主题领域和关键词
 */
async function getUserTopics(userId: number): Promise<TopicInfo[]> {
  const db = getDb();

  // 获取用户激活的主题领域
  const domains = await db
    .selectFrom('topic_domains')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .select(['id', 'name', 'description'])
    .execute();

  if (domains.length === 0) return [];

  // 获取每个领域的关键词
  const topics: TopicInfo[] = [];
  for (const domain of domains) {
    const keywords = await db
      .selectFrom('topic_keywords')
      .where('domain_id', '=', domain.id)
      .where('is_active', '=', 1)
      .select(['keyword'])
      .execute();

    topics.push({
      name: domain.name,
      description: domain.description,
      keywords: keywords.map(k => k.keyword),
    });
  }

  return topics;
}

/**
 * 获取当日新增且通过筛选的文章
 */
async function getTodayArticles(date: string) {
  const db = getDb();

  // 查询当日通过筛选的文章
  const articles = await db
    .selectFrom('articles')
    .where('filter_status', '=', 'passed')
    .where('created_at', '>=', `${date} 00:00:00`)
    .where('created_at', '<', `${date} 23:59:59`)
    .select(['id', 'title', 'summary'])
    .execute();

  return articles;
}

/**
 * 为单个用户执行评分
 */
export async function scoreForUser(userId: number, username: string, date: string) {
  try {
    await resolveJevConfig();
  } catch (err) {
    throw new Error('未配置 JEV API 密钥。请在「设置 -> LLM 配置」中添加 JEV 配置，或在环境变量中配置 TYPESAFE_API_KEY。');
  }

  log.info({ userId, username, date }, '开始为用户执行评分');

  // 获取用户主题
  const topics = await getUserTopics(userId);
  if (topics.length === 0) {
    log.info({ userId, username }, '用户没有设置主题领域，跳过');
    return { userId, scored: 0, skipped: true, reason: 'no_topics' };
  }

  // 获取当日文章
  const articles = await getTodayArticles(date);
  if (articles.length === 0) {
    log.info({ userId, username, date }, '当日没有通过筛选的文章');
    return { userId, scored: 0, skipped: false, reason: 'no_articles', total: 0 };
  }

  log.info({ userId, username, articleCount: articles.length }, '开始 JEV 评分');

  // 批量评分
  const results = await scoreArticlesBatch(articles, topics);

  // 写入数据库
  const db = getDb();
  let inserted = 0;
  for (const result of results) {
    try {
      await db
        .insertInto('user_daily_scores')
        .values({
          user_id: userId,
          article_id: result.articleId,
          score_date: date,
          relevance_score: result.relevanceScore,
          matched_domain: result.matchedDomain,
          jev_response: JSON.stringify(result.jevResponse),
        })
        .onConflict(oc =>
          oc.columns(['user_id', 'article_id', 'score_date']).doUpdateSet({
            relevance_score: result.relevanceScore,
            matched_domain: result.matchedDomain,
            jev_response: JSON.stringify(result.jevResponse),
          })
        )
        .execute();
      inserted++;
    } catch (error) {
      log.error({ userId, articleId: result.articleId, error }, '写入评分失败');
    }
  }

  log.info({ userId, username, total: articles.length, inserted }, '用户评分完成');
  return { userId, scored: inserted, skipped: false };
}

/**
 * 执行所有用户的评分
 */
async function runDailyScoring() {
  const startTime = Date.now();
  const date = new Date().toISOString().split('T')[0];

  log.info({ date }, '开始每日 JEV 评分任务');

  // 检查 JEV 配置
  try {
    await resolveJevConfig();
  } catch (err) {
    log.warn('未配置 JEV API 密钥，跳过每日评分');
    return;
  }

  // 获取所有 user 角色的用户
  const db = getDb();
  const users = await db
    .selectFrom('users')
    .where('role', '=', 'user')
    .select(['id', 'username'])
    .execute();

  if (users.length === 0) {
    log.info('没有 user 角色的用户，跳过评分');
    return;
  }

  log.info({ userCount: users.length }, '找到需要评分的用户');

  // 逐个用户评分（避免并发过高）
  const results = [];
  for (const user of users) {
    try {
      const result = await scoreForUser(user.id, user.username, date);
      results.push(result);
    } catch (error) {
      log.error({ userId: user.id, username: user.username, error }, '用户评分出错');
      results.push({ userId: user.id, scored: 0, skipped: false, error: true });
    }
  }

  const elapsed = Date.now() - startTime;
  const totalScored = results.reduce((sum, r) => sum + r.scored, 0);
  log.info(
    { date, users: users.length, totalScored, elapsed: `${elapsed}ms` },
    '每日 JEV 评分任务完成'
  );
}

/**
 * 初始化每日评分调度器
 */
export function initMyDailyScorerScheduler() {
  let task: cron.ScheduledTask | null = null;

  return {
    start() {
      const schedule = config.myDailySchedule;
      task = cron.schedule(schedule, async () => {
        try {
          await runDailyScoring();
        } catch (error) {
          log.error({ error }, '每日评分调度出错');
        }
      });
      log.info({ schedule }, '每日评分调度器已启动');
    },

    async stop() {
      if (task) {
        task.stop();
        task = null;
      }
    },

    // 支持手动触发
    runNow: runDailyScoring,
  };
}
