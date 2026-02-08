/**
 * Reset article-related tables in the database
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../data/rss-tracker.db');

console.log(`Database: ${dbPath}`);

const db = new Database(dbPath);

// Enable WAL mode
db.pragma('journal_mode = WAL');

try {
  console.log('\n=== 开始重置文章相关表 ===\n');

  // 临时禁用外键约束
  db.pragma('foreign_keys = OFF');
  console.log('✓ 已禁用外键约束');

  // 开启事务
  const resetTables = db.transaction(() => {
    // 获取当前记录数
    const getLogCount = db.prepare('SELECT COUNT(*) AS count FROM article_filter_logs').get() as { count: number };
    const getRelatedCount = db.prepare('SELECT COUNT(*) AS count FROM article_related').get() as { count: number };
    const getTransCount = db.prepare('SELECT COUNT(*) AS count FROM article_translations').get() as { count: number };
    const getArticleCount = db.prepare('SELECT COUNT(*) AS count FROM articles').get() as { count: number };

    console.log(`  - article_filter_logs: ${getLogCount.count} 条`);
    console.log(`  - article_related: ${getRelatedCount.count} 条`);
    console.log(`  - article_translations: ${getTransCount.count} 条`);
    console.log(`  - articles: ${getArticleCount.count} 条`);

    // 清空表
    db.prepare('DELETE FROM article_filter_logs').run();
    console.log('\n✓ 已清空 article_filter_logs');

    db.prepare('DELETE FROM article_related').run();
    console.log('✓ 已清空 article_related');

    db.prepare('DELETE FROM article_translations').run();
    console.log('✓ 已清空 article_translations');

    db.prepare('DELETE FROM articles').run();
    console.log('✓ 已清空 articles');

    // 重置自增序列
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('article_filter_logs', 'article_related', 'article_translations', 'articles')").run();
    console.log('✓ 已重置自增ID序列');
  });

  resetTables();

  // 重新启用外键约束
  db.pragma('foreign_keys = ON');
  console.log('✓ 已启用外键约束');

  // 验证结果
  console.log('\n=== 验证结果 ===');
  const logCount = db.prepare('SELECT COUNT(*) AS count FROM article_filter_logs').get() as { count: number };
  const relatedCount = db.prepare('SELECT COUNT(*) AS count FROM article_related').get() as { count: number };
  const transCount = db.prepare('SELECT COUNT(*) AS count FROM article_translations').get() as { count: number };
  const articleCount = db.prepare('SELECT COUNT(*) AS count FROM articles').get() as { count: number };

  console.log(`  article_filter_logs: ${logCount.count} 条`);
  console.log(`  article_related: ${relatedCount.count} 条`);
  console.log(`  article_translations: ${transCount.count} 条`);
  console.log(`  articles: ${articleCount.count} 条`);

  // 保留的表记录数
  console.log('\n=== 保留的表 ===');
  const configCount = db.prepare('SELECT COUNT(*) AS count FROM llm_configs').get() as { count: number };
  const promptCount = db.prepare('SELECT COUNT(*) AS count FROM system_prompts').get() as { count: number };
  const domainCount = db.prepare('SELECT COUNT(*) AS count FROM topic_domains').get() as { count: number };
  const keywordCount = db.prepare('SELECT COUNT(*) AS count FROM topic_keywords').get() as { count: number };
  const sourceCount = db.prepare('SELECT COUNT(*) AS count FROM rss_sources').get() as { count: number };

  console.log(`  llm_configs: ${configCount.count} 条 (保留)`);
  console.log(`  system_prompts: ${promptCount.count} 条 (保留)`);
  console.log(`  topic_domains: ${domainCount.count} 条 (保留)`);
  console.log(`  topic_keywords: ${keywordCount.count} 条 (保留)`);
  console.log(`  rss_sources: ${sourceCount.count} 条 (保留)`);

  console.log('\n=== 重置完成 ===');
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
} finally {
  db.close();
}
