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
        // python lis_spider.py -y YEAR -i ISSUE [-v VOLUME] [-t TIMEOUT] [-r RETRIES]
        args.push('-y', String(params.year));
        args.push('-i', String(params.issue));
        if (params.volume) {
          args.push('-v', String(params.volume));
        }
        // 添加超时参数（3分钟）
        args.push('-t', '180000');
        // 添加重试次数
        args.push('-r', '3');
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

    // 方法1：找到第一个 [ 或 { 作为 JSON 起点（从前往后找，避免误判内容中的 [）
    let jsonStart = -1;
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === '[' || jsonStr[i] === '{') {
        jsonStart = i;
        break;
      }
    }
    if (jsonStart >= 0) {
      jsonStr = jsonStr.substring(jsonStart);
    }

    // 方法2：尝试找到完整的 JSON 数组（使用括号匹配）
    // 找到匹配的闭合括号
    if (jsonStr.startsWith('[')) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === '[') depth++;
          else if (char === ']') {
            depth--;
            if (depth === 0) {
              jsonStr = jsonStr.substring(0, i + 1);
              break;
            }
          }
        }
      }
    }

    try {
      const data = JSON.parse(jsonStr);
      
      // 转换为标准格式，过滤掉缺少必填字段的文章
      const articles: CrawledArticle[] = (Array.isArray(data) ? data : [])
        .filter((item: any) => {
          // 必须有标题和 URL
          if (!item || !item.title || !item.title.trim()) {
            log.debug({ item }, 'Skipping article without title');
            return false;
          }
          const url = item.abstract_url || item.url;
          if (!url || !url.trim()) {
            log.debug({ item }, 'Skipping article without URL');
            return false;
          }
          return true;
        })
        .map((item: any) => ({
          title: item.title.trim(),
          url: (item.abstract_url || item.url).trim(),
          author: item.author || undefined,
          abstract: item.abstract || undefined,
          keywords: item.keywords ? this.parseKeywords(item.keywords) : undefined,
          publishedYear: item.year || 0,
          publishedIssue: item.issue || 0,
          publishedVolume: item.volume,
          pages: item.pages,
          doi: item.doi,
        }));

      log.info({ articleCount: articles.length }, 'Parsed articles from spider output');
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
