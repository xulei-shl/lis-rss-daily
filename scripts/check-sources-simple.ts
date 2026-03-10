import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();
  
  const rss = await db.selectFrom('rss_sources').where('is_active', '=', 1).select(['id', 'name']).limit(1).execute();
  const keywords = await db.selectFrom('keyword_subscriptions').where('is_active', '=', 1).select(['id', 'name']).limit(1).execute();
  const journals = await db.selectFrom('journals').where('is_active', '=', 1).select(['id', 'name']).limit(1).execute();

  console.log('可用的测试源：');
  console.log('RSS:', rss.map(r => `${r.id}:${r.name}`).join(', ') || '无');
  console.log('关键词:', keywords.map(k => `${k.id}:${k.name}`).join(', ') || '无');
  console.log('期刊:', journals.map(j => `${j.id}:${j.name}`).join(', ') || '无');
}

main().catch(console.error);
