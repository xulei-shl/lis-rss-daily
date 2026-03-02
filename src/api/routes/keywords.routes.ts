/**
 * Keywords API Routes
 * 关键词订阅管理路由
 */

import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import * as keywordsService from '../keywords.js';
import { KeywordScheduler } from '../../keyword-scheduler.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/keywords' });

const router = express.Router();

// ============================================================================
// Keywords Routes
// ============================================================================

/**
 * GET /api/keywords
 * 获取关键词列表（支持分页）
 */
router.get('/keywords', requireAuth, async (req: AuthRequest, res) => {
  try {
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;
    const spiderType = req.query.spiderType as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await keywordsService.listKeywords({
      userId: req.userId!,
      isActive,
      spiderType,
      page,
      limit,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get keywords');
    res.status(500).json({ error: 'Failed to get keywords' });
  }
});

/**
 * GET /api/keywords/:id
 * 获取单个关键词详情
 */
router.get('/keywords/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }

    const keyword = await keywordsService.getKeyword(req.userId!, id);

    if (!keyword) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    res.json(keyword);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get keyword');
    res.status(500).json({ error: 'Failed to get keyword' });
  }
});

/**
 * POST /api/keywords
 * 创建关键词订阅
 */
router.post('/keywords', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { keyword, yearStart, yearEnd, spiderType, numResults, isActive } = req.body;

    // 验证必填字段
    if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
      return res.status(400).json({ error: '关键词是必填项' });
    }

    if (spiderType && !['google_scholar', 'cnki'].includes(spiderType)) {
      return res.status(400).json({ error: '爬虫类型必须是 google_scholar 或 cnki' });
    }

    if (numResults !== undefined && (typeof numResults !== 'number' || numResults < 10 || numResults > 100)) {
      return res.status(400).json({ error: '每次爬取结果数必须在 10-100 之间' });
    }

    const result = await keywordsService.createKeyword({
      userId: req.userId!,
      keyword: keyword.trim(),
      yearStart,
      yearEnd,
      spiderType,
      numResults,
      isActive,
    });

    res.status(201).json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to create keyword');
    res.status(500).json({ error: 'Failed to create keyword' });
  }
});

/**
 * PUT /api/keywords/:id
 * 更新关键词订阅
 */
router.put('/keywords/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }

    const { keyword, yearStart, yearEnd, spiderType, numResults, isActive } = req.body;

    const updateData: keywordsService.UpdateKeywordParams = {};

    if (keyword !== undefined) {
      if (typeof keyword !== 'string' || keyword.trim().length === 0) {
        return res.status(400).json({ error: '关键词不能为空' });
      }
      updateData.keyword = keyword.trim();
    }

    if (yearStart !== undefined) {
      if (yearStart !== null && (typeof yearStart !== 'number' || yearStart < 1900 || yearStart > 2100)) {
        return res.status(400).json({ error: '起始年份无效' });
      }
      updateData.yearStart = yearStart;
    }

    if (yearEnd !== undefined) {
      if (yearEnd !== null && (typeof yearEnd !== 'number' || yearEnd < 1900 || yearEnd > 2100)) {
        return res.status(400).json({ error: '结束年份无效' });
      }
      updateData.yearEnd = yearEnd;
    }

    if (spiderType !== undefined) {
      if (!['google_scholar', 'cnki'].includes(spiderType)) {
        return res.status(400).json({ error: '爬虫类型无效' });
      }
      updateData.spiderType = spiderType;
    }

    if (numResults !== undefined) {
      if (typeof numResults !== 'number' || numResults < 10 || numResults > 100) {
        return res.status(400).json({ error: '每次爬取结果数必须在 10-100 之间' });
      }
      updateData.numResults = numResults;
    }

    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    const result = await keywordsService.updateKeyword(req.userId!, id, updateData);

    if (!result) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to update keyword');
    res.status(500).json({ error: 'Failed to update keyword' });
  }
});

/**
 * DELETE /api/keywords/:id
 * 删除关键词订阅
 */
router.delete('/keywords/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }

    const deleted = await keywordsService.deleteKeyword(req.userId!, id);

    if (!deleted) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    res.json({ success: true });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to delete keyword');
    res.status(500).json({ error: 'Failed to delete keyword' });
  }
});

/**
 * POST /api/keywords/:id/crawl
 * 手动触发爬取
 */
router.post('/keywords/:id/crawl', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }

    // 获取调度器实例（需要在 server.ts 中初始化）
    const scheduler = KeywordScheduler.getInstance();
    const result = await scheduler.crawlKeywordNow(id);

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to crawl keyword');
    res.status(500).json({ error: 'Failed to crawl keyword' });
  }
});

/**
 * GET /api/keywords/scheduler/status
 * 获取调度器状态
 */
router.get('/keywords/scheduler/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scheduler = KeywordScheduler.getInstance();
    const status = scheduler.getStatus();

    res.json(status);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get scheduler status');
    res.status(500).json({ error: 'Failed to get scheduler status' });
  }
});

/**
 * GET /api/keywords/:id/logs
 * 获取爬取日志
 */
router.get('/keywords/:id/logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }
    const keywordId = parseInt(idParam);

    if (isNaN(keywordId)) {
      return res.status(400).json({ error: 'Invalid keyword ID' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await keywordsService.getKeywordCrawlLogs(req.userId!, keywordId, page, limit);

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get keyword logs');
    res.status(500).json({ error: 'Failed to get keyword logs' });
  }
});

export default router;
