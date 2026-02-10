import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getTypeConfigForAPI } from '../../config/types-config.js';

const router = express.Router();

/**
 * GET /api/types
 * 获取所有类型定义（用于前端动态渲染）
 */
router.get('/types', requireAuth, async (_req, res) => {
  try {
    const config = getTypeConfigForAPI();
    res.json({
      version: config.version,
      task_types: Object.values(config.task_types).filter(t => t.enabled),
      source_types: Object.values(config.source_types),
      metadata: config.metadata,
    });
  } catch (error) {
    console.error('获取类型定义失败:', error);
    res.status(500).json({ error: '获取类型定义失败' });
  }
});

export default router;
