/**
 * 修复引用 articles_old 的日志/关联/翻译表
 *
 * 该脚本会重建相关表，确保外键重新指向 articles，并重新创建索引。
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'rss-tracker.db');

const db = new Database(dbPath);

interface TableFixConfig {
  name: string;
  columns: string;
  createSQL: (tableName: string) => string;
  indexes: string[];
  hasAutoIncrement?: boolean;
}

const tables: TableFixConfig[] = [
  {
    name: 'article_filter_logs',
    columns:
      'id, article_id, domain_id, is_passed, relevance_score, matched_keywords, filter_reason, llm_response, created_at',
    createSQL: (tableName) => `
      CREATE TABLE ${tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL,
        domain_id INTEGER,
        is_passed INTEGER NOT NULL,
        relevance_score REAL,
        matched_keywords TEXT,
        filter_reason TEXT,
        llm_response TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
        FOREIGN KEY (domain_id) REFERENCES topic_domains(id) ON DELETE SET NULL
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_article_filter_logs_article_id ON article_filter_logs(article_id)',
      'CREATE INDEX IF NOT EXISTS idx_article_filter_logs_domain_id ON article_filter_logs(domain_id)',
      'CREATE INDEX IF NOT EXISTS idx_article_filter_logs_is_passed ON article_filter_logs(is_passed)',
    ],
    hasAutoIncrement: true,
  },
  {
    name: 'article_related',
    columns: 'article_id, related_article_id, score, created_at, updated_at',
    createSQL: (tableName) => `
      CREATE TABLE ${tableName} (
        article_id INTEGER NOT NULL,
        related_article_id INTEGER NOT NULL,
        score REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (article_id, related_article_id),
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
        FOREIGN KEY (related_article_id) REFERENCES articles(id) ON DELETE CASCADE
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_article_related_article_id ON article_related(article_id)',
      'CREATE INDEX IF NOT EXISTS idx_article_related_related_article_id ON article_related(related_article_id)',
      'CREATE INDEX IF NOT EXISTS idx_article_related_updated_at ON article_related(updated_at)',
    ],
  },
  {
    name: 'article_translations',
    columns: 'article_id, title_zh, summary_zh, source_lang, created_at, updated_at',
    createSQL: (tableName) => `
      CREATE TABLE ${tableName} (
        article_id INTEGER PRIMARY KEY,
        title_zh TEXT,
        summary_zh TEXT,
        source_lang TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      )
    `,
    indexes: ['CREATE INDEX IF NOT EXISTS idx_article_translations_article_id ON article_translations(article_id)'],
  },
];

function needFix(tableName: string): boolean {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName) as { sql?: string } | undefined;
  if (!row?.sql) {
    console.warn(`⚠️  找不到表 ${tableName}，跳过`);
    return false;
  }

  return /articles_old/.test(row.sql);
}

function rebuildTable(config: TableFixConfig): void {
  if (!needFix(config.name)) {
    console.log(`✓ ${config.name} 外键正常，跳过`);
    return;
  }

  console.log(`🔧 修复 ${config.name} ...`);

  const tempName = `${config.name}_new_tmp`;
  const createSQL = config.createSQL(tempName);

  const migrate = db.transaction(() => {
    db.prepare(`DROP TABLE IF EXISTS ${tempName}`).run();
    db.exec(createSQL);

    const copySQL = `INSERT INTO ${tempName} (${config.columns}) SELECT ${config.columns} FROM ${config.name}`;
    db.prepare(copySQL).run();

    db.prepare(`DROP TABLE ${config.name}`).run();
    db.prepare(`ALTER TABLE ${tempName} RENAME TO ${config.name}`).run();

    for (const statement of config.indexes) {
      db.exec(statement);
    }
  });

  migrate();

  if (config.hasAutoIncrement) {
    const seq = db
      .prepare(`SELECT MAX(id) as maxId FROM ${config.name}`)
      .get() as { maxId: number | null };
    const nextId = seq?.maxId ?? 0;
    const hasSeqRow = db
      .prepare("SELECT COUNT(*) as count FROM sqlite_sequence WHERE name=?")
      .get(config.name) as { count: number };
    if (hasSeqRow.count > 0) {
      db.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?').run(nextId, config.name);
    }
  }

  console.log(`✓ ${config.name} 修复完成`);
}

console.log('数据库路径:', dbPath);
db.pragma('foreign_keys = OFF');

for (const table of tables) {
  rebuildTable(table);
}

db.pragma('foreign_keys = ON');

const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
if (fkErrors.length > 0) {
  console.error('❌ 外键检查未通过:', fkErrors);
  process.exit(1);
}

console.log('✓ 外键检查通过，修复完成');
db.close();
