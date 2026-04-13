import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

process.env.DATABASE_PATH = path.join(rootDir, 'data', 'rss-tracker.db');

import { parseArgs } from 'util';
import { readInputFile } from './md-parser.js';
import { runDeepSearch } from './deepsearch.js';

interface CliOptions {
  input: string;
  json: string;
  config?: string;
  rounds?: number;
  threshold?: number;
  limit?: number;
  maxFinal?: number;
  skipPdfSummary?: boolean;
  output?: string;
  result?: string;
}

function parseCliArgs(): CliOptions {
  const options = {
    input: {
      type: 'string' as const,
      short: 'i',
    },
    json: {
      type: 'string' as const,
      short: 'j',
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
    maxFinal: {
      type: 'string' as const,
      short: 'm',
    },
    skipPdfSummary: {
      type: 'boolean' as const,
    },
    output: {
      type: 'string' as const,
      short: 'o',
    },
    result: {
      type: 'string' as const,
    },
    help: {
      type: 'boolean' as const,
      short: 'h',
    },
  };

  const { values } = parseArgs({ options, allowPositionals: false });

  if (!values.input && !values.json) {
    console.error('错误: 请提供输入 (--input 或 --json)');
    printHelp();
    process.exit(1);
  }

  return {
    input: values.input as string || '',
    json: values.json as string || '',
    config: values.config as string | undefined,
    rounds: values.rounds ? parseInt(values.rounds as string, 10) : undefined,
    threshold: values.threshold ? parseFloat(values.threshold as string) : undefined,
    limit: values.limit ? parseInt(values.limit as string, 10) : undefined,
    maxFinal: values.maxFinal ? parseInt(values.maxFinal as string, 10) : undefined,
    skipPdfSummary: values.skipPdfSummary as boolean | undefined,
    output: values.output as string | undefined,
    result: values.result as string | undefined,
  };
}

function printHelp(): void {
  console.log(`
DeepSearch - 深度检索工具

用法: node cli.js [选项]

选项:
  -i, --input <path>      输入 MD 文件路径 (与 --json 二选一)
  -j, --json <path>      JSON 格式输入文件 (包含 inputMd 等参数)
  -c, --config <path>    配置文件路径 (可选)
  -r, --rounds <n>        迭代检索轮次 (可选，覆盖配置)
  -t, --threshold <n>    相关性分数阈值 (可选，覆盖配置)
  -l, --limit <n>        语义检索返回数量 (可选，覆盖配置)
  -m, --maxFinal <n>    最终结果保留数量 (可选，覆盖配置)
      --skipPdfSummary   跳过 PDF 总结，直接导出文章内容
  -o, --output <dir>     输出目录 (可选，覆盖配置)
      --result <path>    结果 JSON 文件输出路径 (可选)
  -h, --help             显示帮助信息

示例:
  node cli.js -i ./input.md
  node cli.js -i ./input.md -r 2 -t 0.7
  node cli.js --json /tmp/input.json
  `);
}

async function main(): Promise<void> {
  const options = parseCliArgs();

  try {
    let inputMd: string;
    let runOptions: {
      rounds?: number;
      scoreThreshold?: number;
      semanticLimit?: number;
      maxFinalArticles?: number;
      skipPdfSummary?: boolean;
      outputDir?: string;
      configPath?: string;
    } = {};

    if (options.json) {
      console.log('从 JSON 文件读取输入:', options.json);
      const fs = await import('fs');
      const inputData = JSON.parse(fs.readFileSync(options.json, 'utf-8'));
      inputMd = inputData.inputMd;
      runOptions = {
        rounds: inputData.rounds,
        scoreThreshold: inputData.scoreThreshold,
        semanticLimit: inputData.semanticLimit,
        maxFinalArticles: inputData.maxFinalArticles,
        skipPdfSummary: inputData.skipPdfSummary,
        outputDir: inputData.outputDir,
        configPath: inputData.configPath,
      };
    } else {
      console.log('读取输入文件:', options.input);
      inputMd = readInputFile(options.input);
      runOptions = {
        rounds: options.rounds,
        scoreThreshold: options.threshold,
        semanticLimit: options.limit,
        maxFinalArticles: options.maxFinal,
        skipPdfSummary: options.skipPdfSummary,
        outputDir: options.output,
        configPath: options.config,
      };
    }

    const result = await runDeepSearch({
      inputMd,
      ...runOptions,
    });

    console.log('\n执行完成!');
    console.log('报告路径:', result.reportPath);
    console.log('文章目录:', result.articlesDir);
    console.log('文章数量:', result.articleCount);
    console.log('PDF 总结成功:', result.pdfSummarySuccess);
    console.log('PDF 总结失败:', result.pdfSummaryFailed);
    console.log('PDF 总结跳过:', result.pdfSummarySkipped);

    if (options.json) {
      console.log('\n输出 JSON 结果:');
      console.log(JSON.stringify(result, null, 2));
    }

    if (options.result) {
      const fs = await import('fs');
      fs.writeFileSync(options.result, JSON.stringify(result, null, 2), 'utf-8');
      console.log('结果已写入:', options.result);
    }
  } catch (error) {
    console.error('执行失败:', error);
    process.exit(1);
  }
}

main();
