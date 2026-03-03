import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();

  // 统计相关文章数量
  const stats = await db
    .selectFrom('articles')
    .leftJoin('article_related', 'article_related.article_id', 'articles.id')
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'completed')
    .select([
      'articles.source_origin',
      db.fn.count('article_related.article_id').as('related_count')
    ])
    .groupBy('articles.source_origin')
    .execute();

  console.log('=== 各来源文章的相关文章统计 ===');
  for (const s of stats) {
    console.log(`${s.source_origin}: ${s.related_count} 条相关记录`);
  }

  // 随机检查一篇 RSS 文章是否关联了期刊文章
  const rssToJournal = await db
    .selectFrom('article_related')
    .innerJoin('articles as a1', 'a1.id', 'article_related.article_id')
    .innerJoin('articles as a2', 'a2.id', 'article_related.related_article_id')
    .where('a1.source_origin', '=', 'rss')
    .where('a2.source_origin', '=', 'journal')
    .select(['a1.id as rss_id', 'a1.title as rss_title', 'a2.id as journal_id', 'a2.title as journal_title'])
    .limit(3)
    .execute();

  console.log('\n=== RSS 文章关联期刊文章示例 ===');
  for (const r of rssToJournal) {
    console.log(`RSS [${r.rss_id}] ${(r.rss_title || '').substring(0, 30)}...`);
    console.log(`  -> 期刊 [${r.journal_id}] ${(r.journal_title || '').substring(0, 30)}...`);
  }

  // 检查期刊文章是否关联了 RSS 文章
  const journalToRss = await db
    .selectFrom('article_related')
    .innerJoin('articles as a1', 'a1.id', 'article_related.article_id')
    .innerJoin('articles as a2', 'a2.id', 'article_related.related_article_id')
    .where('a1.source_origin', '=', 'journal')
    .where('a2.source_origin', '=', 'rss')
    .select(['a1.id as journal_id', 'a1.title as journal_title', 'a2.id as rss_id', 'a2.title as rss_title'])
    .limit(3)
    .execute();

  console.log('\n=== 期刊文章关联 RSS 文章示例 ===');
  for (const r of journalToRss) {
    console.log(`期刊 [${r.journal_id}] ${(r.journal_title || '').substring(0, 30)}...`);
    console.log(`  -> RSS [${r.rss_id}] ${(r.rss_title || '').substring(0, 30)}...`);
  }

  // 检查关键词文章是否关联了其他类型文章
  const keywordToOther = await db
    .selectFrom('article_related')
    .innerJoin('articles as a1', 'a1.id', 'article_related.article_id')
    .innerJoin('articles as a2', 'a2.id', 'article_related.related_article_id')
    .where('a1.source_origin', '=', 'keyword')
    .where('a2.source_origin', '!=', 'keyword')
    .select(['a1.id as keyword_id', 'a1.title as keyword_title', 'a2.id as other_id', 'a2.title as other_title', 'a2.source_origin as other_origin'])
    .limit(3)
    .execute();

  console.log('\n=== 关键词文章关联其他类型文章示例 ===');
  for (const r of keywordToOther) {
    console.log(`关键词 [${r.keyword_id}] ${(r.keyword_title || '').substring(0, 30)}...`);
    console.log(`  -> ${r.other_origin} [${r.other_id}] ${(r.other_title || '').substring(0, 30)}...`);
  }
}

main().catch(console.error);