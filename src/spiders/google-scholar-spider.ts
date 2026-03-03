/**
 * Google Scholar Spider Adapter
 *
 * 调用项目内的 Google Scholar 爬虫进行学术检索
 * 支持通过环境变量传递代理配置（复用 TELEGRAM_PROXY）
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { logger } from '../logger.js';
import type { SpiderResult, CrawledArticle } from './types.js';
import { config } from '../config.js';

const log = logger.child({ module: 'google-scholar-spider' });

/**
 * Google Scholar 爬虫参数
 */
export interface GoogleScholarSearchParams {
  keyword: string;
  yearStart?: number;
  yearEnd?: number;
  numResults?: number;
}

/**
 * Google Scholar 原始结果
 */
interface GoogleScholarRawResult {
  title: string;
  url: string;
  meta: string;  // 格式：作者, 期刊名, 年份
  abstract: string;
  cited_by?: number;
  pdf_link?: string;
}

/**
 * Google Scholar 爬虫响应
 */
interface GoogleScholarResponse {
  query: string;
  year_start?: number;
  year_end?: number;
  total_results: number;
  results: GoogleScholarRawResult[];
  url: string;
  timestamp: string;
}

/**
 * Google Scholar 爬虫适配器
 */
export class GoogleScholarSpider {
  private spiderPath: string;

  constructor() {
    // 指向项目内的爬虫脚本目录
    this.spiderPath = '/opt/lis-rss-daily/src/spiders/google_scholar';
  }

  /**
   * 执行搜索
   */
  async search(params: GoogleScholarSearchParams): Promise<SpiderResult> {
    const { keyword, yearStart, yearEnd, numResults = 20 } = params;

    log.info({ keyword, yearStart, yearEnd, numResults }, 'Starting Google Scholar search');

    const args = ['scripts/cli.py', keyword, '-o', '/tmp', '--no-geoip'];

    // 年份范围（可选）
    if (yearStart) {
      const yearRange = yearEnd ? `${yearStart}-${yearEnd}` : String(yearStart);
      args.push('-y', yearRange);
    }

    // 结果数量（默认 20）
    if (numResults) {
      args.push('-n', String(numResults));
    }

    // 代理配置（复用 TELEGRAM_PROXY）
    const proxy = config.telegramProxy;

    return new Promise((resolve, reject) => {
      // 构建环境变量
      const env = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      };

      // 如果配置了代理，传递给爬虫脚本
      if (proxy) {
        args.push('--proxy', proxy);
        log.info({ proxy }, 'Using proxy for Google Scholar spider');
      }

      const proc = spawn('python3', args, {
        cwd: this.spiderPath,
        env
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', async (code) => {
        if (code !== 0) {
          log.error({ stderr, code }, 'Google Scholar spider failed');
          return reject(new Error(`Spider failed with code ${code}: ${stderr}`));
        }

        try {
          // 从stdout提取JSON文件路径
          const lines = stdout.trim().split('\n');
          const jsonLine = lines.find(l => l.includes('JSON:') && l.includes('.json'));

          if (!jsonLine) {
            throw new Error('No JSON file path found in spider response');
          }

          // 提取JSON文件路径
          const jsonPathMatch = jsonLine.match(/JSON:\s*(\/tmp\/[^\s]+\.json)/);
          if (!jsonPathMatch) {
            throw new Error('Failed to extract JSON file path');
          }

          const jsonPath = jsonPathMatch[1];
          log.info({ jsonPath }, 'Reading JSON output file');

          // 读取JSON文件
          const jsonContent = await readFile(jsonPath, 'utf-8');
          const raw: GoogleScholarResponse = JSON.parse(jsonContent);

          // 映射到标准格式
          const articles: CrawledArticle[] = raw.results?.map((r: GoogleScholarRawResult) => ({
            title: r.title,
            url: r.url,
            abstract: r.abstract,
            author: this.extractAuthor(r.meta),
            publishedYear: this.extractYear(r.meta) || new Date().getFullYear(),
            publishedIssue: 0,  // Google Scholar 无期号概念
            publishedVolume: undefined,
            keywords: []  // Google Scholar 不返回关键词
          })) || [];

          log.info({ totalResults: raw.total_results, articlesCount: articles.length }, 'Google Scholar search completed');

          resolve({
            success: true,
            articles,
            error: undefined
          });
        } catch (err) {
          log.error({ err, stdout }, 'Failed to parse spider output');
          reject(new Error(`Failed to parse spider output: ${err instanceof Error ? err.message : String(err)}`));
        }
      });

      proc.on('error', (err) => {
        log.error({ err }, 'Failed to spawn spider process');
        reject(new Error(`Failed to spawn spider: ${err.message}`));
      });
    });
  }

  /**
   * 从 meta 字段提取作者信息
   * 格式：作者, 期刊名, 年份
   */
  private extractAuthor(meta?: string): string | undefined {
    if (!meta) return undefined;
    const parts = meta.split(',').map(p => p.trim());
    return parts[0] || undefined;
  }

  /**
   * 从 meta 字段提取年份
   */
  private extractYear(meta?: string): number | undefined {
    if (!meta) return undefined;
    const match = meta.match(/\b(19|20)\d{2}\b/);
    return match ? parseInt(match[0]) : undefined;
  }
}

/**
 * 单例导出
 */
export const googleScholarSpider = new GoogleScholarSpider();
