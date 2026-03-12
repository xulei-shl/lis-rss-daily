"use strict";
/**
 * 企业微信通知模块
 *
 * 企业微信通知的主入口。
 * 提供单例 WeChatNotifier 类用于发送通知。
 * 支持多个 webhook，每个 webhook 可独立配置推送类型。
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeChatNotifier = getWeChatNotifier;
var logger_js_1 = require("../logger.js");
var client_js_1 = require("./client.js");
var formatters_js_1 = require("./formatters.js");
var wechat_config_js_1 = require("../config/wechat-config.js");
var log = logger_js_1.logger.child({ module: 'wechat-notifier' });
/**
 * 企业微信通知器
 *
 * 单例类用于发送企业微信通知。
 */
var WeChatNotifier = /** @class */ (function () {
    function WeChatNotifier() {
        this.sentCache = new Map();
        this.CACHE_TTL = 60000; // 60秒
    }
    WeChatNotifier.prototype.getCacheKey = function (userId, type, date) {
        return "".concat(userId, ":").concat(type, ":").concat(date);
    };
    WeChatNotifier.prototype.checkAndSetCache = function (key) {
        var now = Date.now();
        var lastSent = this.sentCache.get(key);
        if (lastSent && now - lastSent < this.CACHE_TTL) {
            return true;
        }
        this.sentCache.set(key, now);
        if (this.sentCache.size > 100) {
            var oldestKey = this.sentCache.keys().next().value;
            if (oldestKey) {
                this.sentCache.delete(oldestKey);
            }
        }
        return false;
    };
    /**
     * 发送每日总结通知到所有配置了该类型的 webhook
     */
    WeChatNotifier.prototype.sendDailySummary = function (userId, data) {
        return __awaiter(this, void 0, void 0, function () {
            var cacheKey, webhooks, message, successCount, failCount, _i, webhooks_1, webhook, client, success, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        cacheKey = this.getCacheKey(userId, data.type, data.date);
                        if (this.checkAndSetCache(cacheKey)) {
                            log.info({ userId: userId, type: data.type, date: data.date }, '[DEBUG] Skipping duplicate sendDailySummary');
                            return [2 /*return*/, false];
                        }
                        webhooks = (0, wechat_config_js_1.getWebhooksForPushType)('daily_summary');
                        if (webhooks.length === 0) {
                            log.debug({ userId: userId }, 'No WeChat webhooks configured for daily summary');
                            return [2 /*return*/, false];
                        }
                        message = (0, formatters_js_1.formatDailySummary)(data);
                        successCount = 0;
                        failCount = 0;
                        _i = 0, webhooks_1 = webhooks;
                        _a.label = 1;
                    case 1:
                        if (!(_i < webhooks_1.length)) return [3 /*break*/, 6];
                        webhook = webhooks_1[_i];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        client = new client_js_1.WeChatClient(webhook.url);
                        return [4 /*yield*/, client.sendMarkdown(message)];
                    case 3:
                        success = _a.sent();
                        if (success) {
                            successCount++;
                            log.info({
                                userId: userId,
                                webhookId: webhook.id,
                                webhookName: webhook.name,
                                date: data.date,
                                type: data.type,
                                articleCount: data.totalArticles,
                            }, 'Daily summary sent to WeChat');
                        }
                        else {
                            failCount++;
                            log.warn({ userId: userId, webhookId: webhook.id, webhookName: webhook.name }, 'Failed to send daily summary to WeChat');
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        error_1 = _a.sent();
                        failCount++;
                        log.error({
                            userId: userId,
                            webhookId: webhook.id,
                            webhookName: webhook.name,
                            error: error_1 instanceof Error ? error_1.message : String(error_1),
                        }, 'Failed to send daily summary to WeChat');
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, successCount > 0];
                }
            });
        });
    };
    /**
     * 发送全部期刊总结通知到所有配置了该类型的 webhook
     */
    WeChatNotifier.prototype.sendJournalAllSummary = function (userId, data) {
        return __awaiter(this, void 0, void 0, function () {
            var cacheKey, webhooks, message, successCount, failCount, _i, webhooks_2, webhook, client, success, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        cacheKey = this.getCacheKey(userId, 'journal_all', data.date);
                        if (this.checkAndSetCache(cacheKey)) {
                            log.info({ userId: userId, date: data.date }, '[DEBUG] Skipping duplicate sendJournalAllSummary');
                            return [2 /*return*/, false];
                        }
                        webhooks = (0, wechat_config_js_1.getWebhooksForPushType)('journal_all');
                        if (webhooks.length === 0) {
                            log.debug({ userId: userId }, 'No WeChat webhooks configured for journal all summary');
                            return [2 /*return*/, false];
                        }
                        message = (0, formatters_js_1.formatJournalAllSummary)(data);
                        successCount = 0;
                        failCount = 0;
                        _i = 0, webhooks_2 = webhooks;
                        _a.label = 1;
                    case 1:
                        if (!(_i < webhooks_2.length)) return [3 /*break*/, 6];
                        webhook = webhooks_2[_i];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        client = new client_js_1.WeChatClient(webhook.url);
                        return [4 /*yield*/, client.sendMarkdown(message)];
                    case 3:
                        success = _a.sent();
                        if (success) {
                            successCount++;
                            log.info({
                                userId: userId,
                                webhookId: webhook.id,
                                webhookName: webhook.name,
                                date: data.date,
                                articleCount: data.totalArticles,
                            }, 'Journal all summary sent to WeChat');
                        }
                        else {
                            failCount++;
                            log.warn({ userId: userId, webhookId: webhook.id, webhookName: webhook.name }, 'Failed to send journal all summary to WeChat');
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        error_2 = _a.sent();
                        failCount++;
                        log.error({
                            userId: userId,
                            webhookId: webhook.id,
                            webhookName: webhook.name,
                            error: error_2 instanceof Error ? error_2.message : String(error_2),
                        }, 'Failed to send journal all summary to WeChat');
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, successCount > 0];
                }
            });
        });
    };
    /**
     * 发送新增文章通知到所有配置了该类型的 webhook
     */
    WeChatNotifier.prototype.sendNewArticle = function (userId, article) {
        return __awaiter(this, void 0, void 0, function () {
            var webhooks, message, successCount, failCount, _i, webhooks_3, webhook, client, success, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        webhooks = (0, wechat_config_js_1.getWebhooksForPushType)('new_articles');
                        if (webhooks.length === 0) {
                            log.debug({ userId: userId }, 'No WeChat webhooks configured for new articles');
                            return [2 /*return*/, false];
                        }
                        message = (0, formatters_js_1.formatNewArticle)(article);
                        successCount = 0;
                        failCount = 0;
                        _i = 0, webhooks_3 = webhooks;
                        _a.label = 1;
                    case 1:
                        if (!(_i < webhooks_3.length)) return [3 /*break*/, 6];
                        webhook = webhooks_3[_i];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        client = new client_js_1.WeChatClient(webhook.url);
                        return [4 /*yield*/, client.sendMarkdown(message)];
                    case 3:
                        success = _a.sent();
                        if (success) {
                            successCount++;
                            log.info({
                                userId: userId,
                                webhookId: webhook.id,
                                webhookName: webhook.name,
                                articleId: article.id,
                                title: article.title,
                            }, 'New article sent to WeChat');
                        }
                        else {
                            failCount++;
                            log.warn({ userId: userId, webhookId: webhook.id, webhookName: webhook.name, articleId: article.id }, 'Failed to send new article to WeChat');
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        error_3 = _a.sent();
                        failCount++;
                        log.error({
                            userId: userId,
                            webhookId: webhook.id,
                            webhookName: webhook.name,
                            articleId: article.id,
                            error: error_3 instanceof Error ? error_3.message : String(error_3),
                        }, 'Failed to send new article to WeChat');
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, successCount > 0];
                }
            });
        });
    };
    /**
     * 测试指定 webhook 连接
     */
    WeChatNotifier.prototype.testWebhook = function (webhookId) {
        return __awaiter(this, void 0, void 0, function () {
            var webhook, client, message, success, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        webhook = (0, wechat_config_js_1.getWeChatWebhookById)(webhookId);
                        if (!webhook) {
                            return [2 /*return*/, {
                                    success: false,
                                    message: 'Webhook 未找到',
                                }];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        client = new client_js_1.WeChatClient(webhook.url);
                        message = (0, formatters_js_1.formatTestMessage)();
                        return [4 /*yield*/, client.sendMarkdown(message)];
                    case 2:
                        success = _a.sent();
                        if (success) {
                            log.info({ webhookId: webhookId, name: webhook.name }, 'WeChat webhook test successful');
                            return [2 /*return*/, {
                                    success: true,
                                    message: '连接测试成功！测试消息已发送。',
                                }];
                        }
                        else {
                            return [2 /*return*/, {
                                    success: false,
                                    message: '连接测试失败。请检查 Webhook URL 是否正确。',
                                }];
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        error_4 = _a.sent();
                        log.error({ webhookId: webhookId, name: webhook.name, error: error_4 }, 'WeChat webhook test failed');
                        return [2 /*return*/, {
                                success: false,
                                message: "\u8FDE\u63A5\u6D4B\u8BD5\u5931\u8D25: ".concat(error_4 instanceof Error ? error_4.message : String(error_4)),
                            }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * 获取所有 webhooks（用于显示）
     */
    WeChatNotifier.prototype.getWebhooks = function () {
        return (0, wechat_config_js_1.getWeChatWebhooks)();
    };
    /**
     * 检查是否有配置的 webhook
     */
    WeChatNotifier.prototype.hasAnyWebhooks = function () {
        return (0, wechat_config_js_1.getWeChatWebhooks)().length > 0;
    };
    return WeChatNotifier;
}());
// 单例实例
var _instance = null;
/**
 * 获取企业微信通知器实例
 */
function getWeChatNotifier() {
    if (!_instance) {
        _instance = new WeChatNotifier();
    }
    return _instance;
}
