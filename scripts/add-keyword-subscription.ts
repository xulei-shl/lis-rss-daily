/**
 * 添加关键词订阅
 * 用法: pnpm run add-keyword "关键词"
 */

import Database from 'better-sqlite3';
import { config } from '../src/config.js';

const keyword = process.argv[2];

if (!keyword) {
  console.error('请提供关键词');
  process.exit(1);
}

console.log(`添加关键词订阅: ${keyword}`);

const db = new Database(config.databasePath);

try {
  // 插入关键词订阅
  const result = db.prepare(`
    INSERT INTO keyword_subscriptions (
      user_id, keyword, year_start, year_end,
      spider_type, num_results, is_active,
      crawl_count, total_articles
    ) VALUES (1, ?, NULL, NULL, 'google_scholar', 20, 1, 0, 0)
  `).run(keyword);

  console.log(`✅ 关键词订阅已创建，ID: ${result.lastInsertRowid}`);

  // 查询创建的记录
  const subscription = db.prepare('SELECT * FROM keyword_subscriptions WHERE id = ?').get(result.lastInsertRowid);
  console.log('📋 订阅详情:', subscription);

} catch (error) {
  console.error('❌ 添加失败:', error);
  process.exit(1);
} finally {
  db.close();
}
