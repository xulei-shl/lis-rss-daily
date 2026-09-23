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

/**
 * 调用 JEV API
 */
async function callJevApi(requestBody: any, jevConfig: ResolvedJevConfig): Promise<any> {
  const response = await fetch(jevConfig.apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jevConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`JEV API 错误 (${response.status}): ${errorText}`);
  }

  return response.json();
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
    };
  } catch (error) {
    log.error({ articleId: article.id, error }, 'JEV 评分失败');
    return {
      articleId: article.id,
      relevanceScore: 0,
      matchedDomain: null,
      jevResponse: { error: error instanceof Error ? error.message : 'unknown' },
    };
  }
}

/**
 * 批量并行评分（按并发数分批处理）
 */
export async function scoreArticlesBatch(
  articles: ArticleForScoring[],
  topics: TopicInfo[],
  concurrency = 5
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
  for (let i = 0; i < articles.length; i += concurrency) {
    const batch = articles.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(article => scoreArticle(article, topics, jevConfig))
    );
    results.push(...batchResults);
  }

  log.info(
    { total: results.length, scored: results.filter(r => r.relevanceScore > 0).length },
    'JEV 评分完成'
  );

  return results;
}
