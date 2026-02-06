/**
 * 清空文章相关表并重置自增序列。
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../src/config.js';

const dbPath = config.databasePath;

if (!fs.existsSync(dbPath)) {
  console.error(`数据库文件不存在：${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const tables = [
  'article_related',
  'article_filter_logs',
  'article_keywords',
  'article_translations',
  'articles',
  'keywords',
];

try {
  console.log(`连接数据库：${dbPath}`);

  const clear = db.transaction(() => {
    for (const table of tables) {
      db.exec(`DELETE FROM ${table};`);
    }

    const seqNames = tables.map((t) => `'${t}'`).join(', ');
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${seqNames});`);
  });

  clear();

  console.log('清空完成，当前行数：');
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${table};`).get() as { count: number };
    console.log(`- ${table}: ${row.count}`);
  }
} catch (error) {
  console.error('清空失败：', error);
  process.exit(1);
} finally {
  db.close();
}
