import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();
  const articleId = 1800;
  
  console.log('测试简化后的查询...');
  
  try {
    // 使用简化后的查询逻辑
    let query = db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('article_translations', 'article_translations.article_id', 'articles.id')
      .where('articles.id', '=', articleId)
      .select([
        'articles.id',
        'articles.title',
        'articles.content',
        'articles.markdown_content',
        'articles.keyword_id',
        'articles.journal_id',
        'article_translations.title_zh',
        'article_translations.summary_zh',
        'rss_sources.user_id as rss_user_id',
      ]);

    const rows = await query.execute();
    console.log('基础查询成功！返回', rows.length, '行');
    
    // 获取期刊的 user_id
    const journalRows = await db
      .selectFrom('journals')
      .where('id', 'in', rows.filter(r => r.journal_id).map(r => r.journal_id!))
      .select(['id', 'user_id'])
      .execute();
    
    console.log('期刊查询成功！返回', journalRows.length, '行');
    
    const row = rows[0];
    const journalUserId = journalRows.find(j => j.id === row.journal_id)?.user_id;
    console.log('文章 ID:', row.id);
    console.log('标题:', row.title?.substring(0, 50));
    console.log('期刊 ID:', row.journal_id);
    console.log('期刊用户 ID:', journalUserId);
    
  } catch (error) {
    console.log('错误:', (error as any).message);
  }
}

main().catch(console.error);
