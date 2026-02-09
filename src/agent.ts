/**
 * Agent: 仅负责翻译（按需）。
 */

import { getUserLLMProvider, getLLM } from './llm.js';
import { logger } from './logger.js';
import { resolveSystemPrompt } from './api/system-prompts.js';
import { parseLLMJSON } from './utils/llm-json-parser.js';
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

  const llm = userId ? await getUserLLMProvider(userId) : getLLM();

  try {
    const text = await llm.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { jsonMode: true, label: 'translation' }
    );

    // 使用新的JSON解析工具
    const parseResult = parseLLMJSON<{ title_zh?: string; summary_zh?: string }>(text, {
      allowPartial: true,
      maxResponseLength: 1024,
      errorPrefix: 'Translation',
    });

    if (!parseResult.success) {
      log.warn({ error: parseResult.error }, 'Translation JSON parse failed');
      return {
        titleZh: undefined,
        summaryZh: undefined,
        sourceLang: 'en',
        usedFallback: true,
      };
    }

    const parsed = parseResult.data!;
    const titleZh = shouldTranslateTitle ? safeString(parsed.title_zh) : undefined;
    const summaryZh = shouldTranslateContent ? safeString(parsed.summary_zh) : undefined;

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
