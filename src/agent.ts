/**
 * Agent: 仅负责翻译（按需）。
 */

import { getUserLLMProvider, getLLM } from './llm.js';
import { logger } from './logger.js';
import { resolveSystemPrompt } from './api/system-prompts.js';
import { buildPromptVariables, type ArticleContext } from './api/prompt-variable-builder.js';
import { stripUrls } from './utils/text-cleaner.js';

const log = logger.child({ module: 'agent' });

/* ── Public Types ── */

export interface TranslationResult {
  /** 标题单独译文（若 LLM 返回可分离的标题翻译） */
  titleZh?: string;
  /** 标题+正文整体译文 */
  summaryZh?: string;
  sourceLang: 'zh' | 'en' | 'unknown';
  usedFallback: boolean;
}

/* ── Translation ── */

/**
 * Translate title/content to Chinese when English is detected.
 * Sends the full content (with URL noise removed) to LLM for complete translation.
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

  // Strip URLs to reduce noise, but keep ALL content for full translation
  const cleanedContent = stripUrls(content || '');
  const fallbackPrompt = `你是专业中英翻译助手。请将英文翻译为中文，保持术语准确，不要添加解释。请输出纯文本译文，不要输出 JSON。

### 待翻译内容

标题：{{ARTICLE_TITLE}}
摘要：{{ARTICLE_CONTENT}}

只翻译英文部分，若原文为空则输出空字符串。`;

  // 使用统一的变量构建器
  const articleContext: ArticleContext = {
    articleId: 0, // 翻译时不需要 articleId
    userId: userId || 0,
    title: title || '无',
    description: '',
    content: cleanedContent || '无',
  };
  const variables = await buildPromptVariables({ type: 'translation', article: articleContext });
  const userPrompt = await resolveSystemPrompt(userId, 'translation', fallbackPrompt, variables);

  const llm = userId ? await getUserLLMProvider(userId, 'translation') : getLLM();

  try {
    const text = await llm.chat(
      [
        { role: 'user', content: userPrompt },
      ],
      { label: 'translation' }
    );

    return {
      titleZh: shouldTranslateTitle ? safeString(text) : undefined,
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

/* ── Constants ── */

/** 英文语言检测：最少字母数阈值 */
const MIN_ALPHA_COUNT = 10;
/** 英文语言检测：字母占比阈值 */
const MIN_ALPHA_RATIO = 0.6;

/* ── Utility Functions ── */

function detectLanguage(text?: string): 'zh' | 'en' | 'unknown' {
  if (!text || text.trim().length === 0) return 'unknown';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const total = text.replace(/\s+/g, '').length;
  if (letters >= MIN_ALPHA_COUNT && letters / Math.max(total, 1) > MIN_ALPHA_RATIO) return 'en';
  return 'unknown';
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
