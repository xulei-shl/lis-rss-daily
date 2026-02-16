import Database from 'better-sqlite3';
const db = new Database('data/rss-tracker.db');
console.log('=== daily_summaries table schema ===');
const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_summaries'").get();
console.log(tableInfo.sql);
console.log('\n=== Indices ===');
const indices = db.prepare("SELECT * FROM pragma_index_list('daily_summaries')").all();
console.log(JSON.stringify(indices, null, 2));
db.close();
