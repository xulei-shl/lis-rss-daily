/**
 * 系统提示词服务
 *
 * 负责 system_prompts 表的 CRUD 操作。
 */

import { getDb, type SystemPromptsTable, type DatabaseTable } from '../db.js';
import { logger } from '../logger.js';
import { variablesToJSON, getVariableDefinitions, PROMPT_VARIABLES } from '../config/system-prompt-variables.js';

const log = logger.child({ module: 'system-prompts-service' });

export type SystemPromptRecord = SystemPromptsTable;

export interface CreateSystemPromptInput {
  type: string;
  name: string;
  template: string;
  variables?: string | Record<string, unknown> | null;
  isActive?: boolean;
}

export interface UpdateSystemPromptInput {
  type?: string;
  name?: string;
  template?: string;
  variables?: string | Record<string, unknown> | null;
  isActive?: boolean;
}

export interface QueryOptions {
  type?: string;
  isActive?: boolean;
}

const DEFAULT_SYSTEM_PROMPTS: Array<{
  type: string;
  name: string;
  template: string;
}> = [
  {
    type: 'filter',
    name: '默认文章过滤提示词',
    template: `# Role
你是一个专业的文章内容筛选与评估助手。你的核心任务是根据用户提供的【关注领域配置】（包含主题领域、主题词、权重及描述），对输入的【文章信息】（题目、摘要）进行深度分析，判断该文章是否符合用户的阅读需求，并给出"通过"或"拒绝"的决策。

# Context & Constraints
1. **语义匹配**：不要仅进行简单的关键词匹配。必须结合【描述】字段中的解释或同义词，对文章进行语义层面的理解。
2. **关键词说明**：主题词仅用于辅助理解领域范围，不作为硬性匹配规则。
3. **综合评估**：文章必须在核心概念上与用户关注的领域高度重合，而非仅仅是提及。

# Input Data Structure
用户将提供两部分信息：
1. **关注配置**：包含领域（Domain）、该领域下的主题词（Keywords）、权重（Weight）、描述（Description）。
2. **文章信息**：包含题目（Title）、摘要（Abstract）。

# Workflow
1. **分析文章**：提取题目和摘要中的核心概念、研究对象、方法和结论。
2. **映射匹配**：将提取的概念与用户的【关注配置】进行比对。利用【描述】字段扩展语义范围（例如：若描述中包含同义词，则视为命中）。
3. **加权评估**：
   - 识别命中了哪些领域和主题词。
   - 根据命中的项目权重进行综合打分。
   - *判定标准*：
     - **通过**：文章核心内容强关联高权重领域/词汇，或关联多个中等权重词汇。
     - **拒绝**：文章内容与关注领域无关，或仅边缘提及低权重词汇，或属于关注领域的反面案例。
4. **生成结果**：输出最终决策及简短理由。

# 关注领域配置
{{TOPIC_DOMAINS}}

# 待分析文章
标题：{{ARTICLE_TITLE}}
链接：{{ARTICLE_URL}}
{{#ARTICLE_CONTENT}}内容预览：{{ARTICLE_CONTENT}}{{/ARTICLE_CONTENT}}

# Response Format
请严格按照以下 JSON 格式输出结果（不要输出多余内容）：
\`\`\`json
{
  "evaluations": [
    {
      "domain_id": 1,
      "is_relevant": true,
      "relevance_score": 0.85,
      "reasoning": "简短说明相关性（1-2句）"
    }
  ]
}
\`\`\`

# Important Notes
- 每个领域独立评估
- 一篇文章可以与多个领域相关
- 只有具有实质性关联时才标记为相关
- reasoning 保持简洁（1-2句）`,
  },
  {
    type: 'summary',
    name: '默认摘要提示词',
    template: '你是文章摘要助手，请用中文生成 200-300 字摘要，信息准确，不要添加编造内容。',
  },
  {
    type: 'keywords',
    name: '默认关键词提示词',
    template:
      '你是一个文献内容标签助手。请根据文章的标题与摘要，输出 3-8 个中文关键词（短语或术语）。如果内容不是中文，请保持术语准确并尽量转为中文表述。',
  },
  {
    type: 'translation',
    name: '默认翻译提示词',
    template:
      '你是专业中英翻译助手。请将英文翻译为中文，保持术语准确，不要添加解释。请严格输出 JSON：{"title_zh":"", "summary_zh":""}。',
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function renderSystemPrompt(
  template: string,
  variables: Record<string, string>
): string {
  if (!template) return template;
  let output = template;
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined || value === null) continue;
    const pattern = new RegExp(`{{\\s*${escapeRegExp(key)}\\s*}}`, 'g');
    output = output.replace(pattern, String(value));
  }
  return output;
}

function normalizeVariables(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    JSON.parse(trimmed);
    return trimmed;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  throw new Error('variables 必须是 JSON 字符串或对象');
}

export async function getActiveSystemPromptByType(
  userId: number,
  type: string
): Promise<SystemPromptRecord | undefined> {
  const db = getDb();
  return db
    .selectFrom('system_prompts')
    .where('user_id', '=', userId)
    .where('type', '=', type)
    .where('is_active', '=', 1)
    .selectAll()
    .orderBy('updated_at', 'desc')
    .executeTakeFirst();
}

export async function resolveSystemPrompt(
  userId: number | undefined,
  type: string,
  fallback: string,
  variables: Record<string, string>
): Promise<string> {
  if (!userId) return fallback;
  const record = await getActiveSystemPromptByType(userId, type);
  if (!record || !record.template || record.template.trim().length === 0) {
    return fallback;
  }
  return renderSystemPrompt(record.template, variables);
}

export async function ensureDefaultSystemPrompts(
  userId: number
): Promise<{ created: number; skipped: number }> {
  const db = getDb();
  let created = 0;
  let skipped = 0;

  for (const prompt of DEFAULT_SYSTEM_PROMPTS) {
    const existing = await db
      .selectFrom('system_prompts')
      .where('user_id', '=', userId)
      .where('type', '=', prompt.type)
      .select(['id'])
      .executeTakeFirst();

    if (existing) {
      skipped += 1;
      continue;
    }

    await db
      .insertInto('system_prompts')
      .values({
        user_id: userId,
        type: prompt.type,
        name: prompt.name,
        template: prompt.template,
        variables: variablesToJSON(prompt.type),  // ← 使用统一的变量定义
        is_active: 1,
        updated_at: new Date().toISOString(),
      } as any)
      .executeTakeFirst();

    created += 1;
  }

  return { created, skipped };
}

export async function listSystemPrompts(
  userId: number,
  options: QueryOptions = {}
): Promise<SystemPromptRecord[]> {
  const db = getDb();
  let query = db
    .selectFrom('system_prompts')
    .where('user_id', '=', userId);

  if (options.type) {
    query = query.where('type', '=', options.type);
  }
  if (options.isActive !== undefined) {
    query = query.where('is_active', '=', options.isActive ? 1 : 0);
  }

  return query
    .selectAll()
    .orderBy('updated_at', 'desc')
    .execute();
}

export async function getSystemPromptById(
  id: number,
  userId: number
): Promise<SystemPromptRecord | undefined> {
  const db = getDb();
  return db
    .selectFrom('system_prompts')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();
}

export async function createSystemPrompt(
  userId: number,
  data: CreateSystemPromptInput
): Promise<{ id: number }> {
  const db = getDb();
  const variables = normalizeVariables(data.variables);
  const result = await db
    .insertInto('system_prompts')
    .values({
      user_id: userId,
      type: data.type.trim(),
      name: data.name.trim(),
      template: data.template,
      variables,
      is_active: data.isActive === undefined ? 1 : data.isActive ? 1 : 0,
      updated_at: new Date().toISOString(),
    } as any)
    .executeTakeFirstOrThrow();

  const insertedId = Number(result.insertId);
  log.info({ userId, promptId: insertedId, type: data.type }, 'System prompt created');
  return { id: insertedId };
}

export async function updateSystemPrompt(
  id: number,
  userId: number,
  data: UpdateSystemPromptInput
): Promise<void> {
  const db = getDb();
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (data.type !== undefined) {
    updateData.type = data.type.trim();
  }
  if (data.name !== undefined) {
    updateData.name = data.name.trim();
  }
  if (data.template !== undefined) {
    updateData.template = data.template;
  }
  if (data.variables !== undefined) {
    updateData.variables = normalizeVariables(data.variables);
  }
  if (data.isActive !== undefined) {
    updateData.is_active = data.isActive ? 1 : 0;
  }

  const result = await db
    .updateTable('system_prompts')
    .set(updateData)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
    throw new Error('System prompt not found');
  }

  log.info({ userId, promptId: id }, 'System prompt updated');
}

export async function deleteSystemPrompt(
  id: number,
  userId: number
): Promise<void> {
  const db = getDb();
  const result = await db
    .deleteFrom('system_prompts')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw new Error('System prompt not found');
  }

  log.info({ userId, promptId: id }, 'System prompt deleted');
}
