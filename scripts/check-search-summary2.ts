/**
 * 脚本：检查搜索总结保存问题 - 简化版本
 */

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'rss-tracker.db');
const db = new Database(dbPath);

// 查询所有 search 类型的总结数量
const count = db
  .prepare('SELECT COUNT(*) as count FROM daily_summaries WHERE summary_type = ?')
  .get('search') as { count: number };

console.log(`search 类型的总结数量: ${count.count}`);

// 查询所有类型总结数量
const allCount = db
  .prepare('SELECT summary_type, COUNT(*) as count FROM daily_summaries GROUP BY summary_type')
  .all();

console.log('\n各类型总结数量：');
console.table(allCount);

// 查询最近5条所有类型的总结
const recent = db
  .prepare('SELECT id, user_id, summary_date, summary_type, article_count, created_at FROM daily_summaries ORDER BY created_at DESC LIMIT 5')
  .all();

console.log('\n最近5条总结：');
console.table(recent);

db.close();
