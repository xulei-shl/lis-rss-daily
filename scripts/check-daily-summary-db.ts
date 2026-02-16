/**
 * Check daily_summaries table structure
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/rss-tracker.db');
const db = new Database(dbPath);

console.log('=== daily_summaries table schema ===');
const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_summaries'").get() as { sql: string };
console.log(tableInfo.sql);

console.log('\n=== Indices on daily_summaries ===');
const indices = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='daily_summaries'").all() as Array<{ name: string; sql: string | null }>;
indices.forEach(idx => {
  console.log(`${idx.name}: ${idx.sql || '(implicit primary key)'}`);
});

console.log('\n=== Existing records ===');
const records = db.prepare("SELECT user_id, summary_date, summary_type, article_count FROM daily_summaries ORDER BY summary_date DESC LIMIT 5").all();
console.table(records);

db.close();
