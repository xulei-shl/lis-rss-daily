/**
 * 修复 articles 表的 rss_source_id NOT NULL 约束问题
 *
 * 对于旧数据库，需要重建表以移除 rss_source_id 的 NOT NULL 约束
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'rss-tracker.db');

console.log('Opening database:', dbPath);
const db = new Database(dbPath);

// 列出所有表
console.log('\n=== All tables in database ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

// 检查当前表结构
console.log('\n=== Current articles table schema ===');
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='articles'").get();
if (!schema) {
  console.error('Articles table not found!');
  db.close();
  process.exit(1);
}
console.log(schema.sql);

const hasNotNullConstraint = schema.sql.includes('rss_source_id INTEGER NOT NULL');

if (!hasNotNullConstraint) {
  console.log('\n✓ rss_source_id 已允许 NULL，无需处理');
  db.close();
  process.exit(0);
}

console.log('\n⚠️  检测到 rss_source_id NOT NULL 约束，准备重建表');

const columns = [
  'id',
  'rss_source_id',
  'title',
  'url',
  'summary',
  'content',
  'markdown_content',
  'filter_status',
  'filter_score',
  'filtered_at',
  'process_status',
  'process_stages',
  'processed_at',
  'published_at',
  'is_read',
  'source_origin',
  'journal_id',
  'error_message',
  'created_at',
  'updated_at',
  'published_year',
  'published_issue',
  'published_volume',
];

const selectColumns = columns.join(', ');
const placeholders = columns.map(() => '?').join(', ');

const articles = db.prepare(`SELECT ${selectColumns} FROM articles`).all();
console.log(`Found ${articles.length} articles to migrate`);

const migrate = db.transaction(() => {
  db.pragma('foreign_keys = OFF');

  const newTable = 'articles_new_tmp';
  db.prepare(`DROP TABLE IF EXISTS ${newTable}`).run();

  console.log('Creating new table without NOT NULL constraint...');
  db.prepare(`
    CREATE TABLE ${newTable} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rss_source_id INTEGER,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      summary TEXT,
      content TEXT,
      markdown_content TEXT,
      filter_status TEXT DEFAULT 'pending' CHECK(filter_status IN ('pending', 'passed', 'rejected')),
      filter_score REAL,
      filtered_at DATETIME,
      process_status TEXT DEFAULT 'pending' CHECK(process_status IN ('pending', 'processing', 'completed', 'failed')),
      process_stages TEXT,
      processed_at DATETIME,
      published_at DATETIME,
      is_read INTEGER DEFAULT 0,
      source_origin TEXT DEFAULT 'rss' CHECK(source_origin IN ('rss', 'journal')),
      journal_id INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published_year INTEGER,
      published_issue INTEGER,
      published_volume INTEGER,
      FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE,
      FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE SET NULL
    )
  `).run();

  console.log('Migrating data into new table...');
  const insert = db.prepare(`
    INSERT INTO ${newTable} (${selectColumns})
    VALUES (${placeholders})
  `);

  for (const article of articles) {
    const values = columns.map((key) => (article as any)[key]);
    insert.run(...values);
  }

  console.log('Replacing old table...');
  db.prepare('DROP TABLE articles').run();
  db.prepare(`ALTER TABLE ${newTable} RENAME TO articles`).run();

  console.log('Rebuilding indexes...');
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_rss_source_id ON articles(rss_source_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_filter_status ON articles(filter_status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_process_status ON articles(process_status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_source_origin ON articles(source_origin)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_journal_id ON articles(journal_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_published_year ON articles(published_year)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_published_issue ON articles(published_issue)').run();

  const maxIdRow = db.prepare('SELECT MAX(id) as maxId FROM articles').get() as { maxId: number | null };
  const seqRow = db.prepare("SELECT COUNT(*) as count FROM sqlite_sequence WHERE name='articles'").get() as {
    count: number;
  };
  if (seqRow.count > 0) {
    db.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?').run(maxIdRow?.maxId ?? 0, 'articles');
  }

  db.pragma('foreign_keys = ON');
});

migrate();

const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
if (fkErrors.length > 0) {
  console.error('❌ Foreign key check failed:', fkErrors);
  process.exit(1);
}

console.log('\n=== Updated articles table schema ===');
const newSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='articles'").get();
console.log(newSchema.sql);

console.log('\n✓ Migration completed successfully');
db.close();
