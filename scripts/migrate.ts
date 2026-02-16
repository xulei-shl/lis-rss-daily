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
      // 001: 初始化脚本（新数据库时执行）
      // ============================================================
      if (file === '001_init.sql') {
        const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
        if (!hasUsers) {
          const sql = fs.readFileSync(fullPath, 'utf-8');
          db.exec(sql);
          console.log('      → Initialized database');
        } else {
          console.log('      → Skipped (already initialized)');
        }
        continue;
      }

      // ============================================================
      // 009: 添加 summary_type 字段
      // ============================================================
      if (file === '009_add_summary_type.sql') {
        const hasSummaryType = hasColumn(db, 'daily_summaries', 'summary_type');
        if (!hasSummaryType) {
          db.exec('ALTER TABLE daily_summaries ADD COLUMN summary_type TEXT DEFAULT \'all\';');
          console.log('      → Added summary_type column');
        }
        db.exec('UPDATE daily_summaries SET summary_type = \'all\' WHERE summary_type IS NULL;');
        db.exec('DROP INDEX IF EXISTS idx_daily_summaries_user_date;');
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_summaries_user_date_type ON daily_summaries(user_id, summary_date, summary_type);');
        db.exec('CREATE INDEX IF NOT EXISTS idx_daily_summaries_type ON daily_summaries(summary_type);');
        console.log('      → Migration completed');
        continue;
      }

      // ============================================================
      // 010: 修复 daily_summaries 表的唯一约束
      // ============================================================
      if (file === '010_fix_daily_summary_unique.sql') {
        const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_summaries'").get() as { sql: string } | undefined;
        const needsFix = tableInfo?.sql.includes('UNIQUE(user_id, summary_date)') && !tableInfo?.sql.includes('UNIQUE(user_id, summary_date, summary_type)');

        if (needsFix) {
          const sql = fs.readFileSync(fullPath, 'utf-8');
          db.exec(sql);
          console.log('      → Fixed unique constraint');
        } else {
          console.log('      → Skipped (already correct)');
        }
        continue;
      }

      // 其他迁移脚本已包含在 001_init.sql 中
      console.log('      → Skipped (included in 001_init.sql)');
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
