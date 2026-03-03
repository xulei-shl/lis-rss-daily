/**
 * 修复关键词订阅文章的 created_at 字段
 * 问题：之前插入的关键词文章没有显式设置 created_at，导致统计不准确
 */

import { getDb } from '../src/db.js';

async function fixKeywordArticlesCreatedAt() {
  const db = getDb();

  // 查找所有关键词订阅且 created_at 为 null 的文章
  const articles = await db
    .selectFrom('articles')
    .where('keyword_id', 'is not', null)
    .where('created_at', 'is', null)
    .selectAll()
    .execute();

  console.log(`找到 ${articles.length} 篇需要修复的关键词文章`);

  if (articles.length === 0) {
    console.log('没有需要修复的文章');
    return;
  }

  // 批量更新这些文章的 created_at
  for (const article of articles) {
    const now = new Date().toISOString();
    await db
      .updateTable('articles')
      .set({ created_at: now })
      .where('id', '=', article.id)
      .execute();
    console.log(`修复文章 ${article.id}: ${article.title}`);
  }

  console.log(`成功修复 ${articles.length} 篇文章`);
}

fixKeywordArticlesCreatedAt()
  .then(() => {
    console.log('修复完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('修复失败:', error);
    process.exit(1);
  });
