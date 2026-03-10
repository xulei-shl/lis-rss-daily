#!/usr/bin/env tsx
/**
 * 企业微信 + Telegram 推送完整流程测试脚本
 *
 * 测试内容：
 * 1. 获取当天的全部期刊文章列表
 * 2. 调用 LLM 生成总结
 * 3. 写入数据库 (daily_summaries 表)
 * 4. 推送到企业微信
 * 5. 推送到 Telegram
 *
 * 使用方式:
 *   tsx scripts/test-wechat-full-flow.ts --user-id 1 [--date 2026-03-09] [--skip-push] [--skip-llm]
 *
 * 参数说明:
 *   --user-id, -u    用户 ID (必需)
 *   --date, -d       日期 (YYYY-MM-DD 格式，默认今天)
 *   --skip-push      跳过所有推送（只生成总结和写入数据库）
 *   --skip-llm       跳过 LLM 生成（只用模拟总结，不消耗 token）
 *   --help, -h       显示帮助信息
 */

// 初始化环境
import 'dotenv/config';
import '../src/config.js';

import {
  getAllJournalArticles,
  generateJournalAllSummary,
  getDailySummaryByDate,
  saveDailySummary,
  type DailySummaryArticle,
  type DailySummaryResult,
} from '../src/api/daily-summary.js';
import { getUserLocalDate } from '../src/api/timezone.js';
import { getWeChatNotifier } from '../src/wechat/index.js';
import { getTelegramNotifier } from '../src/telegram/index.js';
import { getWebhooksForPushType } from '../src/config/wechat-config.js';
import { getJournalAllChats } from '../src/api/telegram-chats.js';
import { logger } from '../src/logger.js';

const log = logger.child({ module: 'test-wechat-full-flow' });

// 颜色输出
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function printHelp() {
  console.log(`
${COLORS.bold}企业微信 + Telegram 推送完整流程测试脚本${COLORS.reset}

测试内容：
  1. 获取当天的全部期刊文章列表
  2. 调用 LLM 生成总结
  3. 写入数据库 (daily_summaries 表)
  4. 推送到企业微信
  5. 推送到 Telegram

${COLORS.bold}使用方式:${COLORS.reset}
  tsx scripts/test-wechat-full-flow.ts --user-id 1 [选项]

${COLORS.bold}必需参数:${COLORS.reset}
  --user-id, -u    用户 ID

${COLORS.bold}可选参数:${COLORS.reset}
  --date, -d       日期 (YYYY-MM-DD 格式，默认今天)
  --skip-push      跳过所有推送（只生成总结和写入数据库）
  --skip-llm       跳过 LLM 生成（只用模拟总结，不消耗 token）
  --help, -h       显示此帮助信息

${COLORS.bold}示例:${COLORS.reset}
  tsx scripts/test-wechat-full-flow.ts -u 1
  tsx scripts/test-wechat-full-flow.ts -u 1 -d 2026-03-09
  tsx scripts/test-wechat-full-flow.ts -u 1 --skip-llm --skip-push
`);
}

interface Args {
  userId: number;
  date?: string;
  skipPush: boolean;
  skipLlm: boolean;
}

function parseArgs(args: string[]): Args {
  const result: Args = {
    userId: 0,
    skipPush: false,
    skipLlm: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--user-id':
      case '-u':
        if (!nextArg) throw new Error('--user-id 需要一个值');
        result.userId = parseInt(nextArg, 10);
        i++;
        break;
      case '--date':
      case '-d':
        if (!nextArg) throw new Error('--date 需要一个值');
        result.date = nextArg;
        i++;
        break;
      case '--skip-push':
        result.skipPush = true;
        break;
      case '--skip-llm':
        result.skipLlm = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  if (!result.userId) {
    throw new Error('--user-id 是必需参数');
  }

  return result;
}

async function step1GetArticles(userId: number, date: string): Promise<DailySummaryArticle[]> {
  console.log(`\n${COLORS.cyan}${COLORS.bold}═══ 步骤 1: 获取期刊文章列表 ═══${COLORS.reset}`);
  console.log(`${COLORS.blue}日期:${COLORS.reset} ${date}`);

  const articles = await getAllJournalArticles(userId, date);

  console.log(`${COLORS.green}✓ 找到 ${articles.length} 篇文章${COLORS.reset}`);

  if (articles.length > 0) {
    console.log(`\n${COLORS.bold}文章列表:${COLORS.reset}`);
    articles.forEach((article, idx) => {
      console.log(`  ${idx + 1}. ${article.title.substring(0, 60)}${article.title.length > 60 ? '...' : ''}`);
      console.log(`     ${COLORS.yellow}来源:${COLORS.reset} ${article.source_name}`);
    });
  }

  return articles;
}

interface GenerateSummaryResult {
  summaryResult: DailySummaryResult;
  fromCache: boolean;
}

async function step2GenerateSummary(
  userId: number,
  date: string,
  articles: DailySummaryArticle[],
  skipLlm: boolean
): Promise<GenerateSummaryResult> {
  console.log(`\n${COLORS.cyan}${COLORS.bold}═══ 步骤 2: 生成总结 ═══${COLORS.reset}`);

  // 先检查数据库中是否已存在
  const existing = await getDailySummaryByDate(userId, date, 'journal_all');
  if (existing) {
    console.log(`${COLORS.green}✓ 数据库中已存在该日期的总结，直接使用${COLORS.reset}`);
    console.log(`${COLORS.blue}创建时间:${COLORS.reset} ${new Date(existing.created_at).toLocaleString('zh-CN')}`);
    console.log(`\n${COLORS.bold}总结预览:${COLORS.reset}`);
    console.log('─'.repeat(60));
    console.log(existing.summary_content.substring(0, 500) + (existing.summary_content.length > 500 ? '...' : ''));
    console.log('─'.repeat(60));

    return {
      summaryResult: {
        date,
        type: 'journal_all',
        totalArticles: existing.article_count,
        articlesByType: existing.articles_data as DailySummaryResult['articlesByType'],
        summary: existing.summary_content,
        generatedAt: existing.created_at,
      },
      fromCache: true,
    };
  }

  if (skipLlm) {
    console.log(`${COLORS.yellow}跳过 LLM 生成，使用模拟总结${COLORS.reset}`);
    const mockSummary = `# 测试总结

这是一个模拟的总结内容，用于测试推送功能，不消耗 LLM token。

## 今日要点

- 共收录 ${articles.length} 篇文章
- 内容涵盖多个领域

---
*由测试脚本生成于 ${new Date().toLocaleString('zh-CN')}*`;

    return {
      summaryResult: {
        date,
        type: 'journal_all',
        totalArticles: articles.length,
        articlesByType: {
          journal: articles,
          blog: [],
          news: [],
        },
        summary: mockSummary,
        generatedAt: new Date().toISOString(),
      },
      fromCache: false,
    };
  }

  console.log(`${COLORS.blue}调用 LLM 生成总结...${COLORS.reset}`);
  const result = await generateJournalAllSummary({ userId, date });

  console.log(`${COLORS.green}✓ 总结生成成功${COLORS.reset}`);
  console.log(`\n${COLORS.bold}总结预览:${COLORS.reset}`);
  console.log('─'.repeat(60));
  console.log(result.summary.substring(0, 500) + (result.summary.length > 500 ? '...' : ''));
  console.log('─'.repeat(60));

  return {
    summaryResult: result,
    fromCache: false,
  };
}

async function step3SaveToDatabase(
  userId: number,
  summaryResult: DailySummaryResult,
  fromCache: boolean
) {
  console.log(`\n${COLORS.cyan}${COLORS.bold}═══ 步骤 3: 写入数据库 ═══${COLORS.reset}`);

  // 如果是从缓存加载的，跳过保存
  if (fromCache) {
    console.log(`${COLORS.yellow}总结从数据库缓存加载，跳过保存${COLORS.reset}`);
    return;
  }

  // 检查是否已存在
  const existing = await getDailySummaryByDate(userId, summaryResult.date, 'journal_all');
  if (existing) {
    console.log(`${COLORS.yellow}数据库中已存在该日期的总结，将覆盖${COLORS.reset}`);
  }

  await saveDailySummary({
    userId,
    date: summaryResult.date,
    type: summaryResult.type,
    articleCount: summaryResult.totalArticles,
    summaryContent: summaryResult.summary,
    articlesData: summaryResult.articlesByType,
  });

  console.log(`${COLORS.green}✓ 已保存到数据库${COLORS.reset}`);

  // 验证保存成功
  const saved = await getDailySummaryByDate(userId, summaryResult.date, 'journal_all');
  if (saved) {
    console.log(`${COLORS.blue}验证:${COLORS.reset} ID=${saved.id}, 文章数=${saved.article_count}`);
  }
}

async function step4PushToWeChat(
  userId: number,
  summaryResult: DailySummaryResult,
  articles: DailySummaryArticle[]
) {
  console.log(`\n${COLORS.cyan}${COLORS.bold}═══ 步骤 4: 推送企业微信 ═══${COLORS.reset}`);

  // 检查配置的 webhooks
  const webhooks = getWebhooksForPushType('journal_all');
  console.log(`${COLORS.blue}配置的 webhook 数量:${COLORS.reset} ${webhooks.length}`);

  if (webhooks.length === 0) {
    console.log(`${COLORS.yellow}没有配置启用了"全部期刊总结"的 webhook，跳过推送${COLORS.reset}`);
    return;
  }

  webhooks.forEach((wh) => {
    console.log(`  - ${wh.name} (${wh.id})`);
  });

  console.log(`\n${COLORS.blue}发送推送...${COLORS.reset}`);

  const notifier = getWeChatNotifier();
  const success = await notifier.sendJournalAllSummary(userId, {
    date: summaryResult.date,
    totalArticles: summaryResult.totalArticles,
    summary: summaryResult.summary,
    articles,
  });

  if (success) {
    console.log(`${COLORS.green}✓ 推送成功${COLORS.reset}`);
  } else {
    console.log(`${COLORS.red}✗ 推送送失败，请查看日志${COLORS.reset}`);
  }
}

async function step5PushToTelegram(
  userId: number,
  summaryResult: DailySummaryResult
) {
  console.log(`\n${COLORS.cyan}${COLORS.bold}═══ 步骤 5: 推送 Telegram ═══${COLORS.reset}`);

  // 检查配置的 chats
  const chats = await getJournalAllChats(userId);
  console.log(`${COLORS.blue}配置的 chat 数量:${COLORS.reset} ${chats.length}`);

  if (chats.length === 0) {
    console.log(`${COLORS.yellow}没有配置启用了"全部期刊总结"的 chat，跳过推送${COLORS.reset}`);
    return;
  }

  chats.forEach((chat) => {
    console.log(`  - ${chat.chatName} (${chat.chatId})`);
  });

  console.log(`\n${COLORS.blue}发送推送...${COLORS.reset}`);

  const notifier = getTelegramNotifier();
  const success = await notifier.sendJournalAllSummary(userId, {
    date: summaryResult.date,
    type: 'journal_all',
    totalArticles: summaryResult.totalArticles,
    summary: summaryResult.summary,
    articlesByType: summaryResult.articlesByType,
  });

  if (success) {
    console.log(`${COLORS.green}✓ 推送成功${COLORS.reset}`);
  } else {
    console.log(`${COLORS.red}✗ 推送失败，请查看日志${COLORS.reset}`);
  }
}

async function main() {
  console.log(`${COLORS.magenta}${COLORS.bold}
╔══════════════════════════════════════════════════════════════╗
║        企业微信 + Telegram 推送 - 完整流程测试               ║
╚══════════════════════════════════════════════════════════════╝
${COLORS.reset}`);

  try {
    const args = parseArgs(process.argv.slice(2));

    // 确定日期
    const date = args.date || await getUserLocalDate(args.userId);

    console.log(`${COLORS.bold}测试配置:${COLORS.reset}`);
    console.log(`  用户 ID: ${args.userId}`);
    console.log(`  日期: ${date}`);
    console.log(`  跳过 LLM: ${args.skipLlm ? '是' : '否'}`);
    console.log(`  跳过推送: ${args.skipPush ? '是' : '否'}`);

    // 步骤 1: 获取文章
    const articles = await step1GetArticles(args.userId, date);

    if (articles.length === 0) {
      console.log(`\n${COLORS.yellow}没有找到文章，测试结束${COLORS.reset}`);
      process.exit(0);
    }

    // 步骤 2: 生成总结
    const { summaryResult, fromCache } = await step2GenerateSummary(args.userId, date, articles, args.skipLlm);

    // 步骤 3: 写入数据库
    await step3SaveToDatabase(args.userId, summaryResult, fromCache);

    // 步骤 4-5: 推送
    if (!args.skipPush) {
      await step4PushToWeChat(args.userId, summaryResult, articles);
      await step5PushToTelegram(args.userId, summaryResult);
    } else {
      console.log(`\n${COLORS.yellow}跳过推送${COLORS.reset}`);
    }

    console.log(`\n${COLORS.green}${COLORS.bold}✓ 测试完成!${COLORS.reset}`);

  } catch (error) {
    console.error(`\n${COLORS.red}${COLORS.bold}✗ 测试失败:${COLORS.reset}`);
    console.error(error);
    process.exit(1);
  }
}

main();
