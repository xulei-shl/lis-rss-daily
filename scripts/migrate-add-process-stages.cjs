/**
 * Migration script to add process_stages column
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'rss-tracker.db');
const db = new Database(dbPath);

// Enable WAL mode
db.pragma('journal_mode = WAL');

try {
  // Check if column already exists
  const pragma = db.pragma('table_info(articles)');
  const hasColumn = pragma.some(col => col.name === 'process_stages');

  if (hasColumn) {
    console.log('Column process_stages already exists, skipping migration.');
  } else {
    // Add the column
    db.exec('ALTER TABLE articles ADD COLUMN process_stages TEXT');
    console.log('Migration completed: Added process_stages column to articles table.');
  }
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
} finally {
  db.close();
}
