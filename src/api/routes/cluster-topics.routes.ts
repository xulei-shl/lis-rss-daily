/**
 * 主题聚类只读 API。
 *
 * 面向所有已登录角色（admin / user / guest）开放：本模块的数据是**共享的学术洞察**，
 * 不属于任何单个用户，因此统一读取 `CLUSTER_USER_ID`（默认 1）名下的数据，
 * 与洞察报告的口径一致。
 *
 * 全部读接口，**不触发任何 LLM 调用**——多维分析由每日流水线预计算并落库。
 */

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import { getClusterOverview, getTopicDetail, listTopicCards, type TopicSort } from '../../topic-cluster/query.js';

const log = logger.child({ module: 'cluster-topics-routes' });

const router = express.Router();

function asSort(value: unknown): TopicSort {
  if (value === 'size' || value === 'name') return value;
  return 'recent';
}

/** 主题列表 / 检索 */
router.get('/cluster-topics', requireAuth, async (req: any, res: express.Response) => {
  try {
    const result = await listTopicCards({
      search: typeof req.query.q === 'string' ? req.query.q : undefined,
      sort: asSort(req.query.sort),
      limit: Number(req.query.limit) || 24,
      offset: Number(req.query.offset) || 0,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, '读取主题列表失败');
    res.status(500).json({ error: '读取主题列表失败' });
  }
});

/** 全库概览（页面统计条） */
router.get('/cluster-topics/overview', requireAuth, async (_req: express.Request, res: express.Response) => {
  try {
    res.json(await getClusterOverview());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, '读取主题概览失败');
    res.status(500).json({ error: '读取主题概览失败' });
  }
});

/** 主题详情（slug 或数字 id） */
router.get('/cluster-topics/:slugOrId', requireAuth, async (req: any, res: express.Response) => {
  try {
    const detail = await getTopicDetail(String(req.params.slugOrId));
    if (!detail) {
      res.status(404).json({ error: '主题不存在' });
      return;
    }
    res.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, '读取主题详情失败');
    res.status(500).json({ error: '读取主题详情失败' });
  }
});

export default router;
