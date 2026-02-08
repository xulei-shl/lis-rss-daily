/**
 * Database migration script
 *
 * Run this script to initialize the database:
 *   pnpm run db:migrate
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TableInfo = { name: string };

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as TableInfo[];
  return columns.some((item) => item.name === column);
}

async function runMigrations() {
  console.log('🔧 Starting database migration...\n');

  // Ensure data directory exists
  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Created data directory: ${dbDir}`);
  }

  // Connect to database
  const db = new Database(config.databasePath);
  console.log(`📦 Connected to database: ${config.databasePath}\n`);

  try {
    // Read all migration files
    const sqlDir = path.join(__dirname, '..', 'sql');
    const migrationFiles = fs
      .readdirSync(sqlDir)
      .filter((file) => /^\d+_.*\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b, 'en'));

    // Execute migrations
    console.log('📜 Executing migration scripts...');
    for (const file of migrationFiles) {
      const fullPath = path.join(sqlDir, file);
      console.log(`   - ${file}`);

      if (file === '002_vector_refactor.sql') {
        const hasConfigType = hasColumn(db, 'llm_configs', 'config_type');
        const hasEnabled = hasColumn(db, 'llm_configs', 'enabled');

        if (!hasConfigType) {
          db.exec("ALTER TABLE llm_configs ADD COLUMN config_type TEXT NOT NULL DEFAULT 'llm';");
        }

        if (!hasEnabled) {
          db.exec('ALTER TABLE llm_configs ADD COLUMN enabled INTEGER DEFAULT 0;');
        }

        db.exec("UPDATE llm_configs SET config_type = 'llm' WHERE config_type IS NULL OR config_type = '';");

        db.exec(`
          INSERT OR IGNORE INTO settings (user_id, key, value)
          VALUES
            (1, 'chroma_host', '127.0.0.1'),
            (1, 'chroma_port', '8000'),
            (1, 'chroma_collection', 'articles'),
            (1, 'chroma_distance_metric', 'cosine');
        `);

        continue;
      }

      if (file === '003_llm_config_priority.sql') {
        const hasPriority = hasColumn(db, 'llm_configs', 'priority');
        if (!hasPriority) {
          db.exec('ALTER TABLE llm_configs ADD COLUMN priority INTEGER DEFAULT 100;');
          db.exec('UPDATE llm_configs SET priority = 100 WHERE priority IS NULL;');
        }
        continue;
      }

      if (file === '005_add_source_type.sql') {
        // Check if source_type column exists in rss_sources
        const hasSourceType = hasColumn(db, 'rss_sources', 'source_type');
        if (!hasSourceType) {
          db.exec("ALTER TABLE rss_sources ADD COLUMN source_type TEXT DEFAULT 'blog' CHECK(source_type IN ('journal', 'blog', 'news'));");
          db.exec("CREATE INDEX IF NOT EXISTS idx_rss_sources_source_type ON rss_sources(source_type);");
        }

        // Check if daily_summaries table exists
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_summaries'").get() as { name: string } | undefined;
        if (!tables) {
          db.exec(`
            CREATE TABLE IF NOT EXISTS daily_summaries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              summary_date TEXT NOT NULL,
              article_count INTEGER NOT NULL,
              summary_content TEXT NOT NULL,
              articles_data TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              UNIQUE(user_id, summary_date)
            );
          `);
          db.exec('CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(user_id, summary_date DESC);');
        }
        continue;
      }

      if (file === '006_add_related_updated_at.sql') {
        // Check if updated_at column exists in article_related
        const hasUpdatedAt = hasColumn(db, 'article_related', 'updated_at');
        if (!hasUpdatedAt) {
          db.exec('ALTER TABLE article_related ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;');
          db.exec('UPDATE article_related SET updated_at = created_at WHERE updated_at IS NULL;');
        }
        db.exec('CREATE INDEX IF NOT EXISTS idx_article_related_updated_at ON article_related(updated_at);');
        continue;
      }

      const sql = fs.readFileSync(fullPath, 'utf-8');
      db.exec(sql);
    }

    console.log('\n✅ Migration completed successfully!\n');

    // Show table info
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;

    console.log('📊 Created tables:');
    for (const table of tables) {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
      console.log(`   - ${table.name} (${count.count} rows)`);
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

runMigrations().catch(console.error);
