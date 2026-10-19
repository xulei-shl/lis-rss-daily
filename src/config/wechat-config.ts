/**
 * 企业微信配置管理
 *
 * 从 YAML 文件加载企业微信 webhook 配置，提供 CRUD 操作接口
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../logger.js';
import { PUSH_TYPE_DEFINITIONS, type PushType } from '../constants/push-types.js';

const log = logger.child({ module: 'wechat-config' });

/**
 * 推送类型配置接口
 */
export type WeChatPushTypes = Record<PushType, boolean>;

/**
 * Webhook 配置接口
 */
export interface WeChatWebhook {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  push_types: WeChatPushTypes;
  created_at: string;
  updated_at?: string;
}

/**
 * 企业微信配置接口
 */
export interface WeChatConfig {
  version: string;
  webhooks: WeChatWebhook[];
  metadata: {
    created_at: string;
    updated_at: string;
    schema_version: string;
  };
}

// 单例缓存
let _config: WeChatConfig | null = null;
let _configPath: string | null = null;

/**
 * 获取配置文件路径
 */
function getConfigPath(): string {
  if (_configPath) {
    return _configPath;
  }
  _configPath = path.join(process.cwd(), 'config', 'wechat.yaml');
  return _configPath;
}

/**
 * 创建默认配置文件
 */
function createDefaultConfig(configPath: string): WeChatConfig {
  const now = new Date().toISOString();
  const defaultConfig: WeChatConfig = {
    version: '1.0',
    webhooks: [],
    metadata: {
      created_at: now,
      updated_at: now,
      schema_version: '1.0',
    },
  };

  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, yaml.dump(defaultConfig, { indent: 2 }), 'utf-8');
  log.info({ path: configPath }, 'Created default WeChat config file');
  return defaultConfig;
}

/**
 * 规范化 push_types
 *
 * - 更新已有 webhook：请求里没带的类型保持原值
 * - 新增 webhook：使用注册表里的 defaultEnabled（健康告警默认关闭）
 * - 加载旧版 YAML：健康告警继承 pdf_summary，避免升级后告警静默消失
 */
export function normalizeWeChatPushTypes(
  input: Partial<Record<PushType | 'daily_summary', boolean>> | undefined,
  existing?: WeChatPushTypes,
  legacyMode = false
): WeChatPushTypes {
  const raw = (input || {}) as Record<string, boolean | undefined>;
  const pdfSummary = raw.pdf_summary ?? existing?.pdf_summary ?? true;
  const legacyDailySummary = raw.daily_summary ?? existing?.daily_summary_journal ?? true;
  const result = {} as WeChatPushTypes;

  for (const type of PUSH_TYPE_DEFINITIONS) {
    const value = raw[type.key];
    if (value !== undefined) {
      result[type.key] = value !== false;
      continue;
    }
    if (existing) {
      result[type.key] = existing[type.key];
      continue;
    }
    if (legacyMode && type.key === 'health_alert') {
      result[type.key] = pdfSummary !== false;
      continue;
    }
    if (
      raw.daily_summary !== undefined &&
      (type.key === 'daily_summary_journal' || type.key === 'daily_summary_blog_news')
    ) {
      result[type.key] = legacyDailySummary !== false;
      continue;
    }
    result[type.key] = type.defaultEnabled;
  }

  return result;
}

/**
 * 加载并解析 YAML 配置文件
 */
function loadConfig(): WeChatConfig {
  if (_config) {
    return _config;
  }

  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    _config = createDefaultConfig(configPath);
    return _config;
  }

  try {
    const yamlContent = fs.readFileSync(configPath, 'utf-8');
    _config = yaml.load(yamlContent) as WeChatConfig;

    // 确保 webhooks 数组存在
    if (!_config.webhooks) {
      _config.webhooks = [];
    }

    // 为旧版本数据迁移：确保每个 webhook 都有完整的 push_types
    _config.webhooks = _config.webhooks.map((webhook) => ({
      ...webhook,
      push_types: normalizeWeChatPushTypes(webhook.push_types, undefined, true),
    }));

    log.debug({ path: configPath, webhookCount: _config.webhooks.length }, 'WeChat config loaded');
    return _config;
  } catch (error) {
    log.error({ path: configPath, error }, 'Failed to load WeChat config');
    // 如果加载失败，返回默认配置
    _config = createDefaultConfig(configPath);
    return _config;
  }
}

/**
 * 保存配置到文件
 */
function saveConfig(config: WeChatConfig): void {
  const configPath = getConfigPath();

  try {
    config.metadata.updated_at = new Date().toISOString();
    fs.writeFileSync(configPath, yaml.dump(config, { indent: 2 }), 'utf-8');
    _config = config;
    log.debug({ path: configPath }, 'WeChat config saved');
  } catch (error) {
    log.error({ path: configPath, error }, 'Failed to save WeChat config');
    throw error;
  }
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 获取所有 webhook
 */
export function getWeChatWebhooks(): WeChatWebhook[] {
  const config = loadConfig();
  return [...config.webhooks];
}

/**
 * 获取启用的 webhook
 */
export function getActiveWeChatWebhooks(): WeChatWebhook[] {
  const config = loadConfig();
  return config.webhooks.filter((w) => w.enabled);
}

/**
 * 根据推送类型获取启用的 webhook
 */
export function getWebhooksForPushType(pushType: PushType): WeChatWebhook[] {
  const config = loadConfig();
  return config.webhooks.filter((w) => w.enabled && w.push_types[pushType]);
}

export function getWebhooksForDailySummaryType(type: 'journal' | 'blog_news' | 'all'): WeChatWebhook[] {
  if (type === 'journal') {
    return getWebhooksForPushType('daily_summary_journal');
  }
  if (type === 'blog_news') {
    return getWebhooksForPushType('daily_summary_blog_news');
  }

  const webhooks = new Map<string, WeChatWebhook>();
  for (const webhook of [
    ...getWebhooksForPushType('daily_summary_journal'),
    ...getWebhooksForPushType('daily_summary_blog_news'),
  ]) {
    webhooks.set(webhook.id, webhook);
  }
  return Array.from(webhooks.values());
}

/**
 * 根据 ID 获取 webhook
 */
export function getWeChatWebhookById(id: string): WeChatWebhook | undefined {
  const config = loadConfig();
  return config.webhooks.find((w) => w.id === id);
}

/**
 * 添加 webhook
 */
export function addWeChatWebhook(webhook: Omit<WeChatWebhook, 'id' | 'created_at' | 'updated_at'>): WeChatWebhook {
  const config = loadConfig();
  const now = new Date().toISOString();

  const newWebhook: WeChatWebhook = {
    ...webhook,
    id: generateId(),
    created_at: now,
    updated_at: now,
  };

  config.webhooks.push(newWebhook);
  saveConfig(config);

  log.info({ id: newWebhook.id, name: newWebhook.name }, 'WeChat webhook added');
  return newWebhook;
}

/**
 * 更新 webhook
 */
export function updateWeChatWebhook(
  id: string,
  updates: Partial<Omit<WeChatWebhook, 'id' | 'created_at'>>
): WeChatWebhook | null {
  const config = loadConfig();
  const index = config.webhooks.findIndex((w) => w.id === id);

  if (index === -1) {
    log.warn({ id }, 'WeChat webhook not found for update');
    return null;
  }

  config.webhooks[index] = {
    ...config.webhooks[index],
    ...updates,
    id,
    created_at: config.webhooks[index].created_at,
    updated_at: new Date().toISOString(),
  };

  saveConfig(config);

  log.info({ id, name: config.webhooks[index].name }, 'WeChat webhook updated');
  return config.webhooks[index];
}

/**
 * 删除 webhook
 */
export function deleteWeChatWebhook(id: string): boolean {
  const config = loadConfig();
  const index = config.webhooks.findIndex((w) => w.id === id);

  if (index === -1) {
    log.warn({ id }, 'WeChat webhook not found for deletion');
    return false;
  }

  const deleted = config.webhooks.splice(index, 1)[0];
  saveConfig(config);

  log.info({ id, name: deleted.name }, 'WeChat webhook deleted');
  return true;
}

/**
 * 重新加载配置（开发时使用）
 */
export function reloadWeChatConfig(): void {
  _config = null;
  loadConfig();
  log.info('WeChat config reloaded');
}

/**
 * 验证 webhook URL 格式
 */
export function isValidWeChatWebhookUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  // 企业微信 webhook URL 格式: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
  return url.includes('qyapi.weixin.qq.com/cgi-bin/webhook/send');
}
