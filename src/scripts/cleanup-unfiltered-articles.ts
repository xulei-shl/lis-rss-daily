/**
 * 清理滞留的未过滤文章
 *
 * == 用途 ==
 * 对因各种异常（process.nextTick() 未执行、filterArticle() 中途抛异常等）
 * 而未经过滤的文章执行补过滤。这类文章的特征是：
 *   - filter_status = 'pending'
 *   - 不在 article_filter_logs 表中（没有任何过滤日志）
 *
 * == 什么时候需要使用 ==
 * 正常情况下不需要手动运行，因为 filterArticle() 已加固（静态 import + try-catch 兜底日志）。
 * 但在以下场景可能需要补跑：
 *
 * 1. 代码升级后发现有历史遗留的未过滤文章（如本次修复前遗留的 17 篇）
 * 2. 系统异常重启导致 process.nextTick() 回调未执行
 * 3. 数据库迁移或数据恢复后需要重新过滤
 * 4. 定期巡检：可以每月/每季度跑一次，确保没有文章遗漏过滤
 *
 * == 运行方式 ==
 *   cd /opt/lis-rss-daily
 *   npx tsx src/scripts/cleanup-unfiltered-articles.ts
 *
 * == 执行逻辑 ==
 * 1. 查询所有 filter_status='pending' 且无 filter_log 的文章
 * 2. 依次调用 filterArticle() 进行黑名单检查 + LLM 评估
 * 3. 通过的继续执行 processArticle()（翻译→向量化→相关文章）
 * 4. 拒绝的标记为 rejected
 * 5. 失败的不影响其他文章
 *
 * == 注意事项 ==
 * - 单用户系统，固定使用 userId=1
 * - 会消耗 LLM API 调用额度（每篇文章一次过滤调用 + 通过后的一次翻译调用）
 * - 幂等安全：filterArticle() 内部有 WHERE filter_status='pending' 保护，
 *   已过滤的文章不会被重复处理
 */

import { getDb } from '../db.js';
import { filterArticle, type FilterInput } from '../filter.js';
import { processArticle } from '../pipeline.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'cleanup-unfiltered' });

async function main() {
  const db = getDb();

  // 查找所有 filter_status='pending' 且没有 filter_log 记录的文章
  const articles = await db
    .selectFrom('articles')
    .selectAll()
    .where('filter_status', '=', 'pending')
    .where('id', 'not in',
      db.selectFrom('article_filter_logs').select('article_id')
    )
    .execute();

  log.info({ total: articles.length }, 'Found unfiltered articles');

  if (articles.length === 0) {
    log.info('No unfiltered articles found, exiting');
    return;
  }

  let passed = 0;
  let rejected = 0;
  let failed = 0;

  for (const article of articles) {
    try {
      const filterInput: FilterInput = {
        articleId: article.id,
        userId: 1, // 单用户系统
        title: article.title,
        url: article.url || undefined,
        description: article.summary || article.content || '',
        content: article.content || undefined,
        sourceType: article.source_origin as any,
      };

      log.info({ articleId: article.id, title: article.title?.substring(0, 60) }, 'Running filter on stranded article');
      const result = await filterArticle(filterInput);

      if (result.passed) {
        passed++;
        log.info({ articleId: article.id }, 'Article passed filter, starting pipeline');
        // 通过过滤后自动执行后续流程
        await processArticle(article.id, 1);
        log.info({ articleId: article.id }, 'Pipeline completed');
      } else {
        rejected++;
        log.info({ articleId: article.id, reason: result.filterReason }, 'Article rejected by filter');
      }
    } catch (error) {
      failed++;
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error({ articleId: article.id, error: errMsg }, 'Cleanup filter failed');
    }
  }

  log.info(
    { total: articles.length, passed, rejected, failed },
    'Cleanup completed'
  );
}

main()
  .then(() => {
    log.info('Script finished');
    process.exit(0);
  })
  .catch((err) => {
    log.error({ err }, 'Script failed');
    process.exit(1);
  });
