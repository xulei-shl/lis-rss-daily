import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();

  // 查询最近的10篇文章的 created_at
  const recent = await db
    .selectFrom('articles')
    .select(['id', 'source_origin', 'title', 'created_at'])
    .orderBy('created_at', 'desc')
    .limit(10)
    .execute();

  console.log('Recent articles created_at:');
  recent.forEach(r => {
    console.log('  -', r.source_origin, '|', r.created_at, '|', r.title?.substring(0, 40));
  });

  // 计算中国时区今天的开始时间
  const now = new Date();
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  console.log('\nToday local date (Asia/Shanghai):', todayLocal);

  // 简单计算：UTC时间 = 北京时间 - 8小时
  // 北京时间 2026-03-03 00:00:00 = UTC 2026-03-02 16:00:00
  const [year, month, day] = todayLocal.split('-').map(Number);
  const todayStartBeijing = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const todayStartUtc = new Date(todayStartBeijing.getTime() - 8 * 60 * 60 * 1000);

  console.log('Today start (Beijing):', todayStartBeijing.toISOString());
  console.log('Today start (UTC):', todayStartUtc.toISOString());

  const count = await db
    .selectFrom('articles')
    .where('created_at', '>=', todayStartUtc.toISOString())
    .select(eb => eb.fn.count('id').as('count'))
    .executeTakeFirst();

  console.log('\nArticles count:', count);

  // 按来源分组统计
  const bySource = await db
    .selectFrom('articles')
    .select(['source_origin'])
    .where('created_at', '>=', todayStartUtc.toISOString())
    .execute();

  console.log('By source:', bySource.reduce((acc, r) => {
    acc[r.source_origin] = (acc[r.source_origin] || 0) + 1;
    return acc;
  }, {}));
}

main().catch(console.error);
