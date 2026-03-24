import { parseArgs } from 'util';
import { readInputFile } from './md-parser.js';
import { runDeepSearch } from './deepsearch.js';

interface CliOptions {
  input: string;
  config?: string;
  rounds?: number;
  threshold?: number;
  limit?: number;
  output?: string;
}

function parseCliArgs(): CliOptions {
  const options = {
    input: {
      type: 'string' as const,
      short: 'i',
    },
    config: {
      type: 'string' as const,
      short: 'c',
    },
    rounds: {
      type: 'string' as const,
      short: 'r',
    },
    threshold: {
      type: 'string' as const,
      short: 't',
    },
    limit: {
      type: 'string' as const,
      short: 'l',
    },
    output: {
      type: 'string' as const,
      short: 'o',
    },
    help: {
      type: 'boolean' as const,
      short: 'h',
    },
  };

  const { values } = parseArgs({ options, allowPositionals: false });

  if (!values.input) {
    console.error('错误: 请提供输入 MD 文件路径 (--input, -i)');
    printHelp();
    process.exit(1);
  }

  return {
    input: values.input as string,
    config: values.config as string | undefined,
    rounds: values.rounds ? parseInt(values.rounds as string, 10) : undefined,
    threshold: values.threshold ? parseFloat(values.threshold as string) : undefined,
    limit: values.limit ? parseInt(values.limit as string, 10) : undefined,
    output: values.output as string | undefined,
  };
}

function printHelp(): void {
  console.log(`
DeepSearch - 深度检索工具

用法: node cli.js [选项]

选项:
  -i, --input <path>      输入 MD 文件路径 (必填)
  -c, --config <path>    配置文件路径 (可选)
  -r, --rounds <n>        迭代检索轮次 (可选，覆盖配置)
  -t, --threshold <n>    相关性分数阈值 (可选，覆盖配置)
  -l, --limit <n>        语义检索返回数量 (可选，覆盖配置)
  -o, --output <dir>     输出目录 (可选，覆盖配置)
  -h, --help             显示帮助信息

示例:
  node cli.js -i ./input.md
  node cli.js -i ./input.md -r 2 -t 0.7
  `);
}

async function main(): Promise<void> {
  const options = parseCliArgs();

  try {
    console.log('读取输入文件:', options.input);
    const inputMd = readInputFile(options.input);

    const result = await runDeepSearch({
      inputMd,
      rounds: options.rounds,
      scoreThreshold: options.threshold,
      semanticLimit: options.limit,
      outputDir: options.output,
      configPath: options.config,
    });

    console.log('\n执行完成!');
    console.log('报告路径:', result.reportPath);
    console.log('文章目录:', result.articlesDir);
    console.log('文章数量:', result.articleCount);
    console.log('PDF 总结成功:', result.pdfSummarySuccess);
    console.log('PDF 总结失败:', result.pdfSummaryFailed);
    console.log('PDF 总结跳过:', result.pdfSummarySkipped);
  } catch (error) {
    console.error('执行失败:', error);
    process.exit(1);
  }
}

main();