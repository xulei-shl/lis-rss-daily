/**
 * 处理 rejected_articles 中的邮件文章（id: 9044-9047）
 *
 * 这些来自 Google Scholar 邮件提醒的原始内容需要：
 * 1. 提取 content（邮件原始内容）
 * 2. LLM 解析为结构化文章
 * 3. 插入 articles 表
 * 4. 执行过滤 + 后续流水线
 *
 * 运行方式：
 *   cd /opt/lis-rss-daily
 *   npx tsx scripts/process-rejected-emails.ts
 */

import 'dotenv/config';
import { getDb } from '../src/db.js';
import { getUserLLMProvider, type ChatMessage } from '../src/llm.js';
import { filterArticle, type FilterInput } from '../src/filter.js';
import { processArticle } from '../src/pipeline.js';
import { parseLLMJSON } from '../src/utils/llm-json-parser.js';
import { generateNormalizedTitle } from '../src/utils/title.js';
import { buildPromptVariables } from '../src/api/prompt-variable-builder.js';
import { resolveSystemPrompt } from '../src/api/system-prompts.js';
import { logger } from '../src/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = logger.child({ module: 'process-rejected-emails' });

const DEFAULT_EMAIL_PARSE_PROMPT_PATH = path.join(__dirname, '../src/config/default-prompts/email_parse.md');

function readDefaultEmailParsePrompt(): string {
  try {
    return fs.readFileSync(DEFAULT_EMAIL_PARSE_PROMPT_PATH, 'utf-8');
  } catch {
    return '';
  }
}

interface ParsedArticle {
  title: string;
  summary?: string;
  content?: string;
  url?: string;
  author?: string;
}

interface EmailParseResult {
  articles: ParsedArticle[];
}

const REJECTED_IDS = [9044, 9045, 9046, 9047];
const EMAIL_SOURCE_ID = 1;  // XuLei
const USER_ID = 1;

async function main() {
  const db = getDb();

  // 1. 读取 rejected_articles 记录
  const rejectedRows = await db
    .selectFrom('rejected_articles')
    .where('id', 'in', REJECTED_IDS)
    .select(['id', 'title', 'content', 'url', 'published_at', 'source_name'])
    .execute();

  log.info({ count: rejectedRows.length }, 'Found rejected articles');

  if (rejectedRows.length === 0) {
    log.error('No rejected articles found with the specified IDs');
    return;
  }

  let totalParsedArticles = 0;
  let totalInserted = 0;

  for (const row of rejectedRows) {
    log.info({ rejectedId: row.id, title: row.title?.substring(0, 80) }, 'Processing rejected article');

    const content = row.content || '';
    if (!content) {
      log.warn({ rejectedId: row.id }, 'Empty content, skipping');
      continue;
    }

    try {
      // 2. 构建 LLM prompt 解析邮件内容
      const subject = row.title || '';
      const emailFrom = row.source_name || 'unknown';

      const variables = await buildPromptVariables({
        type: 'email_parse',
        userId: USER_ID,
        email: {
          subject,
          content: content.substring(0, 30000),
          from: emailFrom,
        },
      });

      let userPrompt = await resolveSystemPrompt(USER_ID, 'email_parse', readDefaultEmailParsePrompt(), variables);

      if (!userPrompt || userPrompt.trim().length === 0) {
        log.warn({ rejectedId: row.id }, 'No email_parse prompt available, treating as single article');
        // 直接作为一篇文章插入
    const articleId = await insertSingleArticle(db, subject, content, row.url || `rejected-${row.id}`);
    if (articleId) {
      totalInserted++;
      await runFilterAndPipeline(articleId, subject);
    }
        continue;
      }

      // 确保邮件内容在 prompt 中
      const emailContentForLlm = content.substring(0, 30000);
      if (!userPrompt.includes(emailContentForLlm.substring(0, 100))) {
        userPrompt += `\n\n### 邮件内容\n\n${emailContentForLlm}`;
      }

      const messages: ChatMessage[] = [
        { role: 'user', content: userPrompt },
      ];

      // 3. 调用 LLM 解析
      const llm = await getUserLLMProvider(USER_ID, 'email_parse');
      log.info({ rejectedId: row.id, contentLength: content.length }, 'Calling LLM to parse email content');
      const response = await llm.chat(messages, {
        jsonMode: true,
        temperature: 0.1,
        label: 'email-parse-rejected',
      });

      // 4. 解析 LLM 响应
      const parseResult = parseLLMJSON<EmailParseResult>(response, {
        allowPartial: true,
        maxResponseLength: 8192,
        errorPrefix: 'Email parse (rejected)',
      });

      let parsedArticles: ParsedArticle[] = [];

      if (!parseResult.success || !parseResult.data) {
        log.warn({ rejectedId: row.id, error: parseResult.error }, 'Failed to parse LLM response, treating as single article');
        parsedArticles = [{
          title: subject,
          content: content,
          url: row.url || `rejected-${row.id}`,
        }];
      } else {
        const parsed = parseResult.data;
        if (!parsed.articles || !Array.isArray(parsed.articles)) {
          log.warn({ rejectedId: row.id }, 'Invalid email parse response format');
          parsedArticles = [{
            title: subject,
            content: content,
            url: row.url || `rejected-${row.id}`,
          }];
        } else {
          parsedArticles = parsed.articles.filter((a) => a.title && a.title.trim());
        }
      }

      log.info({ rejectedId: row.id, articleCount: parsedArticles.length }, 'Parsed articles from email');

      // 5. 插入文章并触发过滤+流水线
      for (const article of parsedArticles) {
        const articleId = await insertParsedArticle(db, article, row.published_at);
        if (articleId) {
          totalInserted++;
          await runFilterAndPipeline(articleId, article.title);
        }
      }

      totalParsedArticles += parsedArticles.length;
    } catch (err: any) {
      log.error({ rejectedId: row.id, error: err.message }, 'Failed to process rejected article');
      // 尝试直接作为单篇文章插入
      try {
        const articleId = await insertSingleArticle(db, row.title || 'Unknown', content, row.url || `rejected-${row.id}`);
        if (articleId) {
          totalInserted++;
          await runFilterAndPipeline(articleId, row.title || 'Unknown');
        }
      } catch (fallbackErr: any) {
        log.error({ rejectedId: row.id, error: fallbackErr.message }, 'Fallback insert also failed');
      }
    }
  }

  log.info({
    totalRejected: rejectedRows.length,
    totalParsedArticles,
    totalInserted,
  }, 'Processing complete');
}

async function insertParsedArticle(
  db: ReturnType<typeof getDb>,
  article: ParsedArticle,
  publishedAt: string | null
): Promise<number | null> {
  try {
    const titleNormalized = generateNormalizedTitle(article.title);
    const title = article.title;

    // 检查是否已存在
    if (titleNormalized) {
      const existing = await db
        .selectFrom('articles')
        .where('title_normalized', '=', titleNormalized)
        .select('id')
        .executeTakeFirst();

      if (existing) {
        log.info({ title: title.substring(0, 60), existingId: existing.id }, 'Article already exists, skipping');
        return null;
      }
    }

    const content = article.content || '';
    const url = article.url || `rejected-email-${Date.now()}`;

    const result = await db
      .insertInto('articles')
      .values({
        email_source_id: EMAIL_SOURCE_ID,
        title,
        title_normalized: titleNormalized,
        url,
        content,
        summary: article.summary || null,
        source_origin: 'email',
        filter_status: 'pending',
        process_status: 'pending',
        published_at: publishedAt || new Date().toISOString(),
        is_read: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .executeTakeFirstOrThrow();

    const insertedId = Number(result.insertId);
    log.info({ articleId: insertedId, title: title.substring(0, 60) }, 'Article inserted from rejected email');
    return insertedId;
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE')) {
      log.warn({ title: article.title?.substring(0, 60) }, 'Duplicate article, skipping');
      return null;
    }
    log.error({ title: article.title?.substring(0, 60), error: err.message }, 'Failed to insert article');
    return null;
  }
}

async function insertSingleArticle(
  db: ReturnType<typeof getDb>,
  title: string,
  content: string,
  url: string
): Promise<number | null> {
  const titleNormalized = generateNormalizedTitle(title);
  if (titleNormalized) {
    const existing = await db
      .selectFrom('articles')
      .where('title_normalized', '=', titleNormalized)
      .select('id')
      .executeTakeFirst();

    if (existing) {
      log.info({ title: title.substring(0, 60), existingId: existing.id }, 'Article already exists, skipping');
      return null;
    }
  }

  const result = await db
    .insertInto('articles')
    .values({
      email_source_id: EMAIL_SOURCE_ID,
      title,
      title_normalized: titleNormalized,
      url,
      content,
      source_origin: 'email',
      filter_status: 'pending',
      process_status: 'pending',
      published_at: new Date().toISOString(),
      is_read: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any)
    .executeTakeFirstOrThrow();

  return Number(result.insertId);
}

async function runFilterAndPipeline(articleId: number, title: string): Promise<void> {
  try {
    const filterInput: FilterInput = {
      articleId,
      userId: USER_ID,
      title,
      url: undefined,
      description: '',
      sourceType: 'email',
      sourceDomainId: undefined, // Will be resolved from email_source
    };

    const filterResult = await filterArticle(filterInput);
    log.info({ articleId, passed: filterResult.passed }, 'Filter result');

    if (filterResult.passed) {
      await processArticle(articleId, USER_ID);
      log.info({ articleId }, 'Pipeline completed');
    }
  } catch (err: any) {
    log.warn({ articleId, error: err.message }, 'Filter/pipeline failed');
  }
}

main()
  .then(() => {
    log.info('Script finished');
    process.exit(0);
  })
  .catch((err) => {
    log.error({ err }, 'Script failed');
    process.exit(1);
  });
