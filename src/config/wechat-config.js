"use strict";
/**
 * 企业微信配置管理
 *
 * 从 YAML 文件加载企业微信 webhook 配置，提供 CRUD 操作接口
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeChatWebhooks = getWeChatWebhooks;
exports.getActiveWeChatWebhooks = getActiveWeChatWebhooks;
exports.getWebhooksForPushType = getWebhooksForPushType;
exports.getWeChatWebhookById = getWeChatWebhookById;
exports.addWeChatWebhook = addWeChatWebhook;
exports.updateWeChatWebhook = updateWeChatWebhook;
exports.deleteWeChatWebhook = deleteWeChatWebhook;
exports.reloadWeChatConfig = reloadWeChatConfig;
exports.isValidWeChatWebhookUrl = isValidWeChatWebhookUrl;
var fs_1 = require("fs");
var path_1 = require("path");
var js_yaml_1 = require("js-yaml");
var logger_js_1 = require("../logger.js");
var log = logger_js_1.logger.child({ module: 'wechat-config' });
// 单例缓存
var _config = null;
var _configPath = null;
/**
 * 获取配置文件路径
 */
function getConfigPath() {
    if (_configPath) {
        return _configPath;
    }
    _configPath = path_1.default.join(process.cwd(), 'config', 'wechat.yaml');
    return _configPath;
}
/**
 * 创建默认配置文件
 */
function createDefaultConfig(configPath) {
    var now = new Date().toISOString();
    var defaultConfig = {
        version: '1.0',
        webhooks: [],
        metadata: {
            created_at: now,
            updated_at: now,
            schema_version: '1.0',
        },
    };
    var configDir = path_1.default.dirname(configPath);
    if (!fs_1.default.existsSync(configDir)) {
        fs_1.default.mkdirSync(configDir, { recursive: true });
    }
    fs_1.default.writeFileSync(configPath, js_yaml_1.default.dump(defaultConfig, { indent: 2 }), 'utf-8');
    log.info({ path: configPath }, 'Created default WeChat config file');
    return defaultConfig;
}
/**
 * 加载并解析 YAML 配置文件
 */
function loadConfig() {
    if (_config) {
        return _config;
    }
    var configPath = getConfigPath();
    if (!fs_1.default.existsSync(configPath)) {
        _config = createDefaultConfig(configPath);
        return _config;
    }
    try {
        var yamlContent = fs_1.default.readFileSync(configPath, 'utf-8');
        _config = js_yaml_1.default.load(yamlContent);
        // 确保 webhooks 数组存在
        if (!_config.webhooks) {
            _config.webhooks = [];
        }
        // 为旧版本数据迁移：确保每个 webhook 都有 push_types
        _config.webhooks = _config.webhooks.map(function (webhook) {
            if (!webhook.push_types) {
                return __assign(__assign({}, webhook), { push_types: {
                        daily_summary: true,
                        journal_all: true,
                        new_articles: true,
                    } });
            }
            return webhook;
        });
        log.debug({ path: configPath, webhookCount: _config.webhooks.length }, 'WeChat config loaded');
        return _config;
    }
    catch (error) {
        log.error({ path: configPath, error: error }, 'Failed to load WeChat config');
        // 如果加载失败，返回默认配置
        _config = createDefaultConfig(configPath);
        return _config;
    }
}
/**
 * 保存配置到文件
 */
function saveConfig(config) {
    var configPath = getConfigPath();
    try {
        config.metadata.updated_at = new Date().toISOString();
        fs_1.default.writeFileSync(configPath, js_yaml_1.default.dump(config, { indent: 2 }), 'utf-8');
        _config = config;
        log.debug({ path: configPath }, 'WeChat config saved');
    }
    catch (error) {
        log.error({ path: configPath, error: error }, 'Failed to save WeChat config');
        throw error;
    }
}
/**
 * 生成唯一 ID
 */
function generateId() {
    return "webhook-".concat(Date.now(), "-").concat(Math.random().toString(36).substr(2, 9));
}
// ============================================================================
// 公开 API
// ============================================================================
/**
 * 获取所有 webhook
 */
function getWeChatWebhooks() {
    var config = loadConfig();
    return __spreadArray([], config.webhooks, true);
}
/**
 * 获取启用的 webhook
 */
function getActiveWeChatWebhooks() {
    var config = loadConfig();
    return config.webhooks.filter(function (w) { return w.enabled; });
}
/**
 * 根据推送类型获取启用的 webhook
 */
function getWebhooksForPushType(pushType) {
    var config = loadConfig();
    return config.webhooks.filter(function (w) { return w.enabled && w.push_types[pushType]; });
}
/**
 * 根据 ID 获取 webhook
 */
function getWeChatWebhookById(id) {
    var config = loadConfig();
    return config.webhooks.find(function (w) { return w.id === id; });
}
/**
 * 添加 webhook
 */
function addWeChatWebhook(webhook) {
    var config = loadConfig();
    var now = new Date().toISOString();
    var newWebhook = __assign(__assign({}, webhook), { id: generateId(), created_at: now, updated_at: now });
    config.webhooks.push(newWebhook);
    saveConfig(config);
    log.info({ id: newWebhook.id, name: newWebhook.name }, 'WeChat webhook added');
    return newWebhook;
}
/**
 * 更新 webhook
 */
function updateWeChatWebhook(id, updates) {
    var config = loadConfig();
    var index = config.webhooks.findIndex(function (w) { return w.id === id; });
    if (index === -1) {
        log.warn({ id: id }, 'WeChat webhook not found for update');
        return null;
    }
    config.webhooks[index] = __assign(__assign(__assign({}, config.webhooks[index]), updates), { id: id, created_at: config.webhooks[index].created_at, updated_at: new Date().toISOString() });
    saveConfig(config);
    log.info({ id: id, name: config.webhooks[index].name }, 'WeChat webhook updated');
    return config.webhooks[index];
}
/**
 * 删除 webhook
 */
function deleteWeChatWebhook(id) {
    var config = loadConfig();
    var index = config.webhooks.findIndex(function (w) { return w.id === id; });
    if (index === -1) {
        log.warn({ id: id }, 'WeChat webhook not found for deletion');
        return false;
    }
    var deleted = config.webhooks.splice(index, 1)[0];
    saveConfig(config);
    log.info({ id: id, name: deleted.name }, 'WeChat webhook deleted');
    return true;
}
/**
 * 重新加载配置（开发时使用）
 */
function reloadWeChatConfig() {
    _config = null;
    loadConfig();
    log.info('WeChat config reloaded');
}
/**
 * 验证 webhook URL 格式
 */
function isValidWeChatWebhookUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    // 企业微信 webhook URL 格式: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
    return url.includes('qyapi.weixin.qq.com/cgi-bin/webhook/send');
}
