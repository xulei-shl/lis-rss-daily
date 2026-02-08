/**
 * LLM JSON Response Parser
 *
 * 提供统一的工具函数来解析大模型返回的JSON响应。
 * 处理常见的LLM响应格式问题：
 * - Markdown代码块包裹（```json ... ```）
 * - 响应被截断
 * - JSON格式错误
 * - 提供详细的错误信息和日志
 */

import { logger } from '../logger.js';

const log = logger.child({ module: 'llm-json-parser' });

/* ── Public Types ── */

/**
 * JSON解析结果
 */
export interface ParseResult<T = any> {
  /** 解析是否成功 */
  success: boolean;
  /** 解析后的数据（成功时） */
  data?: T;
  /** 错误信息（失败时） */
  error?: string;
  /** 原始响应文本 */
  rawResponse: string;
  /** 清理后的JSON文本 */
  cleanedJson?: string;
  /** 是否使用了部分解析 */
  usedPartialParse?: boolean;
}

/**
 * 解析选项
 */
export interface ParseOptions {
  /** 是否允许部分解析（当JSON不完整时） */
  allowPartial?: boolean;
  /** 最大响应长度（用于检测截断） */
  maxResponseLength?: number;
  /** 自定义错误消息前缀 */
  errorPrefix?: string;
}

/* ── Public Functions ── */

/**
 * 解析大模型返回的JSON响应
 *
 * @param response - 大模型返回的原始响应文本
 * @param options - 解析选项
 * @returns 解析结果
 *
 * @example
 * ```ts
 * const result = parseLLMJSON<MyType>(response, {
 *   allowPartial: true,
 *   errorPrefix: 'Filter evaluation'
 * });
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function parseLLMJSON<T = any>(
  response: string,
  options: ParseOptions = {}
): ParseResult<T> {
  const {
    allowPartial = false,
    maxResponseLength = 2048,
    errorPrefix = 'JSON解析',
  } = options;

  const trimmedResponse = response.trim();

  // 检查响应是否为空
  if (!trimmedResponse) {
    const error = `${errorPrefix}失败：响应为空`;
    log.warn({ error, responseLength: response.length }, 'Empty LLM response');
    return {
      success: false,
      error,
      rawResponse: response,
    };
  }

  // 检查响应是否被截断
  const isTruncated = response.length >= maxResponseLength;
  if (isTruncated) {
    log.warn(
      {
        responseLength: response.length,
        maxLength: maxResponseLength,
        preview: response.substring(0, 200),
      },
      'LLM response may be truncated'
    );
  }

  // 提取JSON内容（处理markdown代码块）
  const cleanedJson = extractJSON(trimmedResponse);

  try {
    // 尝试完整解析
    const parsed = JSON.parse(cleanedJson);
    log.debug(
      {
        jsonLength: cleanedJson.length,
        responseLength: response.length,
        isTruncated,
      },
      'JSON parsed successfully'
    );
    return {
      success: true,
      data: parsed as T,
      rawResponse: response,
      cleanedJson,
      usedPartialParse: false,
    };
  } catch (parseErr) {
    const parseError = parseErr instanceof Error ? parseErr.message : String(parseErr);

    // 如果允许部分解析，尝试修复不完整的JSON
    if (allowPartial) {
      const partialResult = tryPartialParse(cleanedJson);
      if (partialResult.success) {
        log.warn(
          {
            originalError: parseError,
            partialData: partialResult.data,
          },
          'Used partial JSON parsing'
        );
        return {
          success: true,
          data: partialResult.data as T,
          rawResponse: response,
          cleanedJson,
          usedPartialParse: true,
        };
      }
    }

    // 解析失败，返回详细错误信息
    const error = `${errorPrefix}失败：${parseError}`;
    log.warn(
      {
        error: parseError,
        responseLength: response.length,
        jsonLength: cleanedJson.length,
        jsonPreview: cleanedJson.substring(0, 500),
        isTruncated,
      },
      'Failed to parse LLM JSON response'
    );
    return {
      success: false,
      error,
      rawResponse: response,
      cleanedJson,
    };
  }
}

/**
 * 从响应文本中提取JSON内容
 * 处理以下格式：
 * - ```json ... ```
 * - ``` ... ```
 * - 纯JSON文本
 *
 * @param text - 响应文本
 * @returns 提取的JSON字符串
 */
function extractJSON(text: string): string {
  // 尝试匹配markdown代码块
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/;
  const match = text.match(codeBlockRegex);

  if (match && match[1]) {
    return match[1].trim();
  }

  // 如果没有代码块，尝试找到第一个 { 和最后一个 }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.substring(firstBrace, lastBrace + 1);
  }

  // 如果都不是，返回原文本
  return text;
}

/**
 * 尝试部分解析不完整的JSON
 * 通过修复常见的JSON格式问题：
 * - 缺失的闭合括号
 * - 缺失的引号
 * - 尾随逗号
 *
 * @param json - 不完整的JSON字符串
 * @returns 部分解析结果
 */
function tryPartialParse(json: string): ParseResult {
  let fixedJson = json;

  // 尝试修复缺失的闭合括号
  const openBraces = (json.match(/\{/g) || []).length;
  const closeBraces = (json.match(/\}/g) || []).length;
  const missingBraces = openBraces - closeBraces;

  if (missingBraces > 0) {
    fixedJson += '}'.repeat(missingBraces);
  }

  // 尝试修复缺失的闭合方括号
  const openBrackets = (json.match(/\[/g) || []).length;
  const closeBrackets = (json.match(/\]/g) || []).length;
  const missingBrackets = openBrackets - closeBrackets;

  if (missingBrackets > 0) {
    fixedJson += ']'.repeat(missingBrackets);
  }

  // 尝试修复尾随逗号
  fixedJson = fixedJson.replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(fixedJson);
    return {
      success: true,
      data: parsed,
      rawResponse: json,
      cleanedJson: fixedJson,
      usedPartialParse: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      rawResponse: json,
      cleanedJson: fixedJson,
    };
  }
}

/**
 * 验证JSON响应是否符合预期的结构
 *
 * @param data - 解析后的数据
 * @param requiredFields - 必需的字段列表
 * @returns 验证结果
 */
export function validateJSONStructure<T extends Record<string, any>>(
  data: T,
  requiredFields: (keyof T)[]
): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (!(field in data) || data[field] === undefined || data[field] === null) {
      missingFields.push(String(field));
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * 安全地解析JSON，失败时返回默认值
 *
 * @param response - 大模型响应
 * @param defaultValue - 解析失败时的默认值
 * @param options - 解析选项
 * @returns 解析后的数据或默认值
 */
export function safeParseLLMJSON<T>(
  response: string,
  defaultValue: T,
  options: ParseOptions = {}
): T {
  const result = parseLLMJSON<T>(response, options);
  return result.success ? result.data! : defaultValue;
}
