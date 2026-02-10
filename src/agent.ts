/**
 * Agent: 仅负责翻译（按需）。
 */

import { getUserLLMProvider, getLLM } from './llm.js';
import { logger } from './logger.js';
import { resolveSystemPrompt } from './api/system-prompts.js';
import { buildPromptVariables, type ArticleContext } from './api/prompt-variable-builder.js';

const log = logger.child({ module: 'agent' });

/* ── Public Types ── */

export interface TranslationResult {
  titleZh?: string;
  summaryZh?: string;
  sourceLang: 'zh' | 'en' | 'unknown';
  usedFallback: boolean;
}

/* ── Translation ── */

const MAX_TRANSLATION_CONTENT = 3000;

/**
 * Translate title/content to Chinese when English is detected.
 */
export async function translateArticleIfNeeded(
  title?: string,
  content?: string,
  userId?: number
): Promise<TranslationResult | null> {
  const titleLang = detectLanguage(title);
  const contentLang = detectLanguage(content);
  const shouldTranslateTitle = titleLang === 'en';
  const shouldTranslateContent = contentLang === 'en';

  if (!shouldTranslateTitle && !shouldTranslateContent) {
    return null;
  }

  const trimmedContent = (content || '').slice(0, MAX_TRANSLATION_CONTENT);
  const fallbackPrompt = `你是专业中英翻译助手。请将英文翻译为中文，保持术语准确，不要添加解释。请严格输出 JSON：{"title_zh":"", "summary_zh":""}。`;

  // 使用统一的变量构建器
  const articleContext: ArticleContext = {
    articleId: 0, // 翻译时不需要 articleId
    userId: userId || 0,
    title: title || '无',
    description: '',
    content: trimmedContent || '无',
  };
  const variables = await buildPromptVariables({ type: 'translation', article: articleContext });
  const systemPrompt = await resolveSystemPrompt(userId, 'translation', fallbackPrompt, variables);

  const userPrompt = `标题: ${title || '无'}
内容: ${trimmedContent || '无'}
只翻译英文部分，若原文为空则输出空字符串。`;

  const llm = userId ? await getUserLLMProvider(userId, 'translation') : getLLM();

  try {
    const text = await llm.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { jsonMode: true, label: 'translation' }
    );

    // 使用正则表达式提取翻译结果，兼容多种字段命名格式
    // 支持: title_zh / title, summary_zh / summary
    const titleZh = shouldTranslateTitle ? extractTranslationField(text, 'title') : undefined;
    const summaryZh = shouldTranslateContent ? extractTranslationField(text, 'summary') : undefined;

    if (!titleZh && !summaryZh) {
      log.warn({ responsePreview: text.substring(0, 200) }, 'Translation extraction failed, no valid fields found');
      return {
        titleZh: undefined,
        summaryZh: undefined,
        sourceLang: 'en',
        usedFallback: true,
      };
    }

    return {
      titleZh,
      summaryZh,
      sourceLang: 'en',
      usedFallback: false,
    };
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Translation LLM failed');
    return {
      titleZh: undefined,
      summaryZh: undefined,
      sourceLang: 'en',
      usedFallback: true,
    };
  }
}

/* ── Utility Functions ── */

/**
 * 使用正则表达式从 JSON 响应中提取翻译字段
 * 支持多种字段命名格式：title_zh / title, summary_zh / summary
 *
 * @param text - LLM 返回的 JSON 文本
 * @param fieldName - 字段名（不带后缀），如 'title' 或 'summary'
 * @returns 提取的字符串值，未找到则返回 undefined
 */
function extractTranslationField(text: string, fieldName: 'title' | 'summary'): string | undefined {
  // 支持的字段名变体
  const variants = [`${fieldName}_zh`, fieldName];

  for (const variant of variants) {
    // 匹配 "field_name": "value" 格式
    // 处理转义字符、嵌套引号等情况
    const regex = new RegExp(`"\\s*${escapeRegExp(variant)}\\s*"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i');
    const match = text.match(regex);
    if (match && match[1]) {
      // 解析 JSON 转义字符
      const decoded = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return safeString(decoded);
    }
  }

  return undefined;
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectLanguage(text?: string): 'zh' | 'en' | 'unknown' {
  if (!text || text.trim().length === 0) return 'unknown';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const total = text.replace(/\s+/g, '').length;
  if (letters >= 10 && letters / Math.max(total, 1) > 0.6) return 'en';
  return 'unknown';
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
