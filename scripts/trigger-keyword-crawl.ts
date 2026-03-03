/**
 * 触发关键词爬取
 * 用法: pnpm run trigger-crawl <keywordId>
 */

import { crawlKeyword } from '../src/api/keywords.js';

const keywordId = parseInt(process.argv[2]);

if (!keywordId || isNaN(keywordId)) {
  console.error('请提供有效的关键词ID');
  process.exit(1);
}

console.log(`触发关键词爬取，ID: ${keywordId}`);

try {
  const result = await crawlKeyword(keywordId);

  if (result.success) {
    console.log('✅ 爬取成功!');
    console.log(`   文章总数: ${result.articlesCount}`);
    console.log(`   新增文章: ${result.newArticlesCount}`);
  } else {
    console.error('❌ 爬取失败:', result.error);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ 错误:', error);
  process.exit(1);
}
