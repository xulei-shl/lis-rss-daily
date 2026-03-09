/**
 * 企业微信配置管理
 *
 * 从 YAML 文件加载企业微信 webhook 配置，提供 CRUD 操作接口
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../logger.js';

const log = logger.child({ module: 'wechat-config' });

/**
 * 推送类型配置接口
 */
export interface WeChatPushTypes {
  daily_summary: boolean;
  journal_all: boolean;
  new_articles: boolean;
}

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

    // 为旧版本数据迁移：确保每个 webhook 都有 push_types
    _config.webhooks = _config.webhooks.map((webhook) => {
      if (!webhook.push_types) {
        return {
          ...webhook,
          push_types: {
            daily_summary: true,
            journal_all: true,
            new_articles: true,
          },
        };
      }
      return webhook;
    });

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
export function getWebhooksForPushType(pushType: keyof WeChatPushTypes): WeChatWebhook[] {
  const config = loadConfig();
  return config.webhooks.filter((w) => w.enabled && w.push_types[pushType]);
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
