/**
 * Journals API Routes
 * 期刊管理路由
 */

import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import * as journalsService from '../journals.js';
import { initJournalScheduler } from '../../journal-scheduler.js';
import { logger } from '../../logger.js';
import type { JournalSourceType, PublicationCycle } from '../../spiders/types.js';

const log = logger.child({ module: 'api-routes/journals' });

const router = express.Router();

// ============================================================================
// Journals Routes
// ============================================================================

/**
 * GET /api/journals
 * 获取期刊列表（支持分页）
 */
router.get('/journals', requireAuth, async (req: AuthRequest, res) => {
  try {
    const status = req.query.status as 'active' | 'inactive' | undefined;
    const sourceType = req.query.sourceType as JournalSourceType | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await journalsService.listJournals({
      userId: req.userId!,
      status,
      sourceType,
      page,
      limit,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get journals');
    res.status(500).json({ error: 'Failed to get journals' });
  }
});

/**
 * GET /api/journals/:id
 * 获取单个期刊详情
 */
router.get('/journals/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }

    const journal = await journalsService.getJournal(req.userId!, id);

    if (!journal) {
      return res.status(404).json({ error: 'Journal not found' });
    }

    res.json(journal);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get journal');
    res.status(500).json({ error: 'Failed to get journal' });
  }
});

/**
 * POST /api/journals
 * 创建期刊
 */
router.post('/journals', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, sourceType, sourceUrl, journalCode, publicationCycle, issuesPerYear, volumeOffset } = req.body;

    // 验证必填字段
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: '期刊名称是必填项' });
    }

    if (!sourceType || !['cnki', 'rdfybk', 'lis'].includes(sourceType)) {
      return res.status(400).json({ error: '来源类型必须是 cnki、rdfybk 或 lis' });
    }

    if (!publicationCycle || !['monthly', 'bimonthly', 'semimonthly', 'quarterly'].includes(publicationCycle)) {
      return res.status(400).json({ error: '发行周期必须是 monthly、bimonthly、semimonthly 或 quarterly' });
    }

    if (!issuesPerYear || typeof issuesPerYear !== 'number' || issuesPerYear < 1) {
      return res.status(400).json({ error: '每年期数必须是大于 0 的整数' });
    }

    // CNKI 期刊必须有 URL
    if (sourceType === 'cnki' && (!sourceUrl || typeof sourceUrl !== 'string')) {
      return res.status(400).json({ error: 'CNKI 期刊必须提供期刊 URL' });
    }

    // 人大报刊期刊必须有代码
    if (sourceType === 'rdfybk' && (!journalCode || typeof journalCode !== 'string')) {
      return res.status(400).json({ error: '人大报刊期刊必须提供期刊代码' });
    }

    const journal = await journalsService.createJournal({
      userId: req.userId!,
      name: name.trim(),
      sourceType: sourceType as JournalSourceType,
      sourceUrl: sourceUrl?.trim(),
      journalCode: journalCode?.trim(),
      publicationCycle: publicationCycle as PublicationCycle,
      issuesPerYear,
      volumeOffset,
    });

    res.status(201).json(journal);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to create journal');
    res.status(500).json({ error: 'Failed to create journal' });
  }
});

/**
 * PUT /api/journals/:id
 * 更新期刊
 */
router.put('/journals/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }

    const { name, sourceUrl, journalCode, publicationCycle, issuesPerYear, volumeOffset, status } = req.body;

    const updateData: journalsService.UpdateJournalParams = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: '期刊名称不能为空' });
      }
      updateData.name = name.trim();
    }

    if (sourceUrl !== undefined) {
      updateData.sourceUrl = sourceUrl?.trim() || undefined;
    }

    if (journalCode !== undefined) {
      updateData.journalCode = journalCode?.trim() || undefined;
    }

    if (publicationCycle !== undefined) {
      if (!['monthly', 'bimonthly', 'semimonthly', 'quarterly'].includes(publicationCycle)) {
        return res.status(400).json({ error: '发行周期无效' });
      }
      updateData.publicationCycle = publicationCycle;
    }

    if (issuesPerYear !== undefined) {
      if (typeof issuesPerYear !== 'number' || issuesPerYear < 1) {
        return res.status(400).json({ error: '每年期数必须是大于 0 的整数' });
      }
      updateData.issuesPerYear = issuesPerYear;
    }

    if (volumeOffset !== undefined) {
      updateData.volumeOffset = volumeOffset;
    }

    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ error: '状态必须是 active 或 inactive' });
      }
      updateData.status = status;
    }

    const journal = await journalsService.updateJournal(req.userId!, id, updateData);

    if (!journal) {
      return res.status(404).json({ error: 'Journal not found' });
    }

    res.json(journal);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to update journal');
    res.status(500).json({ error: 'Failed to update journal' });
  }
});

/**
 * DELETE /api/journals/:id
 * 删除期刊
 */
router.delete('/journals/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }

    const deleted = await journalsService.deleteJournal(req.userId!, id);

    if (!deleted) {
      return res.status(404).json({ error: 'Journal not found' });
    }

    res.json({ success: true });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to delete journal');
    res.status(500).json({ error: 'Failed to delete journal' });
  }
});

/**
 * POST /api/journals/:id/crawl
 * 手动触发爬取
 */
router.post('/journals/:id/crawl', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }

    const { year, issue } = req.body;

    const scheduler = initJournalScheduler();
    const result = await scheduler.crawlNow(id, year, issue);

    res.json({
      success: result.success,
      journalId: result.journalId,
      year: result.year,
      issue: result.issue,
      articlesCount: result.articlesCount,
      newArticlesCount: result.newArticlesCount,
      durationMs: result.durationMs,
      error: result.error,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Journal not found') {
      return res.status(404).json({ error: 'Journal not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to crawl journal');
    res.status(500).json({ error: 'Failed to crawl journal' });
  }
});

/**
 * GET /api/journals/:id/logs
 * 获取爬取日志
 */
router.get('/journals/:id/logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const idParam = req.params.id;
    if (Array.isArray(idParam)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }
    const id = parseInt(idParam);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid journal ID' });
    }

    const limit = parseInt(req.query.limit as string) || 50;

    const logs = await journalsService.getCrawlLogs(req.userId!, id, limit);

    res.json({ logs });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get crawl logs');
    res.status(500).json({ error: 'Failed to get crawl logs' });
  }
});

/**
 * GET /api/journals/logs
 * 获取所有爬取日志（支持分页）
 */
router.get('/journals/logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await journalsService.getCrawlLogs(req.userId!, undefined, page, limit);

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get crawl logs');
    res.status(500).json({ error: 'Failed to get crawl logs' });
  }
});

/**
 * GET /api/journals/scheduler/status
 * 获取调度器状态
 */
router.get('/journals/scheduler/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scheduler = initJournalScheduler();
    const status = scheduler.getStatus();

    res.json(status);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get scheduler status');
    res.status(500).json({ error: 'Failed to get scheduler status' });
  }
});

export default router;
