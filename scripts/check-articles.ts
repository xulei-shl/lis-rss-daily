import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();
  const articles = await db
    .selectFrom('articles')
    .where('filter_status', '=', 'passed')
    .select(['id', 'title', 'source_origin', 'process_status', 'created_at'])
    .orderBy('created_at', 'desc')
    .limit(15)
    .execute();

  console.log('最近 15 篇通过过滤的文章：\n');
  for (const article of articles) {
    const source = article.source_origin === 'journal' ? '期刊' :
                  article.source_origin === 'keyword' ? '关键词' : 'RSS';
    console.log(`[${article.id}] ${source} | ${article.process_status} | ${article.title.substring(0, 45)}...`);
  }
}

main().catch(console.error);
