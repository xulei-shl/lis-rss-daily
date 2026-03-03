import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();
  const articleId = parseInt(process.argv[2] || '1766', 10);

  // 查询文章状态
  const article = await db
    .selectFrom('articles')
    .where('id', '=', articleId)
    .select(['id', 'title', 'process_status', 'process_stages', 'source_origin'])
    .executeTakeFirst();

  if (!article) {
    console.log(`文章 ${articleId} 不存在`);
    return;
  }

  console.log('=== 文章状态 ===');
  console.log('ID:', article.id);
  console.log('标题:', article.title);
  console.log('来源:', article.source_origin);
  console.log('处理状态:', article.process_status);
  console.log('阶段状态:', article.process_stages);

  // 解析阶段状态
  if (article.process_stages) {
    const stages = JSON.parse(article.process_stages);
    console.log('\n阶段详情:');
    console.log('  - markdown:', stages.markdown);
    console.log('  - translate:', stages.translate);
    console.log('  - vector:', stages.vector);
    console.log('  - related:', stages.related);
  }

  // 查询相关文章
  const related = await db
    .selectFrom('article_related')
    .where('article_id', '=', articleId)
    .innerJoin('articles as a', 'a.id', 'article_related.related_article_id')
    .select(['article_related.related_article_id', 'article_related.score', 'a.title'])
    .orderBy('article_related.score', 'desc')
    .execute();

  console.log('\n=== 相关文章 ===');
  console.log('数量:', related.length);
  related.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.related_article_id}] ${(r.title || '').substring(0, 40)}... (分数: ${r.score?.toFixed(3)})`);
  });
}

main().catch(console.error);