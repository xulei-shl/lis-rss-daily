/**
 * 手动触发所有 RSS 源立即抓取
 *
 * 用于恢复今天被误拒绝/移出的文章。
 * 调用 RSSScheduler.fetchAllNow() 强制所有活跃 RSS 订阅立即执行一次抓取。
 *
 * ⚠️ 本脚本只负责「抓取 + 保存」到数据库，不保证 filter→process 后续流程完成。
 *    原因：
 *    1. RSSScheduler.doFetch() 内 triggerAutoFilter() 是 fire-and-forget（不 await）
 *    2. triggerAutoFilter() 内部有随机的 stagger 延迟（默认最长 30 分钟）
 *    3. 本脚本末尾 process.exit(0) 会杀死所有未完成的异步操作
 *    因此运行后文章的 filter_status / process_status 仍为 pending，
 *    需在 Web 端手动点击「处理待过滤文章」或调用 API 触发后续处理。
 *
 * 运行方式：
 *   cd /opt/lis-rss-daily
 *   npx tsx scripts/trigger-rss-fetch.ts
 */

import 'dotenv/config';
import { logger } from '../src/logger.js';
import { initRSSScheduler } from '../src/rss-scheduler.js';
import { config } from '../src/config.js';

const log = logger.child({ module: 'trigger-rss-fetch' });

async function main() {
  log.info('Initializing RSS scheduler...');

  // 初始化 RSS 调度器（会读取环境变量配置）
  const scheduler = initRSSScheduler();

  log.info('Starting manual RSS fetch for all sources...');
  log.info({
    maxConcurrent: 5,
    fetchTimeout: config.rssFetchTimeout,
  }, 'Fetch configuration');

  // 执行全量抓取
  const results = await scheduler.fetchAllNow();

  const successCount = results.filter(r => r.success).length;
  const totalArticles = results.reduce((sum, r) => sum + r.articlesCount, 0);
  const newArticles = results.reduce((sum, r) => sum + r.newArticlesCount, 0);
  const failedCount = results.length - successCount;

  log.info({
    totalSources: results.length,
    successCount,
    failedCount,
    totalArticles,
    newArticles,
  }, 'Manual RSS fetch completed');

  // 打印每个源的详细结果
  for (const result of results) {
    if (result.success) {
      log.info({ rssSourceId: result.rssSourceId, articles: result.articlesCount, new: result.newArticlesCount }, 'Source fetched');
    } else {
      log.warn({ rssSourceId: result.rssSourceId, error: result.error }, 'Source fetch failed');
    }
  }
}

main()
  .then(() => {
    log.info('Script finished');
    process.exit(0);
  })
  .catch((err) => {
    log.error({ err }, 'Script failed');
    process.exit(1);
  });
