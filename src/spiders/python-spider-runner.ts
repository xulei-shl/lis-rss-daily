/**
 * Python Spider Runner
 * Python 爬虫子进程调用封装
 * 
 * 通过 Node.js child_process 调用现有的 Python 爬虫脚本
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import type { JournalSourceType, SpiderRunParams, SpiderResult, CrawledArticle } from './types.js';

const log = logger.child({ module: 'python-spider-runner' });

/**
 * Python 爬虫运行器
 */
export class PythonSpiderRunner {
  private pythonPath: string;
  private scriptsDir: string;

  constructor() {
    // Python 解释器路径，可通过环境变量配置
    this.pythonPath = process.env.PYTHON_PATH || 'python';
    
    // Python 脚本目录
    // 开发环境：docs/期刊网页定时爬取/
    // 生产环境：需要将脚本复制到相应位置
    this.scriptsDir = this.getScriptsDir();
  }

  /**
   * 获取 Python 脚本目录
   */
  private getScriptsDir(): string {
    // 优先使用环境变量配置
    if (process.env.SPIDER_SCRIPTS_DIR) {
      return process.env.SPIDER_SCRIPTS_DIR;
    }

    // 默认使用 src/spiders/ 目录
    // 获取项目根目录
    const currentDir = process.cwd();
    return path.join(currentDir, 'src', 'spiders');
  }

  /**
   * 运行 Python 爬虫
   */
  async runSpider(
    spiderType: JournalSourceType,
    params: SpiderRunParams
  ): Promise<SpiderResult> {
    return new Promise((resolve, reject) => {
      const scriptMap: Record<JournalSourceType, string> = {
        cnki: 'cnki_spider.py',
        rdfybk: 'rdfybk_spider.py',
        lis: 'lis_spider.py',
      };

      const script = scriptMap[spiderType];
      const args = this.buildArgs(spiderType, params);

      log.info({ script, args, cwd: this.scriptsDir }, 'Running Python spider');

      const startTime = Date.now();

      const proc = spawn(this.pythonPath, [script, ...args], {
        cwd: this.scriptsDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        // Python 脚本的进度输出会到 stderr，记录但不视为错误
        log.debug({ output: data.toString().trim() }, 'Python stderr output');
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        log.info({ script, code, duration }, 'Python spider finished');

        if (code === 0) {
          try {
            // 解析 JSON 输出
            const result = this.parseOutput(stdout, spiderType);
            resolve(result);
          } catch (e) {
            log.error({ stdout, error: e }, 'Failed to parse spider output');
            resolve({
              success: false,
              articles: [],
              error: `Failed to parse output: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        } else {
          log.error({ code, stderr }, 'Python spider failed');
          resolve({
            success: false,
            articles: [],
            error: stderr || `Process exited with code ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        log.error({ error: err }, 'Failed to start Python process');
        reject(err);
      });

      // 设置超时
      const timeout = parseInt(process.env.SPIDER_TIMEOUT || '300000', 10); // 默认 5 分钟
      setTimeout(() => {
        if (!proc.killed) {
          log.warn({ script, timeout }, 'Python spider timeout, killing process');
          proc.kill();
          resolve({
            success: false,
            articles: [],
            error: `Spider timeout after ${timeout}ms`,
          });
        }
      }, timeout);
    });
  }

  /**
   * 根据爬虫类型构建命令行参数
   */
  private buildArgs(type: JournalSourceType, params: SpiderRunParams): string[] {
    const args: string[] = [];

    switch (type) {
      case 'cnki':
        // CNKI 爬虫参数
        // python cnki_spider.py -u URL -y YEAR -i ISSUE
        if (params.url) {
          args.push('-u', params.url);
        }
        args.push('-y', String(params.year));
        args.push('-i', String(params.issue));
        // 默认获取详情
        args.push('-d');
        // 使用异步模式（更快）
        args.push('-c', '3');
        break;

      case 'rdfybk':
        // 人大报刊爬虫参数
        // python rdfybk_spider.py -j CODE -y YEAR -i ISSUE
        if (params.code) {
          args.push('-j', params.code);
        }
        args.push('-y', String(params.year));
        args.push('-i', String(params.issue));
        // 获取详情
        args.push('-d');
        // 使用异步模式
        args.push('-c', '3');
        break;

      case 'lis':
        // LIS 爬虫参数
        // python lis_spider.py -y YEAR -i ISSUE [-v VOLUME]
        args.push('-y', String(params.year));
        args.push('-i', String(params.issue));
        if (params.volume) {
          args.push('-v', String(params.volume));
        }
        break;
    }

    // 添加输出参数（输出到 stdout）
    args.push('-o', '-');  // 使用 - 表示输出到 stdout

    return args;
  }

  /**
   * 解析 Python 爬虫输出
   */
  private parseOutput(stdout: string, spiderType: JournalSourceType): SpiderResult {
    // 尝试提取 JSON 部分
    // Python 脚本可能输出一些日志信息，需要找到 JSON 部分
    let jsonStr = stdout.trim();

    // 如果输出包含多行，尝试找到 JSON 数组
    const lines = jsonStr.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('[') || line.startsWith('{')) {
        // 找到 JSON 开始位置
        jsonStr = lines.slice(i).join('\n');
        break;
      }
    }

    // 尝试找到完整的 JSON 数组
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    try {
      const data = JSON.parse(jsonStr);
      
      // 转换为标准格式
      const articles: CrawledArticle[] = (Array.isArray(data) ? data : []).map((item: any) => ({
        title: item.title || '',
        url: item.abstract_url || item.url || '',
        author: item.author,
        abstract: item.abstract,
        keywords: item.keywords ? this.parseKeywords(item.keywords) : undefined,
        publishedYear: item.year || 0,
        publishedIssue: item.issue || 0,
        publishedVolume: item.volume,
        pages: item.pages,
        doi: item.doi,
      }));

      return {
        success: true,
        articles,
      };
    } catch (e) {
      // 如果解析失败，返回空结果
      log.warn({ stdout: stdout.substring(0, 500), error: e }, 'JSON parse failed, returning empty result');
      return {
        success: false,
        articles: [],
        error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * 解析关键词字符串为数组
   */
  private parseKeywords(keywords: string | string[]): string[] {
    if (Array.isArray(keywords)) {
      return keywords;
    }
    // 关键词可能是分号或逗号分隔的字符串
    return keywords.split(/[;；,，]/).map(k => k.trim()).filter(Boolean);
  }
}

// 导出单例实例
export const pythonSpiderRunner = new PythonSpiderRunner();
