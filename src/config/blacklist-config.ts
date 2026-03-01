/**
 * 黑名单配置加载器
 *
 * 从 YAML 文件加载黑名单配置，提供类型安全的访问接口
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * 黑名单配置接口
 */
export interface BlacklistConfig {
  version: string;
  title_keywords: {
    enabled: boolean;
    keywords: string;
  };
  metadata: {
    updated_at: string;
  };
}

// 单例缓存
let _config: BlacklistConfig | null = null;

/**
 * 加载并解析 YAML 配置文件
 */
function loadConfig(): BlacklistConfig {
  if (_config) {
    return _config;
  }

  const configPath = path.join(process.cwd(), 'config', 'blacklist.yaml');

  if (!fs.existsSync(configPath)) {
    throw new Error(`黑名单配置文件未找到: ${configPath}`);
  }

  const yamlContent = fs.readFileSync(configPath, 'utf-8');
  _config = yaml.load(yamlContent) as BlacklistConfig;

  return _config;
}

/**
 * 获取标题黑名单关键词数组（解析逗号分隔的字符串）
 */
export function getTitleBlacklistKeywords(): string[] {
  const config = loadConfig();
  if (!config.title_keywords.enabled) {
    return [];
  }

  const keywordsStr = config.title_keywords.keywords || '';
  if (!keywordsStr.trim()) {
    return [];
  }

  // 支持中英文逗号分隔，去除空白
  return keywordsStr
    .split(/[,，]/)
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

/**
 * 获取完整的黑名单配置
 */
export function getBlacklistConfig(): BlacklistConfig {
  return loadConfig();
}

/**
 * 重新加载配置
 */
export function reloadBlacklistConfig(): void {
  _config = null;
}
