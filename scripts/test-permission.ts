import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();
  const userId = 1;

  // 模拟 buildUserArticlePermissionCondition
  const condition = (eb: any) => eb.or([
    eb.and([
      eb('articles.rss_source_id', 'is not', null),
      eb('rss_sources.user_id', '=', userId),
    ]),
    eb.and([
      eb('articles.journal_id', 'is not', null),
      eb('journals.user_id', '=', userId),
    ]),
    eb.and([
      eb('articles.keyword_id', 'is not', null),
      eb('keyword_subscriptions.user_id', '=', userId),
    ]),
  ]);

  const todayLocal = '2026-03-03';
  const [year, month, day] = todayLocal.split('-').map(Number);
  const todayStartBeijing = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const todayStartUtc = new Date(todayStartBeijing.getTime() - 8 * 60 * 60 * 1000);

  console.log('Today start UTC:', todayStartUtc.toISOString());

  // 查询所有今天的文章（不带权限检查）
  const allToday = await db
    .selectFrom('articles')
    .where('created_at', '>=', todayStartUtc.toISOString())
    .select(eb => eb.fn.count('id').as('count'))
    .executeTakeFirst();

  console.log('All articles (no permission check):', allToday);

  // 查询带权限检查的
  const withPermission = await db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .where(condition)
    .where('articles.created_at', '>=', todayStartUtc.toISOString())
    .select(eb => eb.fn.count('articles.id').as('count'))
    .executeTakeFirst();

  console.log('With permission check:', withPermission);

  // 检查关键词订阅的 user_id
  const keywords = await db
    .selectFrom('keyword_subscriptions')
    .selectAll()
    .execute();

  console.log('\nKeyword subscriptions:');
  keywords.forEach(k => {
    console.log(`  ID: ${k.id}, User: ${k.user_id}, Keyword: ${k.keyword}`);
  });

  // 检查今天的关键词文章
  const keywordArticles = await db
    .selectFrom('articles')
    .innerJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .select(['articles.id', 'articles.title', 'articles.keyword_id', 'keyword_subscriptions.user_id as kw_user_id'])
    .where('articles.created_at', '>=', todayStartUtc.toISOString())
    .limit(5)
    .execute();

  console.log('\nToday keyword articles with subscription user_id:');
  keywordArticles.forEach(a => {
    console.log(`  Article ${a.id}, keyword_id ${a.keyword_id}, kw_user_id ${a.kw_user_id}`);
  });
}

main().catch(console.error);
