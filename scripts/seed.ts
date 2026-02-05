/**
 * Database seed script
 *
 * Run this script to populate the database with sample data:
 *   pnpm run db:seed
 */

import Database from 'better-sqlite3';
import { config } from '../src/config.js';

async function seedDatabase() {
  console.log('🌱 Starting database seeding...\n');

  const db = new Database(config.databasePath);

  try {
    // Insert sample RSS sources
    const rssSources = [
      {
        user_id: 1,
        name: 'ArXiv CS.AI',
        url: 'http://export.arxiv.org/rss/cs.AI',
        fetch_interval: 3600,
        status: 'active',
      },
      {
        user_id: 1,
        name: 'Hacker News',
        url: 'https://news.ycombinator.com/rss',
        fetch_interval: 3600,
        status: 'active',
      },
    ];

    const insertRSS = db.prepare(`
      INSERT OR IGNORE INTO rss_sources (user_id, name, url, fetch_interval, status)
      VALUES (@user_id, @name, @url, @fetch_interval, @status)
    `);

    for (const source of rssSources) {
      insertRSS.run(source);
      console.log(`   ✅ RSS source: ${source.name}`);
    }

    // Insert sample topic domains
    const topicDomains = [
      { user_id: 1, name: '人工智能', description: 'AI、机器学习、深度学习相关', is_active: 1, priority: 1 },
      { user_id: 1, name: '编程开发', description: '编程语言、软件开发、工具', is_active: 1, priority: 2 },
    ];

    const insertDomain = db.prepare(`
      INSERT OR IGNORE INTO topic_domains (user_id, name, description, is_active, priority)
      VALUES (@user_id, @name, @description, @is_active, @priority)
    `);

    for (const domain of topicDomains) {
      const result = insertDomain.run(domain);
      console.log(`   ✅ Topic domain: ${domain.name}`);

      // Insert keywords for this domain
      const keywords =
        domain.name === '人工智能'
          ? ['AI', 'artificial intelligence', '机器学习', 'machine learning', 'ML', '深度学习', 'deep learning', 'neural network', '神经网络', 'GPT', 'transformer']
          : ['programming', 'coding', 'developer', '软件', '编程语言', 'JavaScript', 'Python', 'TypeScript', 'Git'];

      const insertKeyword = db.prepare(`
        INSERT OR IGNORE INTO topic_keywords (domain_id, keyword, weight, is_active)
        VALUES (@domain_id, @keyword, @weight, @is_active)
      `);

      for (const keyword of keywords) {
        // Get the domain_id
        const domainRow = db
          .prepare('SELECT id FROM topic_domains WHERE user_id = @user_id AND name = @name')
          .get({ user_id: domain.user_id, name: domain.name }) as { id: number } | undefined;

        if (domainRow) {
          insertKeyword.run({
            domain_id: domainRow.id,
            keyword: keyword,
            weight: 1.0,
            is_active: 1,
          });
        }
      }
      console.log(`      └─ Added ${keywords.length} keywords`);
    }

    console.log('\n✅ Seeding completed successfully!\n');

    // Show summary
    const rssCount = db.prepare('SELECT COUNT(*) as count FROM rss_sources WHERE user_id = 1').get() as { count: number };
    const domainCount = db.prepare('SELECT COUNT(*) as count FROM topic_domains WHERE user_id = 1').get() as { count: number };
    const keywordCount = db.prepare('SELECT COUNT(*) as count FROM topic_keywords').get() as { count: number };

    console.log('📊 Summary:');
    console.log(`   - RSS sources: ${rssCount.count}`);
    console.log(`   - Topic domains: ${domainCount.count}`);
    console.log(`   - Topic keywords: ${keywordCount.count}`);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

seedDatabase().catch(console.error);
