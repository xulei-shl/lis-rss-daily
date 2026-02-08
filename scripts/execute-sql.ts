/**
 * Execute SQL script file
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = './data/rss-tracker.db';
const sqlPath = './sql/002_reset_articles.sql';

console.log(`Executing SQL script: ${sqlPath}`);
console.log(`Database: ${dbPath}`);

// Read SQL file
const sql = fs.readFileSync(sqlPath, 'utf-8');

// Connect to database
const db = new Database(dbPath);

try {
  // Execute SQL script
  db.exec(sql);
  console.log('SQL script executed successfully!');

  // Execute verification query
  const verifySql = `
    SELECT 'article_filter_logs' AS table_name, COUNT(*) AS remaining_count FROM article_filter_logs
    UNION ALL
    SELECT 'article_related', COUNT(*) FROM article_related
    UNION ALL
    SELECT 'article_translations', COUNT(*) FROM article_translations
    UNION ALL
    SELECT 'articles', COUNT(*) FROM articles
  `;

  const results = db.prepare(verifySql).all() as Array<{ table_name: string; remaining_count: number }>;

  console.log('\nVerification results:');
  console.log('====================');
  results.forEach(row => {
    console.log(`${row.table_name}: ${row.remaining_count} records`);
  });
  console.log('====================');
} catch (error) {
  console.error('Error executing SQL script:', error);
  process.exit(1);
} finally {
  db.close();
}
