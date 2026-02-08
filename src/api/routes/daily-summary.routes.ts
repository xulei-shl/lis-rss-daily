/**
 * 当日总结 API 路由
 */

import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import * as dailySummaryService from '../daily-summary.js';

const log = logger.child({ module: 'api-routes/daily-summary' });
const router = express.Router();

/**
 * POST /api/daily-summary/generate
 * 生成当日总结并保存
 */
router.post('/daily-summary/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { date, limit } = req.body || {};

    const result = await dailySummaryService.generateDailySummary({
      userId: req.userId!,
      date,
      limit,
    });

    // 保存到数据库
    await dailySummaryService.saveDailySummary({
      userId: req.userId!,
      date: result.date,
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
 */
router.get('/daily-summary/today', requireAuth, async (req: AuthRequest, res) => {
  try {
    const summary = await dailySummaryService.getTodaySummary(req.userId!);

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
 */
router.get('/daily-summary/history', requireAuth, async (req: AuthRequest, res) => {
  try {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit) : 30;

    const history = await dailySummaryService.getDailySummaryHistory(req.userId!, limit);

    res.json({ history });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get daily summary history');
    res.status(500).json({ error: 'Failed to get daily summary history' });
  }
});

/**
 * GET /api/daily-summary/:date
 * 获取指定日期的总结
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

    const summary = await dailySummaryService.getDailySummaryByDate(req.userId!, dateParam);

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

    const summary = await dailySummaryService.getDailySummaryByDate(req.userId!, dateParam);

    if (!summary) {
      res.status(404).json({ error: '总结不存在' });
      return;
    }

    // 解析 articles_data JSON
    const articlesData = JSON.parse(summary.articles_data);

    res.json({
      date: dateParam,
      total: summary.article_count,
      ...articlesData,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get daily summary articles');
    res.status(500).json({ error: 'Failed to get daily summary articles' });
  }
});

export default router;
