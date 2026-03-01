/**
 * 黑名单配置 API 路由
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getBlacklistConfig, reloadBlacklistConfig } from '../../config/blacklist-config.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'blacklist-api' });
const router = express.Router();

// Debug log to verify route is loaded
console.log('[blacklist.routes.ts] Loading blacklist routes...');

const CONFIG_PATH = path.join(process.cwd(), 'config', 'blacklist.yaml');

/**
 * GET /api/blacklist - 获取黑名单配置
 */
router.get('/blacklist', async (req, res) => {
  console.log('[blacklist.routes.ts] GET /blacklist called!');
  try {
    const config = getBlacklistConfig();
    console.log('[blacklist.routes.ts] Config loaded:', config);
    res.json(config);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[blacklist.routes.ts] Error:', errMsg);
    log.error({ error: errMsg }, 'Failed to get blacklist config');
    res.status(500).json({ error: '获取黑名单配置失败' });
  }
});

/**
 * PUT /api/blacklist - 更新黑名单配置（需要管理员权限）
 */
router.put('/blacklist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title_keywords } = req.body;

    // 验证输入
    if (!title_keywords) {
      return res.status(400).json({ error: '缺少 title_keywords 字段' });
    }

    if (typeof title_keywords.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled 必须是布尔值' });
    }

    if (typeof title_keywords.keywords !== 'string') {
      return res.status(400).json({ error: 'keywords 必须是字符串' });
    }

    // 读取现有配置
    let existingConfig: any = { version: "1.0", metadata: { updated_at: "" }, title_keywords: { enabled: true, keywords: "" } };
    if (fs.existsSync(CONFIG_PATH)) {
      const yamlContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
      existingConfig = yaml.load(yamlContent);
    }

    // 更新配置
    const updatedConfig = {
      ...existingConfig,
      title_keywords: {
        enabled: title_keywords.enabled,
        keywords: title_keywords.keywords,
      },
      metadata: {
        ...existingConfig.metadata,
        updated_at: new Date().toISOString().split('T')[0],
      },
    };

    // 写入配置文件
    const yamlContent = yaml.dump(updatedConfig, { lineWidth: -1 });
    fs.writeFileSync(CONFIG_PATH, yamlContent, 'utf-8');

    // 重新加载配置缓存
    reloadBlacklistConfig();

    log.info({ enabled: title_keywords.enabled, keywordsCount: title_keywords.keywords.split(/[,，]/).length }, 'Blacklist config updated');

    res.json(updatedConfig);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ error: errMsg }, 'Failed to update blacklist config');
    res.status(500).json({ error: '更新黑名单配置失败' });
  }
});

export default router;
