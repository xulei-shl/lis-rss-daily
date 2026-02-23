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

// 检查是否有 NOT NULL 约束
const hasNotNullConstraint = schema.sql.includes('rss_source_id INTEGER NOT NULL');

if (hasNotNullConstraint) {
  console.log('\n⚠️  Found NOT NULL constraint on rss_source_id column');
  console.log('需要重建表以移除该约束...\n');

  // 获取所有数据
  const articles = db.prepare('SELECT * FROM articles').all();
  console.log(`Found ${articles.length} articles to migrate`);

  // 开始事务
  const migrate = db.transaction(() => {
    // 1. 重命名旧表
    console.log('1. Renaming old table...');
    db.prepare('DROP TABLE IF EXISTS articles_old').run();
    db.prepare('ALTER TABLE articles RENAME TO articles_old').run();

    // 2. 创建新表（没有 NOT NULL 约束）
    console.log('2. Creating new table...');
    db.prepare(`
      CREATE TABLE articles (
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
        FOREIGN KEY (rss_source_id) REFERENCES rss_sources(id) ON DELETE CASCADE,
        FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE SET NULL
      )
    `).run();

    // 3. 创建索引
    console.log('3. Creating indexes...');
    db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_rss_source_id ON articles(rss_source_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_filter_status ON articles(filter_status)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_process_status ON articles(process_status)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_source_origin ON articles(source_origin)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_articles_journal_id ON articles(journal_id)').run();

    // 4. 迁移数据
    console.log('4. Migrating data...');
    const insert = db.prepare(`
      INSERT INTO articles (
        id, rss_source_id, title, url, summary, content, markdown_content,
        filter_status, filter_score, filtered_at, process_status, process_stages, processed_at,
        published_at, is_read, source_origin, journal_id, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const article of articles) {
      insert.run(
        article.id,
        article.rss_source_id,
        article.title,
        article.url,
        article.summary,
        article.content,
        article.markdown_content,
        article.filter_status,
        article.filter_score,
        article.filtered_at,
        article.process_status,
        article.process_stages,
        article.processed_at,
        article.published_at,
        article.is_read,
        article.source_origin || 'rss',
        article.journal_id,
        article.error_message,
        article.created_at,
        article.updated_at
      );
    }

    // 5. 删除旧表
    console.log('5. Dropping old table...');
    db.prepare('DROP TABLE articles_old').run();

    console.log(`\n✓ Successfully migrated ${articles.length} articles`);
  });

  migrate();
  console.log('\n=== Migration completed ===');
} else {
  console.log('\n✓ rss_source_id column already allows NULL values, no migration needed');
}

// 显示更新后的结构
console.log('\n=== Updated articles table schema ===');
const newSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='articles'").get();
console.log(newSchema.sql);

db.close();
