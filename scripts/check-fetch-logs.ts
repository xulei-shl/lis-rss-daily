import { getDb } from '../src/db.js';

async function check() {
  const db = getDb();
  
  // Get recent RSS fetch logs
  const logs = await db
    .selectFrom('rss_fetch_logs')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(20)
    .execute();

  console.log('Recent RSS Fetch Logs:');
  console.log('Time | Status | RSS Source ID | Articles | New Articles');
  console.log('-----|--------|---------------|----------|--------------');

  for (const log of logs) {
    const time = log.created_at 
      ? new Date(log.created_at).toLocaleString('zh-CN')
      : 'N/A';
    console.log(`${time} | ${log.status} | ${log.rss_source_id} | ${log.articles_count} | ${log.new_articles_count}`);
  }

  await db.destroy();
}

check().catch(console.error);
