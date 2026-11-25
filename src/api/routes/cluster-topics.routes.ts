/**
 * 主题聚类只读 API。
 *
 * 面向所有已登录角色（admin / user / guest）开放：本模块的数据是**共享的学术洞察**，
 * 不属于任何单个用户，因此统一读取 `CLUSTER_USER_ID`（默认 1）名下的数据，
 * 与洞察报告的口径一致。
 *
 * 除「手动生成版本文件」外均为读接口，**不触发任何 LLM 调用**——多维分析由每日
 * 流水线预计算并落库；版本文件只是对当前已落库内容的静态渲染。
 */

import fs from 'node:fs';
import express from 'express';
import { requireAuth, requireWriteAccess } from '../../middleware/auth.js';
import { logger } from '../../logger.js';
import {
  getClusterOverview,
  getTopicDetail,
  listTopicCards,
  resolveTopic,
  type TopicSort,
} from '../../topic-cluster/query.js';
import { deleteTopicDocument, getTopicDocumentById } from '../../topic-cluster/repo/documents.js';
import {
  formatDocumentVersion,
  generateTopicDocument,
  getTopicDocumentFilePath,
} from '../../topic-cluster/service/document-generator.js';

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

/** 手动为当前主题生成一份版本文件（内容未变化则跳过） */
router.post(
  '/cluster-topics/:slugOrId/documents',
  requireAuth,
  requireWriteAccess,
  async (req: any, res: express.Response) => {
    try {
      const topic = await resolveTopic(String(req.params.slugOrId));
      if (!topic) {
        res.status(404).json({ error: '主题不存在' });
        return;
      }

      const document = await generateTopicDocument(topic.id, { source: 'manual' });
      if (!document) {
        res.json({ generated: false, message: '内容未变化，未生成新版本' });
        return;
      }

      res.json({
        generated: true,
        message: `已生成版本 v${formatDocumentVersion(document.version)}`,
        document: {
          id: document.id,
          version: document.version,
          filename: document.filename,
          sizeBytes: document.size_bytes,
          createdAt: document.created_at,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, '手动生成主题洞察版本文件失败');
      res.status(500).json({ error: '生成版本文件失败' });
    }
  }
);

/** 下载某个主题洞察版本文件（HTML 快照） */
router.get(
  '/cluster-topics/:slugOrId/documents/:documentId/download',
  requireAuth,
  async (req: any, res: express.Response) => {
    try {
      const topic = await resolveTopic(String(req.params.slugOrId));
      const document = await getTopicDocumentById(Number(req.params.documentId));
      if (!topic || !document || document.topic_id !== topic.id) {
        res.status(404).json({ error: '版本文件不存在' });
        return;
      }

      const filePath = getTopicDocumentFilePath(document.filename);
      if (!fs.existsSync(filePath)) {
        log.warn({ documentId: document.id, filePath }, '版本文件元数据存在但磁盘文件缺失');
        res.status(404).json({ error: '版本文件已丢失' });
        return;
      }

      // 文件内的链接是站内相对路径（/articles/xxx、/clusters/xxx），离线打开会指向
      // file:///articles/...。下载时注入实际访问地址的 <base>，让链接回到真实服务。
      const html = fs.readFileSync(filePath, 'utf-8');
      const baseHref = `${req.protocol}://${req.get('host')}/`
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const withBase = html.includes('<base ')
        ? html
        : html.replace(/<head>/i, `<head>\n<base href="${baseHref}">`);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${document.filename}"`
      );
      res.send(withBase);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, '下载主题洞察版本文件失败');
      res.status(500).json({ error: '下载版本文件失败' });
    }
  }
);

/** 删除某个主题洞察版本文件（仅管理员） */
router.delete(
  '/cluster-topics/:slugOrId/documents/:documentId',
  requireAuth,
  requireWriteAccess,
  async (req: any, res: express.Response) => {
    try {
      const topic = await resolveTopic(String(req.params.slugOrId));
      const document = await getTopicDocumentById(Number(req.params.documentId));
      if (!topic || !document || document.topic_id !== topic.id) {
        res.status(404).json({ error: '版本文件不存在' });
        return;
      }

      fs.rmSync(getTopicDocumentFilePath(document.filename), { force: true });
      await deleteTopicDocument(document.id);
      log.info({ topicId: topic.id, documentId: document.id, version: document.version }, '已删除主题洞察版本文件');
      res.json({ deleted: true, message: `已删除版本 v${formatDocumentVersion(document.version)}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, '删除主题洞察版本文件失败');
      res.status(500).json({ error: '删除版本文件失败' });
    }
  }
);

export default router;
