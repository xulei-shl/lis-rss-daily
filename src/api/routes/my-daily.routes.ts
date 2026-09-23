/**
 * 我的每日路由
 *
 * 提供每日评分文章的查询接口。
 * 需要 user 或 admin 角色。
 */

import { Router } from 'express';
import { requireAuth, requireUser, type AuthRequest } from '../../middleware/auth.js';
import { getDailyArticles, getAvailableDates } from '../my-daily.js';
import { scoreForUser } from '../../my-daily-scorer-scheduler.js';

const router = Router();

// 获取当日评分文章列表
router.get('/my-daily', requireAuth, requireUser, async (req: AuthRequest, res) => {
  try {
    const date = req.query.date as string | undefined;
    const result = await getDailyArticles(req.userId!, date);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取每日文章失败';
    res.status(500).json({ error: message });
  }
});

// 获取可用的评分日期
router.get('/my-daily/dates', requireAuth, requireUser, async (req: AuthRequest, res) => {
  try {
    const dates = await getAvailableDates(req.userId!);
    res.json({ dates });
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取日期列表失败';
    res.status(500).json({ error: message });
  }
});

// 立即重新触发当前用户的 JEV 评分
router.post('/my-daily/refresh', requireAuth, requireUser, async (req: AuthRequest, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const date = (req.body?.date as string) || today;
    const username = req.user?.username || 'user';

    const result = await scoreForUser(req.userId!, username, date);

    if (result.skipped && (result as any).reason === 'no_topics') {
      res.status(400).json({ error: '您尚未配置主题领域，请先前往「主题」页面添加关注的主题领域与关键词' });
      return;
    }

    if ((result as any).reason === 'no_articles') {
      res.json({ success: true, message: '该日期暂无通过筛选的新增文章', ...result });
      return;
    }

    res.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '重新评分失败';
    res.status(500).json({ error: message });
  }
});

export default router;
