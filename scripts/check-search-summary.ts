/**
 * 脚本：检查搜索总结保存问题
 */

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'rss-tracker.db');
const db = new Database(dbPath);

// 查询表结构
const tableInfo = db.pragma('table_info(daily_summaries)');
console.log('daily_summaries 表结构：');
console.table(tableInfo);

// 查询所有 search 类型的总结
console.log('\n所有 search 类型的总结：');
const searchSummaries = db
  .prepare('SELECT * FROM daily_summaries WHERE summary_type = ? ORDER BY created_at DESC LIMIT 10')
  .all('search');

if (searchSummaries.length === 0) {
  console.log('没有找到 search 类型的总结');
} else {
  console.table(searchSummaries);
}

// 查询所有类型的总结（最近10条）
console.log('\n所有类型的最近10条总结：');
const allSummaries = db
  .prepare('SELECT id, user_id, summary_date, summary_type, article_count, created_at FROM daily_summaries ORDER BY created_at DESC LIMIT 10')
  .all();

console.table(allSummaries);

// 检查索引
console.log('\ndaily_summaries 相关索引：');
const indexes = db.pragma('index_list(daily_summaries)');
console.table(indexes);

// 检查唯一约束
console.log('\n检查 daily_summaries 表的唯一约束（UNIQUE(user_id, summary_date, summary_type)）：');
const duplicateCheck = db
  .prepare(`
    SELECT user_id, summary_date, summary_type, COUNT(*) as count
    FROM daily_summaries
    GROUP BY user_id, summary_date, summary_type
    HAVING count > 1
  `)
  .all();

if (duplicateCheck.length === 0) {
  console.log('没有发现重复记录');
} else {
  console.log('发现重复记录：');
  console.table(duplicateCheck);
}

db.close();
