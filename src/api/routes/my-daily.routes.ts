/**
 * 我的每日路由
 *
 * 提供每日评分文章的查询接口。
 * 需要 user 或 admin 角色。
 */

import { Router } from 'express';
import { requireAuth, requireUser, type AuthRequest } from '../../middleware/auth.js';
import { getDailyArticles, getAvailableDates } from '../my-daily.js';
import { getUserLocalDate } from '../timezone.js';
import { scoreForUser, ScoringQueueError } from '../../my-daily-scorer-scheduler.js';

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
    res.json(await getAvailableDates(req.userId!));
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取日期列表失败';
    res.status(500).json({ error: message });
  }
});

// 立即重新触发当前用户的 JEV 评分
//
// 同一时刻只允许一个评分任务在执行：已有任务运行时本请求会排队等待，
// 前一个任务结束后自动开始执行（因此响应可能较慢，前端会提示"排队中"）。
router.post('/my-daily/refresh', requireAuth, requireUser, async (req: AuthRequest, res) => {
  try {
    // 默认按用户时区下的当天评分，与每日总结一致
    const date = (req.body?.date as string) || (await getUserLocalDate(req.userId!));
    const username = req.user?.username || 'user';

    const result = await scoreForUser(req.userId!, username, date);

    if (result.skipped && (result as any).reason === 'no_topics') {
      res.status(400).json({ error: '您尚未配置主题领域，请先前往「主题」页面添加关注的主题领域与关键词' });
      return;
    }

    if ((result as any).reason === 'no_articles') {
      res.json({ success: true, message: '该日期暂无新增文章', ...result });
      return;
    }

    if ((result as any).reason === 'duplicate') {
      res.json({
        success: true,
        message: '该日期的评分正在进行中，完成后刷新即可看到结果',
        ...result,
      });
      return;
    }

    res.json({ success: true, ...result });
  } catch (error) {
    // 排队失败（队列已满 / 等待超时）：让前端提示稍后重试
    if (error instanceof ScoringQueueError) {
      res.status(429).json({ error: error.message, reason: error.reason });
      return;
    }

    const message = error instanceof Error ? error.message : '重新评分失败';
    res.status(500).json({ error: message });
  }
});

export default router;
