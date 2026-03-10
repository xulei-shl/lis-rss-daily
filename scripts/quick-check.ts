#!/usr/bin/env tsx
import 'dotenv/config';
import '../src/config.js';
import { getDb } from '../src/db.js';
import { getWeChatWebhooks } from '../src/config/wechat-config.js';

async function main() {
  console.log('=== 用户检查 ===');
  const db = getDb();
  const users = await db.selectFrom('users').select(['id', 'username']).execute();
  console.table(users);

  console.log('\n=== 微信配置检查 ===');
  const webhooks = getWeChatWebhooks();
  console.log(`Webhooks 数量: ${webhooks.length}`);
  webhooks.forEach((wh) => {
    console.log(`  - ${wh.name}: enabled=${wh.enabled}, push_types=`, wh.push_types);
  });

  console.log('\n=== 2026-03-09 文章检查 ===');
  const [year, month, day] = '2026-03-09'.split('-').map(Number);
  const todayStartBeijing = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const todayStartUtc = new Date(todayStartBeijing.getTime() - 8 * 60 * 60 * 1000);
  const todayEndUtc = new Date(todayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  console.log(`查询范围: ${todayStartUtc.toISOString()} ~ ${todayEndUtc.toISOString()}`);

  const articles = await db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .where('articles.created_at', '>=', todayStartUtc.toISOString())
    .where('articles.created_at', '<=', todayEndUtc.toISOString())
    .select((eb: any) => [
      'articles.id',
      'articles.title',
      'articles.source_origin',
      'articles.filter_status',
      eb.fn.coalesce('rss_sources.name', 'journals.name', 'keyword_subscriptions.keyword').as('source_name'),
      eb.fn.coalesce('rss_sources.source_type', eb.val('journal')).as('source_type'),
    ])
    .orderBy('articles.created_at', 'desc')
    .execute();

  console.log(`文章总数: ${articles.length}`);
  console.table(articles.map((a: any) => ({
    id: a.id,
    source_origin: a.source_origin,
    filter_status: a.filter_status,
    source_type: a.source_type,
    source_name: a.source_name,
    title: a.title?.substring(0, 40),
  })));
}

main().catch(console.error);
