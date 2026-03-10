/**
 * 手动触发文章获取脚本
 *
 * 使用方式:
 *   tsx scripts/manual-fetch.ts --all                    # 获取所有类型 (RSS + 关键词 + 期刊)
 *   tsx scripts/manual-fetch.ts --rss                    # 仅获取 RSS 订阅
 *   tsx scripts/manual-fetch.ts --keyword                # 仅获取关键词订阅
 *   tsx scripts/manual-fetch.ts --journal                # 仅获取期刊订阅
 *   tsx scripts/manual-fetch.ts --rss --keyword          # 获取 RSS 和关键词
 *
 * 环境变量:
 *   需要在项目根目录的 .env 文件中配置相关环境变量
 */

import 'dotenv/config';
import { initRSSScheduler } from '../src/rss-scheduler.js';
import { initKeywordScheduler } from '../src/keyword-scheduler.js';
import { initJournalScheduler } from '../src/journal-scheduler.js';
import { logger } from '../src/logger.js';
import { getActiveKeywords } from '../src/api/keywords.js';
import { getActiveJournals, calculateIssuesToCrawl } from '../src/api/journals.js';
import { getDb } from '../src/db.js';
import type { JournalInfo } from '../src/spiders/types.js';

const log = logger.child({ module: 'manual-fetch' });

interface FetchOptions {
  rss: boolean;
  keyword: boolean;
  journal: boolean;
  skipIntervalCheck: boolean;
}

function parseArgs(args: string[]): FetchOptions {
  const options: FetchOptions = {
    rss: false,
    keyword: false,
    journal: false,
    skipIntervalCheck: false,
  };

  let hasType = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--all':
      case '-a':
        options.rss = true;
        options.keyword = true;
        options.journal = true;
        hasType = true;
        break;
      case '--rss':
      case '-r':
        options.rss = true;
        hasType = true;
        break;
      case '--keyword':
      case '-k':
        options.keyword = true;
        hasType = true;
        break;
      case '--journal':
      case '-j':
        options.journal = true;
        hasType = true;
        break;
      case '--skip-interval':
        options.skipIntervalCheck = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  if (!hasType) {
    printHelp();
    process.exit(1);
  }

  return options;
}

function printHelp() {
  console.log(`
手动触发文章获取脚本

使用方式:
  tsx scripts/manual-fetch.ts [选项]

必需选项（至少选择一个）:
  --all, -a         获取所有类型 (RSS + 关键词 + 期刊)
  --rss, -r         仅获取 RSS 订阅
  --keyword, -k     仅获取关键词订阅
  --journal, -j     仅获取期刊订阅

可选选项:
  --skip-interval   跳过 RSS 抓取间隔检查（强制抓取所有）
  --help, -h        显示此帮助信息

示例:
  tsx scripts/manual-fetch.ts --rss
  tsx scripts/manual-fetch.ts --rss --keyword
  tsx scripts/manual-fetch.ts --all
  `);
}

async function fetchRSS(skipIntervalCheck: boolean): Promise<void> {
  log.info('开始手动获取 RSS 订阅...');

  const scheduler = initRSSScheduler();

  if (skipIntervalCheck) {
    // 跳过间隔检查，强制抓取所有活跃源
    const results = await scheduler.fetchAllNow();
    const successCount = results.filter(r => r.success).length;
    const totalArticles = results.reduce((sum, r) => sum + r.articlesCount, 0);
    const newArticles = results.reduce((sum, r) => sum + r.newArticlesCount, 0);

    log.info(
      { totalTasks: results.length, successCount, totalArticles, newArticles },
      'RSS 抓取完成（跳过间隔检查）'
    );
  } else {
    // 使用正常的抓取逻辑（会检查间隔）
    // 这里我们直接调用 fetchAllNow，它会抓取所有活跃源
    const results = await scheduler.fetchAllNow();
    const successCount = results.filter(r => r.success).length;
    const totalArticles = results.reduce((sum, r) => sum + r.articlesCount, 0);
    const newArticles = results.reduce((sum, r) => sum + r.newArticlesCount, 0);

    log.info(
      { totalTasks: results.length, successCount, totalArticles, newArticles },
      'RSS 抓取完成'
    );
  }
}

async function fetchKeywords(): Promise<void> {
  log.info('开始手动获取关键词订阅...');

  const scheduler = initKeywordScheduler();
  const keywords = await getActiveKeywords(1);

  if (keywords.length === 0) {
    log.info('没有活跃的关键词订阅');
    return;
  }

  log.info({ count: keywords.length }, '找到活跃关键词');

  let completed = 0;
  let failed = 0;
  let totalArticles = 0;
  let newArticles = 0;

  for (const kw of keywords) {
    try {
      log.info({ keywordId: kw.id, keyword: kw.keyword }, '正在爬取关键词...');
      const result = await scheduler.crawlKeywordNow(kw.id);

      if (result.success) {
        completed++;
        totalArticles += result.articlesCount;
        newArticles += result.newArticlesCount;
        log.info(
          { keyword: kw.keyword, articlesCount: result.articlesCount, newArticlesCount: result.newArticlesCount },
          '关键词爬取成功'
        );
      } else {
        failed++;
        log.error({ keyword: kw.keyword, error: result.error }, '关键词爬取失败');
      }
    } catch (error) {
      failed++;
      log.error({ keyword: kw.keyword, error }, '关键词爬取出错');
    }

    // 关键词之间加间隔，避免触发反爬
    if (keywords.indexOf(kw) < keywords.length - 1) {
      const delay = 30000 + Math.random() * 30000; // 30-60 秒
      log.info({ delay: Math.round(delay / 1000) }, '等待下一个关键词...');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  log.info(
    { completed, failed, totalArticles, newArticles },
    '关键词抓取完成'
  );
}

async function fetchJournals(): Promise<void> {
  log.info('开始手动获取期刊订阅...');

  const scheduler = initJournalScheduler();
  const journals = await getActiveJournals(1);

  if (journals.length === 0) {
    log.info('没有活跃的期刊订阅');
    return;
  }

  log.info({ count: journals.length }, '找到活跃期刊');

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let completed = 0;
  let failed = 0;
  let totalArticles = 0;
  let newArticles = 0;

  for (let index = 0; index < journals.length; index++) {
    const journal = journals[index];
    const issuesToCrawl = calculateIssuesToCrawl(journal, currentYear, currentMonth);

    if (issuesToCrawl.length === 0) {
      log.debug({ journalId: journal.id, name: journal.name }, '没有需要爬取的期号');
      continue;
    }

    log.info(
      { journalId: journal.id, name: journal.name, issues: issuesToCrawl },
      '正在爬取期刊...'
    );

    for (const issueInfo of issuesToCrawl) {
      try {
        const result = await scheduler.crawlJournal(
          journal as JournalInfo,
          issueInfo.year,
          issueInfo.issue,
          issueInfo.volume
        );

        if (result.success) {
          completed++;
          totalArticles += result.articlesCount;
          newArticles += result.newArticlesCount;
          log.info(
            {
              name: journal.name,
              year: issueInfo.year,
              issue: issueInfo.issue,
              articlesCount: result.articlesCount,
              newArticlesCount: result.newArticlesCount
            },
            '期刊爬取成功'
          );
        } else {
          failed++;
          log.error(
            { name: journal.name, year: issueInfo.year, issue: issueInfo.issue, error: result.error },
            '期刊爬取失败'
          );
        }
      } catch (error) {
        failed++;
        log.error(
          { name: journal.name, year: issueInfo.year, issue: issueInfo.issue, error },
          '期刊爬取出错'
        );
      }
    }

    // 期刊之间加间隔
    if (index < journals.length - 1) {
      const delay = 180000 + Math.random() * 60000; // 3-4 分钟
      log.info({ delay: Math.round(delay / 1000) }, '等待下一个期刊...');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  log.info(
    { completed, failed, totalArticles, newArticles },
    '期刊抓取完成'
  );
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    log.info({ options }, '开始手动获取文章');

    // 初始化数据库连接
    getDb();

    if (options.rss) {
      await fetchRSS(options.skipIntervalCheck);
    }

    if (options.keyword) {
      await fetchKeywords();
    }

    if (options.journal) {
      await fetchJournals();
    }

    log.info('所有任务完成');
    process.exit(0);
  } catch (error) {
    log.error({ error }, '执行失败');
    process.exit(1);
  }
}

main();
