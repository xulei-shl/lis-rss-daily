import { getUserTimezone, buildUtcRangeFromLocalDate } from '../src/api/timezone.js';
import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();
  const userId = 1;

  // 模拟统计查询的逻辑
  const userTimezone = await getUserTimezone(userId);
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: userTimezone });
  const [todayStartUtc] = buildUtcRangeFromLocalDate(todayLocal, userTimezone);

  console.log('User timezone:', userTimezone);
  console.log('Today local date:', todayLocal);
  console.log('Today start UTC:', todayStartUtc);

  // 查询文章数量
  const result = await db
    .selectFrom('articles')
    .where('created_at', '>=', todayStartUtc)
    .select(eb => eb.fn.count('id').as('count'))
    .executeTakeFirst();

  console.log('Articles count:', result);

  // 查询最近的文章时间
  const recent = await db
    .selectFrom('articles')
    .select(['created_at'])
    .orderBy('created_at', 'desc')
    .limit(5)
    .execute();

  console.log('\nRecent created_at values:');
  recent.forEach(r => {
    console.log('  ', r.created_at, '>=', todayStartUtc, '?', r.created_at >= todayStartUtc);
  });
}

main().catch(console.error);
