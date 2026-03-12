/**
 * 脚本：检查搜索总结详细信息
 */

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'rss-tracker.db');
const db = new Database(dbPath);

// 查询所有 search 类型的总结详细信息
const summaries = db
  .prepare(`
    SELECT id, user_id, summary_date, summary_type, article_count,
           length(summary_content) as content_length,
           length(articles_data) as data_length,
           created_at
    FROM daily_summaries
    WHERE summary_type = ?
    ORDER BY created_at DESC
  `)
  .all('search');

console.log('search 类型总结详细信息：');
console.table(summaries);

// 查看第一条的 articles_data 内容
const firstSummary = db
  .prepare(`
    SELECT articles_data FROM daily_summaries
    WHERE summary_type = ?
    ORDER BY created_at DESC
    LIMIT 1
  `)
  .get('search') as { articles_data: string } | undefined;

if (firstSummary) {
  console.log('\n最新 search 总结的 articles_data (前500字符):');
  console.log(firstSummary.articles_data.substring(0, 500));
}

db.close();
