/**
 * 重新向量化文章脚本
 *
 * 用法：
 *   npx tsx scripts/reindex-articles.ts [options]
 *
 * 选项：
 *   --status <status>   筛选状态：failed, processing, pending, all（默认：failed）
 *   --limit <n>         限制处理数量（默认：50）
 *   --dry-run           只显示将要处理的文章，不实际执行
 *   --article-id <id>   只处理指定文章 ID
 *   --with-related      同时更新相关文章
 *
 * 示例：
 *   # 重新向量化所有失败的文章
 *   npx tsx scripts/reindex-articles.ts --status failed
 *
 *   # 重新向量化卡在 processing 的文章，同时更新相关文章
 *   npx tsx scripts/reindex-articles.ts --status processing --with-related
 *
 *   # 重新向量化指定文章
 *   npx tsx scripts/reindex-articles.ts --article-id 123
 */

import { getDb } from '../src/db.js';
import { indexArticles, type IndexResult } from '../src/vector/indexer.js';
import { refreshRelatedArticles } from '../src/api/articles.js';
import { logger } from '../src/logger.js';

const log = logger.child({ module: 'reindex-articles' });

interface ArticleInfo {
  id: number;
  title: string;
  source_origin: string;
  vector_status: string;
  process_stages: string | null;
}

async function getArticlesToReindex(
  status: string,
  limit: number,
  articleId?: number
): Promise<ArticleInfo[]> {
  const db = getDb();

  if (articleId) {
    const article = await db
      .selectFrom('articles')
      .where('id', '=', articleId)
      .select(['id', 'title', 'source_origin', 'process_stages'])
      .executeTakeFirst();

    if (!article) {
      console.log(`文章 ID ${articleId} 不存在`);
      return [];
    }

    const stages = article.process_stages ? JSON.parse(article.process_stages) : {};
    return [{
      id: article.id,
      title: article.title,
      source_origin: article.source_origin,
      vector_status: stages.vector || 'pending',
      process_stages: article.process_stages,
    }];
  }

  // 查询所有文章并筛选
  const articles = await db
    .selectFrom('articles')
    .where('filter_status', '=', 'passed')
    .where('process_status', 'in', ['completed', 'failed', 'processing'])
    .select(['id', 'title', 'source_origin', 'process_stages'])
    .orderBy('id', 'desc')
    .limit(1000)
    .execute();

  const filtered = articles.filter(article => {
    const stages = article.process_stages ? JSON.parse(article.process_stages) : {};
    const vectorStatus = stages.vector || 'pending';

    if (status === 'all') return true;
    if (status === 'failed' && vectorStatus === 'failed') return true;
    if (status === 'processing' && vectorStatus === 'processing') return true;
    if (status === 'pending' && (vectorStatus === 'pending' || !stages.vector)) return true;
    return false;
  });

  return filtered.slice(0, limit).map(article => {
    const stages = article.process_stages ? JSON.parse(article.process_stages) : {};
    return {
      id: article.id,
      title: article.title,
      source_origin: article.source_origin,
      vector_status: stages.vector || 'pending',
      process_stages: article.process_stages,
    };
  });
}

async function updateVectorStatus(articleId: number, status: string): Promise<void> {
  const db = getDb();

  const article = await db
    .selectFrom('articles')
    .where('id', '=', articleId)
    .select('process_stages')
    .executeTakeFirst();

  if (!article) return;

  const stages = article.process_stages ? JSON.parse(article.process_stages) : {
    markdown: 'pending',
    translate: 'pending',
    vector: 'pending',
    related: 'pending',
  };

  stages.vector = status;

  await db
    .updateTable('articles')
    .set({
      process_stages: JSON.stringify(stages),
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', articleId)
    .execute();
}

async function main() {
  const args = process.argv.slice(2);

  let status = 'failed';
  let limit = 50;
  let dryRun = false;
  let articleId: number | undefined;
  let withRelated = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status' && args[i + 1]) {
      status = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--article-id' && args[i + 1]) {
      articleId = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--with-related') {
      withRelated = true;
    }
  }

  console.log('='.repeat(60));
  console.log('重新向量化文章');
  console.log('='.repeat(60));
  console.log(`筛选状态: ${status}`);
  console.log(`限制数量: ${limit}`);
  console.log(`干运行: ${dryRun ? '是' : '否'}`);
  console.log(`更新相关文章: ${withRelated ? '是' : '否'}`);
  if (articleId) console.log(`指定文章 ID: ${articleId}`);
  console.log('');

  // 获取文章列表
  const articles = await getArticlesToReindex(status, limit, articleId);

  if (articles.length === 0) {
    console.log('没有找到符合条件的文章');
    return;
  }

  console.log(`找到 ${articles.length} 篇文章需要重新向量化：`);
  console.log('-'.repeat(60));

  for (const article of articles) {
    const sourceLabel = article.source_origin === 'journal' ? '期刊' :
                        article.source_origin === 'keyword' ? '关键词' : 'RSS';
    console.log(`[${article.id}] ${article.title.substring(0, 50)}... (${sourceLabel}, 向量状态: ${article.vector_status})`);
  }

  console.log('-'.repeat(60));

  if (dryRun) {
    console.log('\n干运行模式，不执行实际操作');
    return;
  }

  console.log('\n开始重新向量化...');

  // 重置状态并重新向量化
  const articleIds = articles.map(a => a.id);

  // 先重置所有文章的向量化状态为 pending
  for (const id of articleIds) {
    await updateVectorStatus(id, 'pending');
  }

  // 执行向量化
  let successCount = 0;
  let failedCount = 0;
  const successIds: number[] = [];

  await new Promise<void>((resolve) => {
    indexArticles(articleIds, undefined, (result: IndexResult) => {
      if (result.success) {
        successCount++;
        successIds.push(result.articleId);
        updateVectorStatus(result.articleId, 'completed').catch(() => {});
        console.log(`✓ [${result.articleId}] 向量化成功`);
      } else {
        failedCount++;
        updateVectorStatus(result.articleId, 'failed').catch(() => {});
        console.log(`✗ [${result.articleId}] 向量化失败: ${result.error}`);
      }

      if (successCount + failedCount === articleIds.length) {
        resolve();
      }
    });
  });

  // 更新相关文章
  if (withRelated && successIds.length > 0) {
    console.log('\n开始更新相关文章...');
    let relatedSuccess = 0;
    let relatedFailed = 0;

    for (const id of successIds) {
      try {
        // 假设用户 ID 为 1（与关键词文章处理一致）
        await refreshRelatedArticles(id, 1, 5);
        relatedSuccess++;
        console.log(`✓ [${id}] 相关文章更新成功`);
      } catch (error) {
        relatedFailed++;
        console.log(`✗ [${id}] 相关文章更新失败: ${error}`);
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`向量化完成！成功: ${successCount}, 失败: ${failedCount}`);
    console.log(`相关文章更新完成！成功: ${relatedSuccess}, 失败: ${relatedFailed}`);
    console.log('='.repeat(60));
  } else {
    console.log('');
    console.log('='.repeat(60));
    console.log(`完成！成功: ${successCount}, 失败: ${failedCount}`);
    if (!withRelated) {
      console.log('提示: 使用 --with-related 选项可同时更新相关文章');
    }
    console.log('='.repeat(60));
  }
}

main().catch(console.error);