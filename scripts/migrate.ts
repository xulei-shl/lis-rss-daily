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

  // Auto-backup database before migration
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupPath = config.databasePath.replace('.db', `.backup-${timestamp}.db`);
  if (fs.existsSync(config.databasePath)) {
    fs.copyFileSync(config.databasePath, backupPath);
    console.log(`💾 Database backed up to: ${backupPath}\n`);
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

      // ============================================================
      // 008: 添加 is_read 字段（当前版本增量迁移）
      // ============================================================
      if (file === '008_add_is_read.sql') {
        const hasIsRead = hasColumn(db, 'articles', 'is_read');
        if (!hasIsRead) {
          db.exec('ALTER TABLE articles ADD COLUMN is_read INTEGER DEFAULT 0;');
          console.log('      → Added is_read column');
        }
        db.exec('CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);');
        console.log('      → Created index for is_read');
        continue;
      }

      // ============================================================
      // 001: 初始化脚本（新数据库时执行）
      // ============================================================
      if (file === '001_init.sql') {
        // 检查是否是新数据库（没有 users 表）
        const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
        if (!hasUsers) {
          const sql = fs.readFileSync(fullPath, 'utf-8');
          db.exec(sql);
          console.log('      → Initialized database with 001_init.sql');
        } else {
          console.log('      → Skipped (database already initialized)');
        }
        continue;
      }

      // ============================================================
      // 002-007: 历史迁移已包含在 001_init.sql 中，跳过
      // ============================================================
      console.log('      → Skipped (already included in 001_init.sql)');
    }

    console.log('\n✅ Migration completed successfully!\n');

    // Show table info
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;

    console.log('📊 Database tables:');
    for (const table of tables) {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
      console.log(`   - ${table.name} (${count.count} rows)`);
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error(`💾 Backup available at: ${backupPath}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

runMigrations().catch(console.error);
