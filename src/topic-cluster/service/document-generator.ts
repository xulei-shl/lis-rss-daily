/**
 * 主题洞察版本文件生成。
 *
 * 每轮「分析 → 综述 → 洞察」成功后调用：对每个本轮有内容的主题
 * 读取一次完整详情，渲染成自包含 HTML 写入 data/cluster-documents/，
 * 并在 cluster_topic_documents 记一行元数据（版本号按主题递增）。
 *
 * 内容哈希用于幂等：同一主题内容没有实质变化时不会重复产出文件。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import type { ClusterTopicDocumentsSelection } from '../../db.js';
import { CLUSTER_CONFIG } from '../config.js';
import { getTopicDetail, type TopicDetail } from '../query.js';
import {
  getLatestTopicDocument,
  insertTopicDocument,
} from '../repo/documents.js';
import { renderClusterDocumentHtml } from '../document-renderer.js';

const log = logger.child({ module: 'topic-cluster/document-generator' });

const DOCUMENTS_DIR = path.join(path.dirname(config.databasePath), 'cluster-documents');

export function getTopicDocumentFilePath(filename: string): string {
  return path.join(DOCUMENTS_DIR, path.basename(filename));
}

export interface DocumentGenerationSummary {
  generated: number;
  skipped: number;
  failed: number;
  documents: ClusterTopicDocumentsSelection[];
}

/**
 * 为主题生成一份版本文件。
 *
 * @returns 新生成的文档；内容未变化、主题不存在或分析失败时返回 null。
 */
export async function generateTopicDocument(
  topicId: number
): Promise<ClusterTopicDocumentsSelection | null> {
  const detail = await getTopicDetail(String(topicId));
  if (!detail) return null;
  if (detail.analysisStatus === 'missing' || detail.analysisStatus === 'failed') {
    return null;
  }

  const contentHash = computeContentHash(detail);
  const latest = await getLatestTopicDocument(topicId);
  if (latest && latest.content_hash === contentHash) return null;

  const version = (latest?.version ?? 0) + 1;
  const createdAt = new Date();
  const generatedAtLabel = createdAt.toLocaleString('zh-CN', {
    timeZone: config.defaultTimezone || 'Asia/Shanghai',
    hour12: false,
  });
  const filename = buildFilename(detail.slug, version, createdAt);

  const html = renderClusterDocumentHtml(detail, { version, generatedAtLabel });
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  fs.writeFileSync(getTopicDocumentFilePath(filename), html, 'utf-8');

  const id = await insertTopicDocument({
    userId: CLUSTER_CONFIG.userId,
    setVersion: detail.setVersion,
    topicId: detail.id,
    version,
    filename,
    sizeBytes: Buffer.byteLength(html, 'utf-8'),
    contentHash,
  });

  return {
    id,
    user_id: CLUSTER_CONFIG.userId,
    set_version: detail.setVersion,
    topic_id: detail.id,
    version,
    filename,
    size_bytes: Buffer.byteLength(html, 'utf-8'),
    content_hash: contentHash,
    created_at: createdAt.toISOString(),
  };
}

/** 批量生成；单个主题失败不影响其他主题。 */
export async function generateTopicDocuments(
  topicIds: Iterable<number>
): Promise<DocumentGenerationSummary> {
  const uniqueIds = [...new Set(topicIds)];
  const summary: DocumentGenerationSummary = {
    generated: 0,
    skipped: 0,
    failed: 0,
    documents: [],
  };

  for (const topicId of uniqueIds) {
    try {
      const document = await generateTopicDocument(topicId);
      if (document) {
        summary.generated += 1;
        summary.documents.push(document);
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      log.warn({ topicId, error: message }, '主题洞察版本文件生成失败');
    }
  }

  if (summary.generated > 0 || summary.failed > 0) {
    log.info(
      { generated: summary.generated, skipped: summary.skipped, failed: summary.failed },
      '主题洞察版本文件生成完成'
    );
  }

  return summary;
}

/** 内容哈希只覆盖会进入文件的内容，避免 runLogs / 更新时间造成伪变化。 */
function computeContentHash(detail: TopicDetail): string {
  const content = {
    name: detail.name,
    keywords: detail.keywords,
    status: detail.status,
    linkedCount: detail.linkedCount,
    primaryCount: detail.primaryCount,
    firstEventDate: detail.firstEventDate,
    lastEventDate: detail.lastEventDate,
    analysisStatus: detail.analysisStatus,
    analysis: detail.analysis,
    matrix: detail.matrix,
    angles: detail.angles,
    looseArticles: detail.looseArticles,
    metrics: detail.metrics,
    adjacent: detail.adjacent,
    reviews: detail.reviews,
    insights: detail.insights,
    evidenceArticles: detail.evidenceArticles,
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function buildFilename(slug: string, version: number, createdAt: Date): string {
  // 文件名使用与页面一致的本地时区，避免用户看到的生成时间与文件名不一致。
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.defaultTimezone || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(createdAt);
  const stamp = local.replace(/[-:]/g, '').replace(' ', '-');
  const safeSlug = slug.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'topic';
  return `${safeSlug}-v${version}-${stamp}.html`;
}
