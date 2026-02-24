import Database from 'better-sqlite3';
import { config } from '../src/config.js';

const db = new Database(config.databasePath);

console.log('=== 验证 title_normalized 迁移结果 ===\n');

// 检查字段
const columns = db.prepare('PRAGMA table_info(articles)').all();
const titleNormalizedCol = columns.find((c: any) => c.name === 'title_normalized');
console.log('1. title_normalized 字段:');
console.log(JSON.stringify(titleNormalizedCol, null, 2));

// 检查索引
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%title_normalized%'").all() as any[];
console.log('\n2. title_normalized 索引:');
console.log(JSON.stringify(indexes, null, 2));

// 检查现有数据
const sample = db.prepare('SELECT id, title, title_normalized FROM articles LIMIT 3').all();
console.log('\n3. 示例数据 (历史数据 title_normalized 应为 NULL):');
console.log(JSON.stringify(sample, null, 2));

db.close();
console.log('\n验证完成');
