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
  summaryZh?: string; // 标题+正文整体译文
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
  const fallbackPrompt = `你是专业中英翻译助手。请将英文翻译为中文，保持术语准确，不要添加解释。请输出纯文本译文，不要输出 JSON。`;

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

  const userPrompt = `请将以下内容翻译为中文，保持术语准确，不要添加解释，只输出译文纯文本。
标题：${title || '无'}
正文：${trimmedContent || '无'}
只翻译英文部分，若原文为空则输出空字符串。`;

  const llm = userId ? await getUserLLMProvider(userId, 'translation') : getLLM();

  try {
    const text = await llm.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { label: 'translation' }
    );

    return {
      summaryZh: shouldTranslateTitle || shouldTranslateContent ? safeString(text) : undefined,
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
