/**
 * JEV (TypeSafe) 评分服务
 *
 * 调用 TypeSafe API 对文章进行相关性评分。
 * 使用 noul + score + choice 三种问题类型进行综合评分。
 * API 文档：https://docs.typesafe.ai
 */

import { config } from './config.js';
import { logger } from './logger.js';
import { getDb } from './db.js';
import { decryptAPIKey } from './utils/crypto.js';

const log = logger.child({ module: 'jev' });

const JEV_DEFAULT_API_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_DEFAULT_MODEL = 'jev-latest';

export interface ResolvedJevConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 解析当前可用的 JEV 配置
 * 优先级：llm_configs 数据库配置（已启用） > .env 环境变量 TYPESAFE_API_KEY
 */
export async function resolveJevConfig(): Promise<ResolvedJevConfig> {
  const db = getDb();

  // 优先从 llm_configs 查找启用的 JEV 配置 (config_type='jev' 或 provider='typesafe')
  const dbConfig = await db
    .selectFrom('llm_configs')
    .where((eb) =>
      eb.or([
        eb('config_type', '=', 'jev'),
        eb('provider', '=', 'typesafe'),
      ])
    )
    .where('enabled', '=', 1)
    .selectAll()
    .orderBy('is_default', 'desc')
    .orderBy('priority', 'asc')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();

  if (dbConfig && dbConfig.api_key_encrypted) {
    const apiKey = decryptAPIKey(dbConfig.api_key_encrypted, config.llmEncryptionKey);
    if (apiKey) {
      let url = dbConfig.base_url.trim();
      if (!url.endsWith('/systemone')) {
        url = `${url.replace(/\/+$/, '')}/v1/systemone`;
      }
      return {
        apiUrl: url,
        apiKey,
        model: dbConfig.model || JEV_DEFAULT_MODEL,
      };
    }
  }

  // 兜底回退到 .env 配置
  if (config.typesafeApiKey) {
    return {
      apiUrl: JEV_DEFAULT_API_URL,
      apiKey: config.typesafeApiKey,
      model: JEV_DEFAULT_MODEL,
    };
  }

  throw new Error('未配置 JEV API 密钥。请在「设置 -> LLM 配置」中添加 JEV 配置，或在环境变量中配置 TYPESAFE_API_KEY。');
}

/** 主题领域信息 */
export interface TopicInfo {
  name: string;
  description: string | null;
  keywords: string[];
}

/** 文章评分输入 */
export interface ArticleForScoring {
  id: number;
  title: string;
  summary: string | null;
}

/** JEV 评分结果 */
export interface JevScoreResult {
  articleId: number;
  relevanceScore: number;       // 综合评分 0-1
  matchedDomain: string | null; // 匹配的领域名称
  jevResponse: any;             // 原始响应
  failed?: boolean;             // JEV 调用失败时为 true（此时 relevanceScore 是占位 0，不代表真实相关性）
}

/**
 * 构建 JEV 请求体
 */
function buildJevRequest(
  article: ArticleForScoring,
  topics: TopicInfo[],
  model: string = JEV_DEFAULT_MODEL
) {
  // 构建 state：文章标题 + 摘要
  const articleText = article.summary
    ? `标题：${article.title}\n摘要：${article.summary}`
    : `标题：${article.title}`;

  // 构建主题描述供 JEV 参考
  const topicsDescription = topics.map(t => {
    const kw = t.keywords.length > 0 ? `（关键词：${t.keywords.join('、')}）` : '';
    return `${t.name}${kw}${t.description ? '：' + t.description : ''}`;
  }).join('\n');

  const state = {
    article: articleText,
    user_topics: topicsDescription,
  };

  const questions: Record<string, any> = {
    // noul：二值判断，是否相关
    is_relevant: {
      type: 'noul',
      instructions: '根据 `user_topics` 中描述的主题领域和关键词，判断 `article` 中的文章是否与用户关注的主题相关。',
      criteria: {
        true: '文章内容直接涉及或紧密关联用户关注的主题领域或关键词',
        false: '文章内容与用户关注的主题领域无关，仅表面词汇相似但实质不同',
      },
    },
    // score：细粒度相关程度
    relevance_level: {
      type: 'score',
      instructions: '根据 `user_topics`，评估 `article` 与用户关注主题的相关程度。',
      criteria: [
        '完全不相关，与用户主题无任何关联',
        '边缘相关，仅涉及相邻领域或间接关联',
        '中度相关，涉及用户主题的部分方面',
        '高度相关，直接讨论用户关注的核心主题',
        '完全匹配，深入讨论用户核心主题且包含关键词',
      ],
    },
  };

  // 如果有多个领域，用 choice 判断最匹配哪个
  if (topics.length > 1) {
    const domainCriteria: Record<string, string | null> = {};
    for (const t of topics) {
      domainCriteria[t.name] = t.description || null;
    }
    questions.best_domain = {
      type: 'choice',
      instructions: '`article` 最匹配 `user_topics` 中的哪个主题领域？',
      criteria: domainCriteria,
    };
  }

  return {
    state,
    model,
    questions,
  };
}

/** 重试退避的基准延迟 / 单次退避上限 */
const JEV_RETRY_BASE_DELAY_MS = 1000;
const JEV_RETRY_MAX_DELAY_MS = 30000;

/** 除 5xx 外额外可重试的状态码：429 限流 / 529 过载 / 408 超时 */
const JEV_RETRYABLE_STATUSES = new Set([408, 429, 529]);

function isRetryableStatus(status: number): boolean {
  return status >= 500 || JEV_RETRYABLE_STATUSES.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 解析 Retry-After 响应头（秒数或 HTTP 日期），返回毫秒 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());

  return undefined;
}

/** 指数退避 + 抖动；上游给了 Retry-After 就听它的（仍受单次上限约束） */
function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, JEV_RETRY_MAX_DELAY_MS);

  const backoff = Math.min(JEV_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), JEV_RETRY_MAX_DELAY_MS);
  const jitter = Math.random() * backoff * 0.25;
  return Math.round(backoff + jitter);
}

/**
 * 调用 JEV API
 *
 * 带超时与重试：TypeSafe 在 429 限流 / 529 过载 / 5xx 时要求指数退避后重试
 * （见官方 API reference「Handling rate limits」），否则并发一高就会把限流
 * 记成 0 分。超时通过 AbortController 实现，与 vector/embedding-client 一致。
 */
async function callJevApi(requestBody: any, jevConfig: ResolvedJevConfig): Promise<any> {
  const maxAttempts = Math.max(1, (config.jevMaxRetries || 0) + 1);
  let lastError: Error = new Error('JEV 请求失败');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.jevRequestTimeoutMs);

    let retryable = true;
    let retryAfterMs: number | undefined;

    try {
      const response = await fetch(jevConfig.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jevConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (response.ok) {
        return await response.json();
      }

      const errorText = await response.text().catch(() => '');
      lastError = new Error(`JEV API 错误 (${response.status}): ${errorText}`);
      retryable = isRetryableStatus(response.status);
      retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    } catch (error) {
      // 网络异常 / 超时 / 响应体解析失败都可以重试
      lastError = error instanceof Error ? error : new Error(String(error));
      const isTimeout = lastError.name === 'AbortError';
      lastError = new Error(
        isTimeout ? `JEV 请求超时（${config.jevRequestTimeoutMs}ms）` : lastError.message
      );
    } finally {
      clearTimeout(timer);
    }

    if (!retryable || attempt === maxAttempts) {
      throw lastError;
    }

    const delay = retryDelayMs(attempt, retryAfterMs);
    log.warn(
      { attempt, maxAttempts, delay, error: lastError.message },
      'JEV 请求失败，退避后重试'
    );
    await sleep(delay);
  }

  throw lastError;
}

/**
 * 计算综合评分
 *
 * 算法：noul 概率 × score 归一化值
 * - noul 提供粗粒度的相关/不相关判断
 * - score 提供细粒度的相关程度
 * - 两者相乘后，不相关的文章分数会被压到很低
 */
function calculateScore(answers: any): { score: number; matchedDomain: string | null } {
  const noulProb = answers.is_relevant?.noul ?? 0;
  const scoreValue = answers.relevance_level?.score ?? 0;
  const maxLevel = 4; // score criteria 有 5 个等级 (0-4)
  const normalizedScore = scoreValue / maxLevel;

  // 综合评分：noul 概率 × 归一化 score
  const relevanceScore = Math.round(noulProb * normalizedScore * 100) / 100;

  // 匹配的领域
  const matchedDomain = answers.best_domain?.choice ?? null;

  return { score: relevanceScore, matchedDomain };
}

/**
 * 对单篇文章进行 JEV 评分
 */
export async function scoreArticle(
  article: ArticleForScoring,
  topics: TopicInfo[],
  jevConfig?: ResolvedJevConfig
): Promise<JevScoreResult> {
  try {
    const activeConfig = jevConfig || (await resolveJevConfig());
    const requestBody = buildJevRequest(article, topics, activeConfig.model);
    const result = await callJevApi(requestBody, activeConfig);
    const { score, matchedDomain } = calculateScore(result.answers);

    return {
      articleId: article.id,
      relevanceScore: score,
      matchedDomain,
      jevResponse: result,
      failed: false,
    };
  } catch (error) {
    log.error({ articleId: article.id, error }, 'JEV 评分失败');
    return {
      articleId: article.id,
      relevanceScore: 0,
      matchedDomain: null,
      jevResponse: { error: error instanceof Error ? error.message : 'unknown' },
      failed: true,
    };
  }
}

export type OnArticleScoredCallback = (
  result: JevScoreResult,
  index: number,
  total: number
) => Promise<void> | void;

/**
 * 批量并行评分（按并发数分批处理）
 */
export async function scoreArticlesBatch(
  articles: ArticleForScoring[],
  topics: TopicInfo[],
  concurrency = 5,
  onArticleScored?: OnArticleScoredCallback
): Promise<JevScoreResult[]> {
  if (topics.length === 0) {
    log.warn('用户没有设置主题领域，跳过评分');
    return [];
  }

  // 解析一次 JEV 配置供本批次共用
  const jevConfig = await resolveJevConfig();

  log.info(
    { count: articles.length, concurrency, model: jevConfig.model, url: jevConfig.apiUrl },
    '开始批量 JEV 评分'
  );

  // 按并发数分批处理
  const results: JevScoreResult[] = [];
  let completedCount = 0;

  for (let i = 0; i < articles.length; i += concurrency) {
    const batch = articles.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (article) => {
        const res = await scoreArticle(article, topics, jevConfig);
        completedCount++;
        if (onArticleScored) {
          try {
            await onArticleScored(res, completedCount, articles.length);
          } catch (callbackErr) {
            log.error({ articleId: article.id, error: callbackErr }, '评分进度回调执行出错');
          }
        }
        return res;
      })
    );
    results.push(...batchResults);
  }

  const failedCount = results.filter(r => r.failed).length;
  log.info(
    {
      total: results.length,
      scored: results.length - failedCount,
      failed: failedCount,
    },
    'JEV 评分完成'
  );

  return results;
}

