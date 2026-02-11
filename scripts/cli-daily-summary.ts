/**
 * 每日总结 CLI 工具
 *
 * 使用方式:
 *   tsx scripts/cli-daily-summary.ts --user-id 1 [--date 2025-02-11] [--limit 30] [--api-key SECRET]
 *
 * 环境变量:
 *   CLI_API_KEY - CLI API 密钥（可通过 --api-key 参数覆盖）
 *   BASE_URL - 服务地址（默认 http://localhost:8007）
 */

export {};

interface CliResponse {
  status: 'success' | 'empty' | 'error';
  message?: string;
  data?: any;
  error?: string;
}

// 解析命令行参数
function parseArgs(args: string[]): {
  userId: number;
  date?: string;
  limit?: number;
  apiKey: string;
  baseUrl: string;
  json: boolean;
  pretty: boolean;
} {
  const result: any = {
    baseUrl: process.env.BASE_URL || 'http://localhost:8007',
    json: false,
    pretty: false,
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
      case '--limit':
      case '-l':
        if (!nextArg) throw new Error('--limit 需要一个值');
        result.limit = parseInt(nextArg, 10);
        i++;
        break;
      case '--api-key':
      case '-k':
        if (!nextArg) throw new Error('--api-key 需要一个值');
        result.apiKey = nextArg;
        i++;
        break;
      case '--base-url':
        if (!nextArg) throw new Error('--base-url 需要一个值');
        result.baseUrl = nextArg.replace(/\/$/, '');
        i++;
        break;
      case '--json':
        result.json = true;
        break;
      case '--pretty':
        result.pretty = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  // 验证必需参数
  if (!result.userId) {
    throw new Error('--user-id 是必需参数');
  }

  // API Key 优先使用命令行参数，其次环境变量
  if (!result.apiKey) {
    result.apiKey = process.env.CLI_API_KEY || '';
  }

  if (!result.apiKey) {
    throw new Error('--api-key 或 CLI_API_KEY 环境变量是必需的');
  }

  return result;
}

function printHelp() {
  console.log(`
每日总结 CLI 工具

使用方式:
  tsx scripts/cli-daily-summary.ts --user-id 1 [选项]

必需参数:
  --user-id, -u     用户 ID
  --api-key, -k     CLI API 密钥（或使用 CLI_API_KEY 环境变量）

可选参数:
  --date, -d        日期 (YYYY-MM-DD 格式，默认今天)
  --limit, -l       文章数量限制 (默认 30)
  --base-url        服务地址 (默认 http://localhost:8007)
  --json            输出纯 JSON 格式
  --pretty          美化输出（带颜色和格式）
  --help, -h        显示此帮助信息

环境变量:
  CLI_API_KEY       CLI API 密钥
  BASE_URL          服务地址

示例:
  tsx scripts/cli-daily-summary.ts --user-id 1 --api-key mykey
  tsx scripts/cli-daily-summary.ts -u 1 -d 2025-02-11 -l 50 --json
  `);
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    // 构建请求 URL 和 Body
    const url = new URL(`${args.baseUrl}/api/daily-summary/cli`);
    url.searchParams.append('user_id', args.userId.toString());
    url.searchParams.append('api_key', args.apiKey);

    const body: any = {};
    if (args.date) body.date = args.date;
    if (args.limit) body.limit = args.limit;

    // 发送请求
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data: CliResponse = await response.json();

    // 处理响应
    if (!response.ok) {
      if (args.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.error(`错误 (${response.status}): ${data.error || '未知错误'}`);
      }
      process.exit(1);
    }

    // 成功响应
    if (args.json) {
      console.log(JSON.stringify(data, null, 2));
    } else if (args.pretty) {
      printPrettyResult(data);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`错误: ${message}`);
    process.exit(1);
  }
}

function printPrettyResult(data: CliResponse): void {
  const RESET = '\x1b[0m';
  const GREEN = '\x1b[32m';
  const YELLOW = '\x1b[33m';
  const BLUE = '\x1b[34m';
  const GRAY = '\x1b[90m';
  const BOLD = '\x1b[1m';

  if (data.status === 'error') {
    console.log(`${RED}错误:${RESET} ${data.error}`);
    return;
  }

  if (data.status === 'empty') {
    console.log(`${YELLOW}${BOLD}○ 无新文章${RESET}`);
    console.log(`${GRAY}${data.message}${RESET}`);
    return;
  }

  // Success
  const result = data.data!;
  console.log(`${GREEN}${BOLD}✓ 每日总结生成成功${RESET}\n`);

  // Meta info
  console.log(`${BLUE}日期:${RESET} ${result.date}`);
  console.log(`${BLUE}文章数:${RESET} ${result.totalArticles}`);
  console.log(
    `${BLUE}生成时间:${RESET} ${new Date(result.generatedAt).toLocaleString('zh-CN')}`
  );
  console.log();

  // Summary
  console.log(`${BOLD}总结内容:${RESET}`);
  console.log('─'.repeat(50));
  console.log(result.summary);
  console.log('─'.repeat(50));
  console.log();

  // Articles by type
  const typeLabels: Record<string, string> = {
    journal: '期刊精选',
    blog: '博客推荐',
    news: '资讯动态',
  };

  for (const [type, label] of Object.entries(typeLabels)) {
    const articles = result.articlesByType[type];
    if (!articles || articles.length === 0) continue;

    console.log(`${BOLD}${label}:${RESET}`);
    articles.forEach((article: any, idx: number) => {
      console.log(`  ${idx + 1}. ${article.title}`);
      console.log(`     ${GRAY}${article.url}${RESET}`);
    });
    console.log();
  }
}

const RED = '\x1b[31m';

main();
