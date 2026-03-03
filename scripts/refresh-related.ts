/**
 * 更新文章的相关文章缓存
 *
 * 用法：
 *   npx tsx scripts/refresh-related.ts [options]
 *
 * 选项：
 *   --limit <n>         限制处理数量（默认：50）
 *   --article-id <id>   只处理指定文章 ID
 *   --from-id <id>      从指定 ID 开始（用于批量处理）
 *   --dry-run           只显示将要处理的文章，不实际执行
 *
 * 示例：
 *   # 更新最近 50 篇文章的相关文章
 *   npx tsx scripts/refresh-related.ts --limit 50
 *
 *   # 更新指定文章
 *   npx tsx scripts/refresh-related.ts --article-id 1766
 *
 *   # 批量更新（从 ID 1650 开始）
 *   npx tsx scripts/refresh-related.ts --from-id 1650 --limit 100
 */

import { getDb } from '../src/db.js';
import { refreshRelatedArticles } from '../src/api/articles.js';

interface ArticleInfo {
  id: number;
  title: string;
  source_origin: string;
}

async function getArticles(limit: number, articleId?: number, fromId?: number): Promise<ArticleInfo[]> {
  const db = getDb();

  let query = db
    .selectFrom('articles')
    .where('filter_status', '=', 'passed')
    .where('process_status', '=', 'completed')
    .select(['id', 'title', 'source_origin'])
    .orderBy('id', 'desc')
    .limit(limit);

  if (articleId) {
    query = query.where('id', '=', articleId) as any;
  } else if (fromId) {
    query = query.where('id', '>=', fromId) as any;
  }

  return await query.execute();
}

async function main() {
  const args = process.argv.slice(2);

  let limit = 50;
  let articleId: number | undefined;
  let fromId: number | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--article-id' && args[i + 1]) {
      articleId = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--from-id' && args[i + 1]) {
      fromId = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  console.log('='.repeat(60));
  console.log('更新相关文章缓存');
  console.log('='.repeat(60));
  console.log(`限制数量: ${limit}`);
  console.log(`干运行: ${dryRun ? '是' : '否'}`);
  if (articleId) console.log(`指定文章 ID: ${articleId}`);
  if (fromId) console.log(`起始 ID: ${fromId}`);
  console.log('');

  // 获取文章列表
  const articles = await getArticles(limit, articleId, fromId);

  if (articles.length === 0) {
    console.log('没有找到符合条件的文章');
    return;
  }

  console.log(`找到 ${articles.length} 篇文章需要更新相关文章：`);
  console.log('-'.repeat(60));

  for (const article of articles) {
    const sourceLabel = article.source_origin === 'journal' ? '期刊' :
                        article.source_origin === 'keyword' ? '关键词' : 'RSS';
    console.log(`[${article.id}] ${article.title.substring(0, 50)}... (${sourceLabel})`);
  }

  console.log('-'.repeat(60));

  if (dryRun) {
    console.log('\n干运行模式，不执行实际操作');
    return;
  }

  console.log('\n开始更新相关文章...');

  let successCount = 0;
  let failedCount = 0;

  for (const article of articles) {
    try {
      // 假设用户 ID 为 1
      await refreshRelatedArticles(article.id, 1, 5);
      successCount++;
      console.log(`✓ [${article.id}] 更新成功`);
    } catch (error) {
      failedCount++;
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log(`✗ [${article.id}] 更新失败: ${errMsg}`);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`完成！成功: ${successCount}, 失败: ${failedCount}`);
  console.log('='.repeat(60));
}

main().catch(console.error);