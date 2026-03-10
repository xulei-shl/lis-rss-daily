import { getDb } from '../src/db.js';

async function main() {
  const db = getDb();
  const articleId = 1800;
  const userId = 1;
  
  console.log('测试查询...');
  
  try {
    // 复制 loadArticles 的查询逻辑
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

    query = query.where((eb) =>
      eb.or([
        eb('rss_sources.user_id', '=', userId),
        eb.exists(
          eb.selectFrom('keyword_subscriptions')
            .whereRef('keyword_subscriptions.id', '=', 'articles.keyword_id')
            .where('keyword_subscriptions.user_id', '=', userId)
        ),
        eb.exists(
          eb.selectFrom('journals')
            .whereRef('journals.id', '=', 'articles.journal_id')
            .where('journals.user_id', '=', userId)
        )
      ])
    ) as any;

    const rows = await query.execute();
    console.log('查询成功！返回', rows.length, '行');
    console.log('数据:', JSON.stringify(rows[0], null, 2).substring(0, 500));
    
  } catch (error) {
    console.log('错误类型:', error.constructor.name);
    console.log('错误消息:', (error as any).message);
    console.log('错误代码:', (error as any).code);
    console.log('堆栈:', (error as any).stack?.substring(0, 500));
  }
}

main().catch(console.error);
