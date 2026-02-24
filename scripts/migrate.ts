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

function hasTable(db: Database.Database, table: string): boolean {
  const result = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(result);
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
      // if (file === '001_init.sql') {
      //   const hasUsers = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      //   if (!hasUsers) {
      //     const sql = fs.readFileSync(fullPath, 'utf-8');
      //     db.exec(sql);
      //     console.log('      → Initialized database');
      //   } else {
      //     console.log('      → Skipped (already initialized)');
      //   }
      //   continue;
      // }

      // ============================================================
      // 009: 添加 summary_type 字段
      // ============================================================
      // if (file === '009_add_summary_type.sql') {
      //   const hasSummaryType = hasColumn(db, 'daily_summaries', 'summary_type');
      //   if (!hasSummaryType) {
      //     db.exec('ALTER TABLE daily_summaries ADD COLUMN summary_type TEXT DEFAULT \'all\';');
      //     console.log('      → Added summary_type column');
      //   }
      //   db.exec('UPDATE daily_summaries SET summary_type = \'all\' WHERE summary_type IS NULL;');
      //   db.exec('DROP INDEX IF EXISTS idx_daily_summaries_user_date;');
      //   db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_summaries_user_date_type ON daily_summaries(user_id, summary_date, summary_type);');
      //   db.exec('CREATE INDEX IF NOT EXISTS idx_daily_summaries_type ON daily_summaries(summary_type);');
      //   console.log('      → Migration completed');
      //   continue;
      // }

      // ============================================================
      // 010: 修复 daily_summaries 表的唯一约束
      // ============================================================
      // if (file === '010_fix_daily_summary_unique.sql') {
      //   const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_summaries'").get() as { sql: string } | undefined;
      //   const needsFix = tableInfo?.sql.includes('UNIQUE(user_id, summary_date)') && !tableInfo?.sql.includes('UNIQUE(user_id, summary_date, summary_type)');

      //   if (needsFix) {
      //     const sql = fs.readFileSync(fullPath, 'utf-8');
      //     db.exec(sql);
      //     console.log('      → Fixed unique constraint');
      //   } else {
      //     console.log('      → Skipped (already correct)');
      //   }
      //   continue;
      // }

      // ============================================================
      // 011: 将历史数据中拒绝的文章标记为已读
      // ============================================================
      if (file === '011_mark_rejected_as_read.sql') {
        const hasIsReadColumn = hasColumn(db, 'articles', 'is_read');
        if (!hasIsReadColumn) {
          console.log('      → Skipped (is_read column not found, run 008_add_is_read.sql first)');
        } else {
          const sql = fs.readFileSync(fullPath, 'utf-8');
          db.exec(sql);
          const changes = db.prepare('SELECT changes() as count').get() as { count: number };
          console.log(`      → Marked ${changes.count} rejected articles as read`);
        }
        continue;
      }

      // ============================================================
      // 012: 添加期刊表和相关字段
      // ============================================================
      if (file === '012_add_journals.sql') {
        // 检查 journals 表是否已存在
        const hasJournalsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='journals'").get();

        if (!hasJournalsTable) {
          // 1. 创建 journals 表
          db.exec(`
CREATE TABLE IF NOT EXISTS journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('cnki', 'rdfybk', 'lis')),
  source_url TEXT,
  journal_code TEXT,
  publication_cycle TEXT NOT NULL,
  issues_per_year INTEGER NOT NULL,
  volume_offset INTEGER DEFAULT 1956,
  last_year INTEGER,
  last_issue INTEGER,
  last_volume INTEGER,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);`);
          db.exec('CREATE INDEX IF NOT EXISTS idx_journals_user_id ON journals(user_id);');
          db.exec('CREATE INDEX IF NOT EXISTS idx_journals_status ON journals(status);');
          db.exec('CREATE INDEX IF NOT EXISTS idx_journals_source_type ON journals(source_type);');
          console.log('      → Created journals table');

          // 2. 创建 journal_crawl_logs 表
          db.exec(`
CREATE TABLE IF NOT EXISTS journal_crawl_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL,
  crawl_year INTEGER NOT NULL,
  crawl_issue INTEGER NOT NULL,
  crawl_volume INTEGER,
  articles_count INTEGER DEFAULT 0,
  new_articles_count INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'partial')),
  error_message TEXT,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);`);
          db.exec('CREATE INDEX IF NOT EXISTS idx_journal_crawl_logs_journal_id ON journal_crawl_logs(journal_id);');
          db.exec('CREATE INDEX IF NOT EXISTS idx_journal_crawl_logs_created_at ON journal_crawl_logs(created_at);');
          console.log('      → Created journal_crawl_logs table');

          // 3. 检查并添加 articles 表的新字段
          const hasSourceOrigin = hasColumn(db, 'articles', 'source_origin');
          if (!hasSourceOrigin) {
            db.exec("ALTER TABLE articles ADD COLUMN source_origin TEXT DEFAULT 'rss' CHECK(source_origin IN ('rss', 'journal'));");
            console.log('      → Added source_origin column to articles');
          }

          const hasJournalId = hasColumn(db, 'articles', 'journal_id');
          if (!hasJournalId) {
            db.exec('ALTER TABLE articles ADD COLUMN journal_id INTEGER REFERENCES journals(id);');
            console.log('      → Added journal_id column to articles');
          }

          // 创建索引
          db.exec('CREATE INDEX IF NOT EXISTS idx_articles_source_origin ON articles(source_origin);');
          db.exec('CREATE INDEX IF NOT EXISTS idx_articles_journal_id ON articles(journal_id);');
          console.log('      → Created indexes for new columns');

          // 4. 初始化期刊数据
          // CNKI 期刊
          const cnkiJournals = [
            ['中国图书馆学报', 'cnki', 'https://navi.cnki.net/knavi/journals/ZGTS/detail', 'bimonthly', 6, 2025, 6],
            ['图书情报知识', 'cnki', 'https://navi.cnki.net/knavi/journals/TSQC/detail', 'bimonthly', 6, 2025, 6],
            ['信息资源管理学报', 'cnki', 'https://navi.cnki.net/knavi/journals/XNZY/detail', 'bimonthly', 6, 2025, 4],
            ['图书馆论坛', 'cnki', 'https://navi.cnki.net/knavi/journals/TSGL/detail', 'monthly', 12, 2025, 12],
            ['大学图书馆学报', 'cnki', 'https://navi.cnki.net/knavi/journals/DXTS/detail', 'bimonthly', 6, 2025, 6],
            ['图书馆建设', 'cnki', 'https://navi.cnki.net/knavi/journals/TSGJ/detail', 'bimonthly', 6, 2025, 6],
            ['国家图书馆学刊', 'cnki', 'https://navi.cnki.net/knavi/journals/BJJG/detail', 'bimonthly', 6, 2025, 6],
            ['图书与情报', 'cnki', 'https://navi.cnki.net/knavi/journals/BOOK/detail', 'bimonthly', 6, 2025, 5],
            ['图书馆杂志', 'cnki', 'https://navi.cnki.net/knavi/journals/TNGZ/detail', 'monthly', 12, 2025, 12],
            ['图书馆学研究', 'cnki', 'https://navi.cnki.net/knavi/journals/TSSS/detail', 'monthly', 12, 2025, 12],
            ['图书馆工作与研究', 'cnki', 'https://navi.cnki.net/knavi/journals/TSGG/detail', 'monthly', 12, 2025, 12],
            ['图书馆', 'cnki', 'https://navi.cnki.net/knavi/journals/TSGT/detail', 'monthly', 12, null, null],
            ['图书馆理论与实践', 'cnki', 'https://navi.cnki.net/knavi/journals/LSGL/detail', 'monthly', 12, 2025, 12],
            ['文献与数据学报', 'cnki', 'https://navi.cnki.net/knavi/journals/BXJW/detail', 'quarterly', 4, 2025, 4],
            ['农业图书情报学报', 'cnki', 'https://navi.cnki.net/knavi/journals/LYTS/detail', 'monthly', 12, 2025, 12],
          ];

          const insertJournal = db.prepare(`
            INSERT OR IGNORE INTO journals (user_id, name, source_type, source_url, publication_cycle, issues_per_year, last_year, last_issue)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const journal of cnkiJournals) {
            insertJournal.run(...journal);
          }
          console.log(`      → Initialized ${cnkiJournals.length} CNKI journals`);

          // 人大报刊期刊
          const rdfybkJournals = [
            ['图书馆学情报学', 'rdfybk', null, 'G9', 'monthly', 12, 2025, 12],
            ['档案学', 'rdfybk', null, 'G7', 'bimonthly', 6, null, null],
            ['出版业', 'rdfybk', null, 'Z1', 'monthly', 12, null, null],
          ];

          const insertRdfybkJournal = db.prepare(`
            INSERT OR IGNORE INTO journals (user_id, name, source_type, source_url, journal_code, publication_cycle, issues_per_year, last_year, last_issue)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const journal of rdfybkJournals) {
            insertRdfybkJournal.run(...journal);
          }
          console.log(`      → Initialized ${rdfybkJournals.length} RDFYBK journals`);

          // 独立网站期刊
          const lisJournals = [
            ['图书情报工作', 'lis', 'https://www.lis.ac.cn', 'semimonthly', 24, 1956, 2026, 4, 70],
          ];

          const insertLisJournal = db.prepare(`
            INSERT OR IGNORE INTO journals (user_id, name, source_type, source_url, publication_cycle, issues_per_year, volume_offset, last_year, last_issue, last_volume)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const journal of lisJournals) {
            insertLisJournal.run(...journal);
          }
          console.log(`      → Initialized ${lisJournals.length} LIS journals`);

          // 5. 为所有现有文章设置 source_origin = 'rss'
          const updateResult = db.prepare("UPDATE articles SET source_origin = 'rss' WHERE source_origin IS NULL").run();
          console.log(`      → Set source_origin='rss' for ${updateResult.changes} existing articles`);

          console.log('      → Migration 012 completed');
        } else {
          console.log('      → Skipped (journals table already exists)');
        }
        continue;
      }

      // ============================================================
      // 013: 添加期刊年卷期字段
      // ============================================================
      if (file === '013_add_journal_issue_fields.sql') {
        const hasPublishedYear = hasColumn(db, 'articles', 'published_year');
        const hasPublishedIssue = hasColumn(db, 'articles', 'published_issue');
        const hasPublishedVolume = hasColumn(db, 'articles', 'published_volume');

        if (!hasPublishedYear) {
          db.exec('ALTER TABLE articles ADD COLUMN published_year INTEGER;');
          console.log('      → Added published_year column');
        }
        if (!hasPublishedIssue) {
          db.exec('ALTER TABLE articles ADD COLUMN published_issue INTEGER;');
          console.log('      → Added published_issue column');
        }
        if (!hasPublishedVolume) {
          db.exec('ALTER TABLE articles ADD COLUMN published_volume INTEGER;');
          console.log('      → Added published_volume column');
        }

        // 创建索引
        db.exec('CREATE INDEX IF NOT EXISTS idx_articles_published_year ON articles(published_year);');
        db.exec('CREATE INDEX IF NOT EXISTS idx_articles_published_issue ON articles(published_issue);');

        if (!hasPublishedYear || !hasPublishedIssue || !hasPublishedVolume) {
          console.log('      → Migration 013 completed');
        } else {
          console.log('      → Skipped (columns already exist)');
        }
        continue;
      }

      // ============================================================
      // 014: 添加 wanfang 来源类型支持
      // ============================================================
      if (file === '014_add_wanfang_source_type.sql') {
        // 检查 journals 表的 source_type 约束是否包含 wanfang
        const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='journals'").get() as { sql: string } | undefined;
        const needsWanfang = tableInfo?.sql.includes("CHECK(source_type IN") && !tableInfo?.sql.includes("'wanfang'");

        if (needsWanfang) {
          const sql = fs.readFileSync(fullPath, 'utf-8');
          db.exec(sql);
          console.log('      → Added wanfang to source_type check constraint');
        } else {
          console.log('      → Skipped (wanfang already supported)');
        }
        continue;
      }

      // ============================================================
      // 015: 添加 title_normalized 字段用于标题去重
      // ============================================================
      if (file === '015_add_title_normalized.sql') {
        const hasTitleNormalized = hasColumn(db, 'articles', 'title_normalized');
        if (!hasTitleNormalized) {
          const sql = fs.readFileSync(fullPath, 'utf-8');
          db.exec(sql);
          console.log('      → Added title_normalized column and unique index');
        } else {
          console.log('      → Skipped (already exists)');
        }
        continue;
      }

      // ============================================================
      // 016: 添加统一流程日志表
      // ============================================================
      if (file === '016_add_unified_logs.sql') {
        const hasRssFetchLogs = hasTable(db, 'rss_fetch_logs');
        const hasProcessLogs = hasTable(db, 'article_process_logs');

        if (!hasRssFetchLogs || !hasProcessLogs) {
          const sql = fs.readFileSync(fullPath, 'utf-8');
          db.exec(sql);
          console.log(
            `      → Created ${
              !hasRssFetchLogs && !hasProcessLogs
                ? 'rss_fetch_logs & article_process_logs'
                : !hasRssFetchLogs
                  ? 'rss_fetch_logs'
                  : 'article_process_logs'
            } tables`
          );
        } else {
          console.log('      → Skipped (unified log tables already exist)');
        }
        continue;
      }

      // ============================================================
      // 017: 回填 title_normalized 并删除重复数据
      // ============================================================
      if (file === '017_backfill_title_normalized_and_dedup.sql') {
        // 此迁移需要通过单独的脚本运行
        console.log('      → Requires manual execution: pnpm run db:backfill-title-normalized');
        continue;
      }

      // ============================================================
      // 018: 添加用户角色字段 (role)
      // ============================================================
      if (file === '018_add_user_role.sql') {
        // 1. 检查是否需要添加 role 字段
        const hasRoleColumn = hasColumn(db, 'users', 'role');
        if (!hasRoleColumn) {
          db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'guest'));");
          console.log('      → Added role column to users table');
        } else {
          console.log('      → role column already exists');
        }

        // 2. 确保现有 admin 用户有 role
        const adminHasRole = db.prepare("SELECT role FROM users WHERE username = 'admin'").get() as { role: string } | undefined;
        if (!adminHasRole || !adminHasRole.role) {
          db.exec("UPDATE users SET role = 'admin' WHERE username = 'admin';");
          console.log('      → Updated admin user role');
        } else {
          console.log('      → admin user role already set');
        }

        // 3. 创建 guest 用户（如果不存在）
        // 密码哈希使用 SHA256 格式（兼容 bcryptjs ESM 加载问题）
        const guestExists = db.prepare("SELECT id FROM users WHERE username = 'guest'").get() as { id: number } | undefined;
        if (!guestExists) {
          db.exec(
            "INSERT INTO users (username, password_hash, role) VALUES ('guest', '369a85abf5be438e8d598ede77a8efabff97669c483efaa2ca0a29f749d83f22', 'guest');"
          );
          console.log('      → Created guest user (password: cc@7007)');
        } else {
          console.log('      → guest user already exists');
        }

        // 4. 为 guest 用户创建默认设置（如果不存在）
        const guestUser = db.prepare("SELECT id FROM users WHERE username = 'guest'").get() as { id: number } | undefined;
        if (guestUser) {
          const guestSettings = [
            ['rss_fetch_schedule', '0 9 * * *'],
            ['rss_fetch_enabled', 'true'],
            ['llm_filter_enabled', 'true'],
            ['max_concurrent_fetch', '5'],
            ['timezone', 'Asia/Shanghai'],
            ['language', 'zh-CN'],
            ['chroma_host', '127.0.0.1'],
            ['chroma_port', '8000'],
            ['chroma_collection', 'articles'],
            ['chroma_distance_metric', 'cosine'],
          ];

          const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (user_id, key, value) VALUES (?, ?, ?)');
          for (const [key, value] of guestSettings) {
            insertSetting.run(guestUser.id, key, value);
          }
          console.log('      → Created guest user settings');
        }

        console.log('      → Migration 018 completed');
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
