/**
 * Agent: 生成关键词与翻译（不生成摘要）。
 */

import { getUserLLMProvider, getLLM } from './llm.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'agent' });

/* ── Public Types ── */

export interface KeywordInput {
  url: string;
  title?: string;
  summary?: string;
  markdown?: string;
}

export interface KeywordResult {
  keywords: string[];
  usedFallback: boolean;
}

export interface TranslationResult {
  titleZh?: string;
  summaryZh?: string;
  sourceLang: 'zh' | 'en' | 'unknown';
  usedFallback: boolean;
}

export interface AnalysisResult {
  keywords: string[];
  usedFallback: boolean;
  translation?: TranslationResult | null;
}

/* ── Main Analysis Functions ── */

export async function analyzeArticle(
  input: KeywordInput,
  userId?: number,
  fallbackKeywords: string[] = []
): Promise<AnalysisResult> {
  const keywordResult = await generateKeywords(input, userId, fallbackKeywords);
  const translation = await translateIfNeeded(input.title, input.summary, userId);

  return {
    keywords: keywordResult.keywords,
    usedFallback: keywordResult.usedFallback,
    translation,
  };
}

/**
 * Generate keywords from title/summary (LLM). Fallback to rule-based extraction.
 */
export async function generateKeywords(
  input: KeywordInput,
  userId?: number,
  fallbackKeywords: string[] = []
): Promise<KeywordResult> {
  const systemPrompt = `你是一个文献内容标签助手。请根据文章的标题与摘要，输出 3-8 个中文关键词（短语或术语）。如果内容不是中文，请保持术语准确并尽量转为中文表述。`;

  const userPrompt = `标题: ${input.title || '无'}
摘要: ${input.summary || '无'}
链接: ${input.url}
${input.markdown ? `正文节选: ${input.markdown.slice(0, 1200)}` : ''}`;

  const llm = userId ? await getUserLLMProvider(userId) : getLLM();

  try {
    const text = await llm.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens: 512, jsonMode: true, label: 'keywords' }
    );

    const parsed = JSON.parse(text);
    const keywords = Array.isArray(parsed.keywords)
      ? normalizeKeywords(parsed.keywords).slice(0, 8)
      : [];

    if (keywords.length > 0) {
      return { keywords, usedFallback: false };
    }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Keywords LLM failed');
  }

  const fallback = buildFallbackKeywords(input, fallbackKeywords);
  return { keywords: fallback, usedFallback: true };
}

/**
 * Translate title/summary to Chinese when English is detected.
 */
export async function translateIfNeeded(
  title?: string,
  summary?: string,
  userId?: number
): Promise<TranslationResult | null> {
  const titleLang = detectLanguage(title);
  const summaryLang = detectLanguage(summary);
  const shouldTranslateTitle = titleLang === 'en';
  const shouldTranslateSummary = summaryLang === 'en';

  if (!shouldTranslateTitle && !shouldTranslateSummary) {
    return null;
  }

  const systemPrompt = `你是专业中英翻译助手。请将英文翻译为中文，保持术语准确，不要添加解释。请严格输出 JSON：{"title_zh":"", "summary_zh":""}。`;

  const userPrompt = `标题: ${title || '无'}
摘要: ${summary || '无'}
只翻译英文部分，若原文为空则输出空字符串。`;

  const llm = userId ? await getUserLLMProvider(userId) : getLLM();

  try {
    const text = await llm.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { maxTokens: 1024, jsonMode: true, label: 'translation' }
    );

    const parsed = JSON.parse(text);
    const titleZh = shouldTranslateTitle ? safeString(parsed.title_zh) : undefined;
    const summaryZh = shouldTranslateSummary ? safeString(parsed.summary_zh) : undefined;

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

function buildFallbackKeywords(
  input: KeywordInput,
  matchedKeywords: string[]
): string[] {
  const extracted = extractKeywordsFromText([input.title, input.summary].filter(Boolean).join(' '));
  return normalizeKeywords([...matchedKeywords, ...extracted]).slice(0, 8);
}

function extractKeywordsFromText(text: string): string[] {
  if (!text) return [];
  const zh = text.match(/[\u4e00-\u9fff]{2,8}/g) || [];
  const en = text.match(/[A-Za-z][A-Za-z\-]{2,}/g) || [];
  return [...zh, ...en].slice(0, 12);
}

function normalizeKeywords(keywords: string[]): string[] {
  const unique = new Set<string>();
  for (const kw of keywords) {
    if (typeof kw !== 'string') continue;
    const cleaned = kw.trim();
    if (cleaned.length === 0) continue;
    unique.add(cleaned);
  }
  return Array.from(unique);
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
