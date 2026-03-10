import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();
  
  // 检查最新的 5 篇文章
  const articles = await db
    .selectFrom('articles')
    .select(['id', 'title', 'process_status', 'process_stages', 'filter_status', 'created_at'])
    .orderBy('id', 'desc')
    .limit(10)
    .execute();

  console.log('最新 10 篇文章状态：\n');
  
  for (const article of articles) {
    const stages = article.process_stages ? JSON.parse(article.process_stages) : {};
    const created = new Date(article.created_at).toLocaleTimeString('zh-CN');
    console.log(`[${article.id}] ${created} | filter=${article.filter_status}, process=${article.process_status}`);
    console.log(`       stages: md=${stages.markdown}, trans=${stages.translate}, vec=${stages.vector}, rel=${stages.related}`);
    console.log(`       title: ${article.title?.substring(0, 45)}...`);
    console.log('');
  }
}

main().catch(console.error);
