/**
 * 类型配置加载器
 *
 * 从 YAML 文件加载类型定义，提供类型安全的访问接口
 *
 * 单一真实来源 (SSOT) - 所有类型枚举从 config/types.yaml 加载
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * 类型配置接口
 */
export interface TypeConfig {
  version: string;
  task_types: Record<string, TaskTypeConfig>;
  source_types: Record<string, SourceTypeConfig>;
  metadata: {
    created_at: string;
    updated_at: string;
    schema_version: string;
  };
}

/**
 * 任务类型配置接口
 */
export interface TaskTypeConfig {
  code: string;
  label: string;
  label_en: string;
  description: string;
  priority: number;
  enabled: boolean;
}

/**
 * 源类型配置接口
 */
export interface SourceTypeConfig {
  code: string;
  label: string;
  label_en: string;
  description: string;
  priority: number;
  icon: string;
  default?: boolean;
}

// 单例缓存
let _config: TypeConfig | null = null;

/**
 * 加载并解析 YAML 配置文件
 */
function loadConfig(): TypeConfig {
  if (_config) {
    return _config;
  }

  const configPath = path.join(process.cwd(), 'config', 'types.yaml');

  if (!fs.existsSync(configPath)) {
    throw new Error(`类型配置文件未找到: ${configPath}`);
  }

  const yamlContent = fs.readFileSync(configPath, 'utf-8');
  _config = yaml.load(yamlContent) as TypeConfig;

  return _config;
}

// ============================================================================
// 任务类型相关函数
// ============================================================================

/**
 * 获取所有已启用的任务类型代码（按优先级排序）
 */
export function getTaskTypeCodes(): string[] {
  const config = loadConfig();
  return Object.values(config.task_types)
    .filter(t => t.enabled)
    .sort((a, b) => a.priority - b.priority)
    .map(t => t.code);
}

/**
 * 根据代码获取任务类型配置
 */
export function getTaskTypeConfig(code: string): TaskTypeConfig | undefined {
  const config = loadConfig();
  return Object.values(config.task_types).find(t => t.code === code);
}

/**
 * 获取任务类型标签映射
 */
export function getTaskTypeLabels(): Record<string, string> {
  const config = loadConfig();
  const result: Record<string, string> = {};
  for (const type of Object.values(config.task_types)) {
    result[type.code] = type.label;
  }
  return result;
}

// ============================================================================
// 源类型相关函数
// ============================================================================

/**
 * 获取所有源类型代码（按优先级排序）
 */
export function getSourceTypeCodes(): string[] {
  const config = loadConfig();
  return Object.values(config.source_types)
    .sort((a, b) => a.priority - b.priority)
    .map(t => t.code);
}

/**
 * 根据代码获取源类型配置
 */
export function getSourceTypeConfig(code: string): SourceTypeConfig | undefined {
  const config = loadConfig();
  return Object.values(config.source_types).find(t => t.code === code);
}

/**
 * 获取源类型优先级映射
 */
export function getSourceTypePriority(): Record<string, number> {
  const config = loadConfig();
  const result: Record<string, number> = {};
  for (const type of Object.values(config.source_types)) {
    result[type.code] = type.priority;
  }
  return result;
}

/**
 * 获取源类型标签映射
 */
export function getSourceTypeLabels(): Record<string, string> {
  const config = loadConfig();
  const result: Record<string, string> = {};
  for (const type of Object.values(config.source_types)) {
    result[type.code] = type.label;
  }
  return result;
}

/**
 * 获取默认源类型
 */
export function getDefaultSourceType(): string {
  const config = loadConfig();
  const defaultType = Object.values(config.source_types).find(t => t.default);
  return defaultType?.code || 'blog';
}

// ============================================================================
// 通用函数
// ============================================================================

/**
 * 获取完整的类型配置（用于 API 响应）
 */
export function getTypeConfigForAPI(): TypeConfig {
  return loadConfig();
}

/**
 * 重新加载配置（开发时使用）
 */
export function reloadConfig(): void {
  _config = null;
}
