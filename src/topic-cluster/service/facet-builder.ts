/**
 * 切面构建：全文总结 → 切面 → 向量 → 落库。
 *
 * 这是模块的入口环节，也是唯一会产生大量 LLM 调用与 embedding 调用的地方。
 *
 * 性能约束（设计文档 §15.3 I2）：better-sqlite3 是同步驱动，
 * 因此**绝不在循环内逐篇写库**——先全部算完（内存中），最后批量事务落库。
 */

import { logger } from '../../logger.js';
import { CLUSTER_CONFIG } from '../config.js';
import { buildFacetText, resolveEventDate, type DatePrecision } from '../domain/facet.js';
import { listOffVocabularyTerms } from '../domain/vocab.js';
import { embedFacetTexts } from '../embedding.js';
import { extractFacet } from '../llm/facet-extract.js';
import { type FacetInsertRow, upsertFacetsBatch, listArticleIdsWithFacet } from '../repo/facets.js';
import type { FacetSourceArticle } from '../source.js';
import { mapWithConcurrency } from '../util/pool.js';

const log = logger.child({ module: 'topic-cluster/facet-builder' });

export interface FacetBuildOutcome {
  articleId: number;
  status: 'ok' | 'failed';
  error?: string;
}

export interface FacetBuildSummary {
  requested: number;
  skippedExisting: number;
  succeeded: number;
  failed: number;
  outcomes: FacetBuildOutcome[];
}

/**
 * 为一批文章构建切面。
 *
 * @param articles 已确认「有全文总结」的文章
 * @returns 逐篇结果；失败篇目在下一轮自动重试（因为切面缺失即会被重新选中）
 */
export async function buildFacetsForArticles(
  articles: FacetSourceArticle[],
  userId: number
): Promise<FacetBuildSummary> {
  const summary: FacetBuildSummary = {
    requested: articles.length,
    skippedExisting: 0,
    succeeded: 0,
    failed: 0,
    outcomes: [],
  };
  if (articles.length === 0) return summary;

  // 已有合格切面的跳过（避免重复花 token）
  const ready = await listArticleIdsWithFacet(articles.map((article) => article.articleId));
  const pending = articles.filter((article) => !ready.has(article.articleId));
  summary.skippedExisting = articles.length - pending.length;
  if (pending.length === 0) return summary;

  // 第一步：LLM 抽切面（并发受限）
  const extracted = await mapWithConcurrency(
    pending,
    CLUSTER_CONFIG.llmConcurrency,
    async (article) => {
      try {
        const facet = await extractFacet({
          userId,
          articleId: article.articleId,
          title: article.title,
          aiSummary: article.aiSummary,
        });
        return { article, facet, error: null as string | null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { article, facet: null, error: message };
      }
    }
  );

  const succeeded = extracted.filter((item) => item.facet !== null);
  const failedItems = extracted.filter((item) => item.facet === null);

  for (const item of failedItems) {
    summary.outcomes.push({ articleId: item.article.articleId, status: 'failed', error: item.error ?? '未知错误' });
  }
  summary.failed = failedItems.length;

  if (failedItems.length > 0) {
    log.warn(
      { failed: failedItems.length, total: pending.length, sample: failedItems[0]?.error },
      '部分文章切面抽取失败，将在下一轮重试'
    );
  }

  if (succeeded.length === 0) return summary;

  // 词表外表述汇总告警（一次/批，不逐篇打日志）：
  // 稳定出现即说明提示词词表或别名词表需要扩充，是提示词漂移的最早信号。
  const offVocabulary = listOffVocabularyTerms(succeeded.map((item) => item.facet!));
  if (offVocabulary.terms.length > 0) {
    log.warn(
      {
        articles: offVocabulary.articleCount,
        total: succeeded.length,
        terms: offVocabulary.terms.slice(0, 8).map((item) => `${item.kind}:${item.term}(${item.count})`),
      },
      '切面出现词表外表述，已排除于矩阵与熵统计（需考虑扩充词表/别名）'
    );
  }

  // 第二步：批量 embedding（一次 HTTP 请求覆盖多篇）
  const texts = succeeded.map((item) => buildFacetText(item.facet!));
  const embeddings = await embedFacetTexts(texts, userId);

  // 第三步：组装落库行
  const rows: FacetInsertRow[] = [];
  for (let i = 0; i < succeeded.length; i += 1) {
    const { article, facet } = succeeded[i];
    const embedding = embeddings[i];
    if (!embedding) {
      summary.outcomes.push({ articleId: article.articleId, status: 'failed', error: 'embedding 缺失' });
      summary.failed += 1;
      continue;
    }

    const { eventDate, precision } = resolveEventDate({
      published_at: article.publishedAt,
      published_year: article.publishedYear,
      created_at: article.createdAt,
    });

    rows.push({
      articleId: article.articleId,
      userId,
      facetJson: JSON.stringify(facet),
      facetText: texts[i],
      facetContractVersion: CLUSTER_CONFIG.facetContractVersion,
      embedding: embedding.blob,
      embeddingModel: embedding.model,
      embeddingDim: embedding.dim,
      eventDate,
      datePrecision: precision as DatePrecision,
    });
    summary.outcomes.push({ articleId: article.articleId, status: 'ok' });
    summary.succeeded += 1;
  }

  // 第四步：一次事务批量落库（避免同步驱动逐行写阻塞事件循环）
  await upsertFacetsBatch(rows);

  log.info(
    { succeeded: summary.succeeded, failed: summary.failed, skipped: summary.skippedExisting },
    '切面构建完成'
  );
  return summary;
}
