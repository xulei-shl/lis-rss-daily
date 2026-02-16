/**
 * 当日总结 API 路由
 */

import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireCliAuth } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import * as dailySummaryService from '../daily-summary.js';
import type { SummaryType } from '../daily-summary.js';

const log = logger.child({ module: 'api-routes/daily-summary' });
const router = express.Router();

// 有效的总结类型
const VALID_SUMMARY_TYPES: SummaryType[] = ['journal', 'blog_news', 'all'];

/**
 * 验证并获取总结类型参数
 */
function parseSummaryType(typeParam: unknown): SummaryType | undefined {
  if (!typeParam || typeof typeParam !== 'string') return undefined;
  return VALID_SUMMARY_TYPES.includes(typeParam as SummaryType) 
    ? (typeParam as SummaryType) 
    : undefined;
}

/**
 * POST /api/daily-summary/generate
 * 生成当日总结并保存
 * 
 * Body 参数:
 * - date: 可选，日期 (YYYY-MM-DD)
 * - limit: 可选，文章数量限制 (默认 30)
 * - type: 可选，总结类型 (journal | blog_news | all)
 */
router.post('/daily-summary/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { date, limit } = req.body || {};
    const type = parseSummaryType(req.body?.type);

    const result = await dailySummaryService.generateDailySummary({
      userId: req.userId!,
      date,
      limit,
      type,
    });

    // 保存到数据库
    await dailySummaryService.saveDailySummary({
      userId: req.userId!,
      date: result.date,
      type: result.type,
      articleCount: result.totalArticles,
      summaryContent: result.summary,
      articlesData: result.articlesByType,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate daily summary';
    log.error({ error, userId: req.userId }, 'Failed to generate daily summary');
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/daily-summary/today
 * 获取今天的总结（如不存在返回 404）
 * 
 * Query 参数:
 * - type: 可选，总结类型 (journal | blog_news)
 */
router.get('/daily-summary/today', requireAuth, async (req: AuthRequest, res) => {
  try {
    const type = parseSummaryType(req.query.type);
    const summary = await dailySummaryService.getTodaySummary(req.userId!, type);

    if (!summary) {
      res.status(404).json({ error: '今日总结尚未生成' });
      return;
    }

    res.json(summary);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get today summary');
    res.status(500).json({ error: 'Failed to get today summary' });
  }
});

/**
 * GET /api/daily-summary/history
 * 获取历史总结列表
 * 
 * Query 参数:
 * - limit: 可选，数量限制 (默认 30)
 * - type: 可选，筛选总结类型 (journal | blog_news | all)
 */
router.get('/daily-summary/history', requireAuth, async (req: AuthRequest, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit) : 30;
    const type = parseSummaryType(req.query.type);

    const history = await dailySummaryService.getDailySummaryHistory(req.userId!, limit, type);

    res.json({ history });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get daily summary history');
    res.status(500).json({ error: 'Failed to get daily summary history' });
  }
});

/**
 * GET /api/daily-summary/:date
 * 获取指定日期的总结
 * 
 * Query 参数:
 * - type: 可选，总结类型 (journal | blog_news | all)
 */
router.get('/daily-summary/:date', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { date } = req.params;

    // Handle array case from express
    const dateParam = Array.isArray(date) ? date[0] : date;

    // 验证日期格式 (YYYY-MM-DD)
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }

    const type = parseSummaryType(req.query.type);
    const summary = await dailySummaryService.getDailySummaryByDate(req.userId!, dateParam, type);

    if (!summary) {
      res.status(404).json({ error: '总结不存在' });
      return;
    }

    res.json(summary);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get daily summary');
    res.status(500).json({ error: 'Failed to get daily summary' });
  }
});

/**
 * GET /api/daily-summary/:date/articles
 * 获取指定日期使用的文章列表
 * 
 * Query 参数:
 * - type: 可选，总结类型 (journal | blog_news | all)
 */
router.get('/daily-summary/:date/articles', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { date } = req.params;

    // Handle array case from express
    const dateParam = Array.isArray(date) ? date[0] : date;

    // 验证日期格式
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }

    const type = parseSummaryType(req.query.type);
    const summary = await dailySummaryService.getDailySummaryByDate(req.userId!, dateParam, type);

    if (!summary) {
      res.status(404).json({ error: '总结不存在' });
      return;
    }

    // 解析 articles_data JSON
    const articlesData = JSON.parse(summary.articles_data);

    res.json({
      date: dateParam,
      type: summary.summary_type,
      total: summary.article_count,
      ...articlesData,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get daily summary articles');
    res.status(500).json({ error: 'Failed to get daily summary articles' });
  }
});

/**
 * POST /api/daily-summary/cli
 * CLI 专用端点：生成当日总结（无需 Cookie 认证）
 * 使用 user_id 和 api_key 查询参数进行认证
 *
 * Body 参数:
 * - date: 可选，日期 (YYYY-MM-DD)
 * - limit: 可选，文章数量限制
 * - type: 可选，总结类型 (journal | blog_news | all)
 * - generateAll: 可选，是否同时生成两类总结
 *
 * 行为：
 * - 如果数据库中已存在当天总结，直接返回
 * - 如果不存在，生成新的总结并保存
 */
router.post('/daily-summary/cli', requireCliAuth, async (req: AuthRequest, res) => {
  try {
    const { date, limit, generateAll } = req.body || {};
    const type = parseSummaryType(req.body?.type);
    const targetDate = date || new Date().toISOString().split('T')[0];

    // 如果请求生成所有类型的总结
    if (generateAll) {
      const results = [];
      const types: SummaryType[] = ['journal', 'blog_news'];
      
      for (const t of types) {
        // 检查是否已存在
        const existing = await dailySummaryService.getDailySummaryByDate(req.userId!, targetDate, t);
        
        if (existing) {
          const articlesData = JSON.parse(existing.articles_data);
          results.push({
            type: t,
            cached: true,
            data: {
              date: existing.summary_date,
              type: existing.summary_type,
              totalArticles: existing.article_count,
              articlesByType: articlesData,
              summary: existing.summary_content,
              generatedAt: existing.created_at,
            },
          });
        } else {
          // 生成新的总结
          const result = await dailySummaryService.generateDailySummary({
            userId: req.userId!,
            date: targetDate,
            limit,
            type: t,
          });
          
          if (result.totalArticles > 0) {
            await dailySummaryService.saveDailySummary({
              userId: req.userId!,
              date: result.date,
              type: result.type,
              articleCount: result.totalArticles,
              summaryContent: result.summary,
              articlesData: result.articlesByType,
            });
          }
          
          results.push({
            type: t,
            cached: false,
            data: result,
          });
        }
      }
      
      return res.json({
        status: 'success',
        results,
      });
    }

    // 单类型总结逻辑
    const targetType = type || 'all';
    
    // 先检查数据库是否已有当天的总结
    const existing = await dailySummaryService.getDailySummaryByDate(req.userId!, targetDate, targetType);

    if (existing) {
      // 已存在，直接返回
      log.info({ userId: req.userId, date: targetDate, type: targetType }, 'CLI: Returning cached daily summary');

      const articlesData = JSON.parse(existing.articles_data);

      return res.json({
        status: 'success',
        cached: true,
        data: {
          date: existing.summary_date,
          type: existing.summary_type,
          totalArticles: existing.article_count,
          articlesByType: articlesData,
          summary: existing.summary_content,
          generatedAt: existing.created_at,
        },
      });
    }

    // 不存在，生成新的总结
    log.info({ userId: req.userId, date: targetDate, type: targetType }, 'CLI: Generating new daily summary');

    const result = await dailySummaryService.generateDailySummary({
      userId: req.userId!,
      date: targetDate,
      limit,
      type: targetType,
    });

    // 判断是否为空结果（无新文章）
    const isEmpty = result.totalArticles === 0;

    if (isEmpty) {
      // 无新文章，返回空状态
      res.json({
        status: 'empty',
        cached: false,
        message: '当日暂无通过的文章',
        data: {
          date: result.date,
          type: result.type,
          totalArticles: result.totalArticles,
          articlesByType: result.articlesByType,
        },
      });
    } else {
      // 有新文章，保存到数据库并返回完整结果
      await dailySummaryService.saveDailySummary({
        userId: req.userId!,
        date: result.date,
        type: result.type,
        articleCount: result.totalArticles,
        summaryContent: result.summary,
        articlesData: result.articlesByType,
      });

      res.json({
        status: 'success',
        cached: false,
        data: result,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate daily summary';
    log.error({ error, userId: req.userId }, 'CLI: Failed to generate daily summary');
    res.status(500).json({
      status: 'error',
      error: message,
    });
  }
});

export default router;
