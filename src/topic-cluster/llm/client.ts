/**
 * LLM 调用客户端——本模块访问 LLM 的**唯一入口**。
 *
 * 复用现有能力（设计文档 §8.1）：
 *   - provider：`getUserLLMProvider(userId, taskType)`（支持在 /settings 为三个任务分别配模型）
 *   - 提示词：`resolveSystemPrompt(userId, type, fallback, vars)` + `system_prompts` 表
 *   - JSON 解析：`parseLLMJSON`（已有的容错解析器）
 *
 * 本文件只负责「取 prompt → 调用 → 解析 → 交给调用方的 validator」，
 * 不含任何业务字段知识（那些在各业务文件里）。
 */

import { getUserLLMProvider, type ChatMessage } from '../../llm.js';
import { readDefaultPromptTemplate, resolveSystemPrompt } from '../../api/system-prompts.js';
import { parseLLMJSON } from '../../utils/llm-json-parser.js';
import { ClusterSchemaError } from './schema.js';

export interface ClusterJsonTaskInput<T> {
  userId: number;
  /** LLM 配置的 task_type（cluster_facet / cluster_analysis / cluster_naming） */
  taskType: string;
  /** 系统提示词类型（system_prompts.type），与 taskType 同名 */
  promptType: string;
  variables: Record<string, string>;
  /** 日志标签 */
  label: string;
  maxTokens: number;
  temperature: number;
  /** 业务字段校验；不通过应抛 ClusterSchemaError */
  validate: (raw: Record<string, unknown>) => T;
}

/**
 * 执行一次「要求返回 JSON」的 LLM 任务。
 *
 * 失败一律抛出（ClusterSchemaError 或原始错误），**从不返回兜底数据**——
 * 由调用方决定落 `status='failed'` 还是计入下一轮重试。
 */
export async function runClusterJsonTask<T>(input: ClusterJsonTaskInput<T>): Promise<T> {
  // 提示词：优先数据库配置；未配置时退回内置 md 模板（保证开箱可用）
  const fallback = readDefaultPromptTemplate(input.promptType) ?? '';
  const prompt = await resolveSystemPrompt(input.userId, input.promptType, fallback, input.variables);

  if (!prompt || prompt.trim().length === 0) {
    throw new ClusterSchemaError(`未配置 ${input.promptType} 类型的系统提示词`);
  }

  assertPayloadInjected(prompt, input.variables, input.promptType);

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const llm = await getUserLLMProvider(input.userId, input.taskType);
  const response = await llm.chat(messages, {
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    jsonMode: true,
    label: input.label,
  });

  const parsed = parseLLMJSON<Record<string, unknown>>(response, {
    maxResponseLength: input.maxTokens * 4,
    errorPrefix: `${input.label} 响应解析失败`,
  });

  if (!parsed.success || !parsed.data || typeof parsed.data !== 'object') {
    throw new ClusterSchemaError(
      `${input.label} 响应不是合法 JSON：${parsed.error ?? '未知原因'}`
    );
  }

  return input.validate(parsed.data);
}

/**
 * 守卫：输入数据必须真的出现在最终 prompt 里。
 *
 * 为什么需要：本项目靠模板里的 `{{VAR}}` 占位符注入数据（`resolveSystemPrompt`）。
 * 若模板漏写占位符（自写模板、或在设置页编辑时误删），变量会被静默丢弃——
 * 模型拿到的只是一段指令而没有文献内容，**照样返回一个格式合法但内容空洞的 JSON**，
 * 于是错误一路潜伏到切面/分析里，直到人工抽检才发现，期间白花 token。
 *
 * 校验方式是精确的：变量值原样拼接进模板，所以「值不在 prompt 里」
 * 就等价于「模型看不到这份数据」，没有误判空间。
 */
function assertPayloadInjected(
  prompt: string,
  variables: Record<string, string>,
  promptType: string
): void {
  const missing = Object.entries(variables)
    .filter(([, value]) => value && value.trim().length >= 2)
    .filter(([, value]) => !prompt.includes(value))
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new ClusterSchemaError(
      `${promptType} 提示词未消费输入变量：${missing.join('、')}。` +
        `请在模板中加入对应占位符，例如 {{${missing[0]}}}；` +
        `否则模型看不到任何文献内容，只会产出看似合法但无依据的结果。`
    );
  }
}
