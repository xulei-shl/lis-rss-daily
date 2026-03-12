"use strict";
/**
 * Telegram Notification Module
 *
 * Main entry point for Telegram notifications.
 * Provides singleton TelegramNotifier class for sending notifications.
 * Supports multiple chat recipients with different permission levels.
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
exports.getTelegramNotifier = getTelegramNotifier;
var logger_js_1 = require("../logger.js");
var client_js_1 = require("./client.js");
var formatters_js_1 = require("./formatters.js");
var settings_js_1 = require("../api/settings.js");
var telegram_chats_js_1 = require("../api/telegram-chats.js");
var log = logger_js_1.logger.child({ module: 'telegram-notifier' });
// Settings keys for Telegram configuration (global settings)
var TELEGRAM_SETTINGS_KEYS = [
    'telegram_enabled',
    'telegram_bot_token',
];
/**
 * Load global Telegram configuration (bot token, enabled status)
 */
function loadTelegramConfig(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var settings, enabled, botToken, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, settings_js_1.getUserSettings)(userId, __spreadArray([], TELEGRAM_SETTINGS_KEYS, true))];
                case 1:
                    settings = _a.sent();
                    enabled = settings.telegram_enabled === 'true';
                    botToken = settings.telegram_bot_token || '';
                    if (!enabled || !botToken) {
                        log.debug({ userId: userId, enabled: !!enabled, hasToken: !!botToken }, 'Telegram not configured');
                        return [2 /*return*/, null];
                    }
                    // Return config with placeholder chatId (chats are now managed separately)
                    return [2 /*return*/, {
                            enabled: enabled,
                            botToken: botToken,
                            chatId: '', // Not used anymore, but kept for compatibility
                            dailySummary: true, // Not used anymore
                            newArticles: true, // Not used anymore
                        }];
                case 2:
                    error_1 = _a.sent();
                    log.error({ userId: userId, error: error_1 }, 'Failed to load Telegram settings');
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Telegram Notifier
 *
 * Singleton class for sending Telegram notifications.
 */
var TelegramNotifier = /** @class */ (function () {
    function TelegramNotifier() {
        this.sentCache = new Map();
        this.CACHE_TTL = 60000;
    }
    TelegramNotifier.prototype.getCacheKey = function (userId, type, date) {
        return "".concat(userId, ":").concat(type, ":").concat(date);
    };
    TelegramNotifier.prototype.checkAndSetCache = function (key) {
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
     * Send daily summary notification to all configured chats
     */
    TelegramNotifier.prototype.sendDailySummary = function (userId, data) {
        return __awaiter(this, void 0, void 0, function () {
            var cacheKey, config, chats, client, message, successCount, failCount, _i, chats_1, chat, result, error_2;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        cacheKey = this.getCacheKey(userId, data.type, data.date);
                        if (this.checkAndSetCache(cacheKey)) {
                            log.info({ userId: userId, type: data.type, date: data.date }, '[DEBUG] Skipping duplicate sendDailySummary');
                            return [2 /*return*/, false];
                        }
                        return [4 /*yield*/, loadTelegramConfig(userId)];
                    case 1:
                        config = _b.sent();
                        if (!config) {
                            log.debug({ userId: userId }, 'Telegram not configured, skipping daily summary');
                            return [2 /*return*/, false];
                        }
                        return [4 /*yield*/, (0, telegram_chats_js_1.getDailySummaryChats)(userId)];
                    case 2:
                        chats = _b.sent();
                        if (chats.length === 0) {
                            log.debug({ userId: userId }, 'No chats configured for daily summary');
                            return [2 /*return*/, false];
                        }
                        client = new client_js_1.TelegramClient(config.botToken);
                        message = (0, formatters_js_1.formatDailySummary)(data);
                        successCount = 0;
                        failCount = 0;
                        _i = 0, chats_1 = chats;
                        _b.label = 3;
                    case 3:
                        if (!(_i < chats_1.length)) return [3 /*break*/, 8];
                        chat = chats_1[_i];
                        _b.label = 4;
                    case 4:
                        _b.trys.push([4, 6, , 7]);
                        return [4 /*yield*/, client.sendMessage(chat.chatId, message, 'HTML')];
                    case 5:
                        result = _b.sent();
                        if (result.ok) {
                            successCount++;
                            log.info({
                                userId: userId,
                                chatId: chat.chatId,
                                chatName: chat.chatName,
                                date: data.date,
                                type: data.type,
                                articleCount: data.totalArticles,
                                messageId: (_a = result.result) === null || _a === void 0 ? void 0 : _a.message_id,
                            }, 'Daily summary sent to Telegram');
                        }
                        else {
                            failCount++;
                            log.warn({
                                userId: userId,
                                chatId: chat.chatId,
                                error: result.description,
                            }, 'Failed to send daily summary to Telegram');
                        }
                        return [3 /*break*/, 7];
                    case 6:
                        error_2 = _b.sent();
                        failCount++;
                        log.error({
                            userId: userId,
                            chatId: chat.chatId,
                            error: error_2 instanceof Error ? error_2.message : String(error_2),
                        }, 'Failed to send daily summary to Telegram');
                        return [3 /*break*/, 7];
                    case 7:
                        _i++;
                        return [3 /*break*/, 3];
                    case 8: return [2 /*return*/, successCount > 0];
                }
            });
        });
    };
    /**
     * Send journal all summary notification to all configured chats
     */
    TelegramNotifier.prototype.sendJournalAllSummary = function (userId, data) {
        return __awaiter(this, void 0, void 0, function () {
            var cacheKey, config, chats, client, message, successCount, failCount, _i, chats_2, chat, result, error_3;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        cacheKey = this.getCacheKey(userId, 'journal_all', data.date);
                        if (this.checkAndSetCache(cacheKey)) {
                            log.info({ userId: userId, date: data.date }, 'Skipping duplicate sendJournalAllSummary');
                            return [2 /*return*/, false];
                        }
                        return [4 /*yield*/, loadTelegramConfig(userId)];
                    case 1:
                        config = _b.sent();
                        if (!config) {
                            log.debug({ userId: userId }, 'Telegram not configured, skipping journal all summary');
                            return [2 /*return*/, false];
                        }
                        return [4 /*yield*/, (0, telegram_chats_js_1.getJournalAllChats)(userId)];
                    case 2:
                        chats = _b.sent();
                        if (chats.length === 0) {
                            log.debug({ userId: userId }, 'No chats configured for journal all summary');
                            return [2 /*return*/, false];
                        }
                        client = new client_js_1.TelegramClient(config.botToken);
                        message = (0, formatters_js_1.formatDailySummary)({
                            date: data.date,
                            type: 'journal_all',
                            totalArticles: data.totalArticles,
                            summary: data.summary,
                            articlesByType: data.articlesByType,
                        });
                        successCount = 0;
                        failCount = 0;
                        _i = 0, chats_2 = chats;
                        _b.label = 3;
                    case 3:
                        if (!(_i < chats_2.length)) return [3 /*break*/, 8];
                        chat = chats_2[_i];
                        _b.label = 4;
                    case 4:
                        _b.trys.push([4, 6, , 7]);
                        return [4 /*yield*/, client.sendMessage(chat.chatId, message, 'HTML')];
                    case 5:
                        result = _b.sent();
                        if (result.ok) {
                            successCount++;
                            log.info({
                                userId: userId,
                                chatId: chat.chatId,
                                chatName: chat.chatName,
                                date: data.date,
                                articleCount: data.totalArticles,
                                messageId: (_a = result.result) === null || _a === void 0 ? void 0 : _a.message_id,
                            }, 'Journal all summary sent to Telegram');
                        }
                        else {
                            failCount++;
                            log.warn({
                                userId: userId,
                                chatId: chat.chatId,
                                error: result.description,
                            }, 'Failed to send journal all summary to Telegram');
                        }
                        return [3 /*break*/, 7];
                    case 6:
                        error_3 = _b.sent();
                        failCount++;
                        log.error({
                            userId: userId,
                            chatId: chat.chatId,
                            error: error_3 instanceof Error ? error_3.message : String(error_3),
                        }, 'Failed to send journal all summary to Telegram');
                        return [3 /*break*/, 7];
                    case 7:
                        _i++;
                        return [3 /*break*/, 3];
                    case 8: return [2 /*return*/, successCount > 0];
                }
            });
        });
    };
    /**
     * Test Telegram connection
     * @param userId - User ID
     * @param chatId - Optional specific chat ID to test. If not provided, tests all active chats.
     */
    TelegramNotifier.prototype.testConnection = function (userId, chatId) {
        return __awaiter(this, void 0, void 0, function () {
            var config, client, success, chats, firstChat, success, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, loadTelegramConfig(userId)];
                    case 1:
                        config = _a.sent();
                        if (!config) {
                            return [2 /*return*/, {
                                    success: false,
                                    message: 'Telegram 未配置或未启用',
                                }];
                        }
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 8, , 9]);
                        client = new client_js_1.TelegramClient(config.botToken);
                        if (!chatId) return [3 /*break*/, 4];
                        return [4 /*yield*/, client.testConnection(chatId)];
                    case 3:
                        success = _a.sent();
                        if (success) {
                            log.info({ userId: userId, chatId: chatId }, 'Telegram connection test successful');
                            return [2 /*return*/, {
                                    success: true,
                                    message: '连接测试成功！测试消息已发送。',
                                }];
                        }
                        else {
                            return [2 /*return*/, {
                                    success: false,
                                    message: '连接测试失败。请检查 Bot Token 和 Chat ID 是否正确。',
                                }];
                        }
                        return [3 /*break*/, 7];
                    case 4: return [4 /*yield*/, (0, telegram_chats_js_1.getActiveTelegramChats)(userId)];
                    case 5:
                        chats = _a.sent();
                        if (chats.length === 0) {
                            return [2 /*return*/, {
                                    success: false,
                                    message: '未配置任何接收者',
                                }];
                        }
                        firstChat = chats[0];
                        return [4 /*yield*/, client.testConnection(firstChat.chatId)];
                    case 6:
                        success = _a.sent();
                        if (success) {
                            log.info({ userId: userId, chatId: firstChat.chatId }, 'Telegram connection test successful');
                            return [2 /*return*/, {
                                    success: true,
                                    message: "\u8FDE\u63A5\u6D4B\u8BD5\u6210\u529F\uFF01\u5DF2\u53D1\u9001\u6D4B\u8BD5\u6D88\u606F\u5230 ".concat(chats.length, " \u4E2A\u63A5\u6536\u8005\u3002"),
                                }];
                        }
                        else {
                            return [2 /*return*/, {
                                    success: false,
                                    message: '连接测试失败。请检查 Bot Token 和 Chat ID 是否正确。',
                                }];
                        }
                        _a.label = 7;
                    case 7: return [3 /*break*/, 9];
                    case 8:
                        error_4 = _a.sent();
                        log.error({
                            userId: userId,
                            error: error_4 instanceof Error ? error_4.message : String(error_4),
                        }, 'Telegram connection test failed');
                        return [2 /*return*/, {
                                success: false,
                                message: "\u8FDE\u63A5\u6D4B\u8BD5\u5931\u8D25: ".concat(error_4 instanceof Error ? error_4.message : String(error_4)),
                            }];
                    case 9: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Send new article notification to all configured chats
     */
    TelegramNotifier.prototype.sendNewArticle = function (userId, article) {
        return __awaiter(this, void 0, void 0, function () {
            var config, chats, client, summary, message, keyboard, successCount, failCount, _i, chats_3, chat, result, error_5;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, loadTelegramConfig(userId)];
                    case 1:
                        config = _b.sent();
                        if (!config) {
                            log.debug({ userId: userId }, 'Telegram not configured, skipping new article notification');
                            return [2 /*return*/, false];
                        }
                        return [4 /*yield*/, (0, telegram_chats_js_1.getNewArticlesChats)(userId)];
                    case 2:
                        chats = _b.sent();
                        if (chats.length === 0) {
                            log.debug({ userId: userId }, 'No chats configured for new articles');
                            return [2 /*return*/, false];
                        }
                        client = new client_js_1.TelegramClient(config.botToken);
                        summary = article.summary_zh || article.summary || undefined;
                        if (!summary && (article.markdown_content || article.content)) {
                            summary = article.markdown_content || article.content || undefined;
                            // Truncate content if too long (max 500 chars for preview)
                            if (summary && summary.length > 500) {
                                summary = summary.substring(0, 500) + '...';
                            }
                        }
                        message = (0, formatters_js_1.formatNewArticle)({
                            id: article.id,
                            title: article.title,
                            url: article.url,
                            sourceName: article.source_name || article.rss_source_name || article.journal_name || 'Unknown',
                            sourceType: article.source_origin === 'journal' ? '期刊文章' :
                                article.source_origin === 'keyword' ? '关键词订阅' : 'RSS订阅',
                            summary: summary,
                        });
                        keyboard = (0, formatters_js_1.createArticleKeyboard)(article.id, article.is_read === 1, article.rating);
                        successCount = 0;
                        failCount = 0;
                        _i = 0, chats_3 = chats;
                        _b.label = 3;
                    case 3:
                        if (!(_i < chats_3.length)) return [3 /*break*/, 8];
                        chat = chats_3[_i];
                        _b.label = 4;
                    case 4:
                        _b.trys.push([4, 6, , 7]);
                        return [4 /*yield*/, client.sendMessageWithKeyboard(chat.chatId, message, keyboard, 'HTML')];
                    case 5:
                        result = _b.sent();
                        if (result.ok) {
                            successCount++;
                            log.info({
                                userId: userId,
                                chatId: chat.chatId,
                                chatName: chat.chatName,
                                articleId: article.id,
                                title: article.title,
                                messageId: (_a = result.result) === null || _a === void 0 ? void 0 : _a.message_id,
                            }, 'New article sent to Telegram');
                        }
                        else {
                            failCount++;
                            log.warn({
                                userId: userId,
                                chatId: chat.chatId,
                                articleId: article.id,
                                error: result.description,
                            }, 'Failed to send new article to Telegram');
                        }
                        return [3 /*break*/, 7];
                    case 6:
                        error_5 = _b.sent();
                        failCount++;
                        log.error({
                            userId: userId,
                            chatId: chat.chatId,
                            articleId: article.id,
                            error: error_5 instanceof Error ? error_5.message : String(error_5),
                        }, 'Failed to send new article to Telegram');
                        return [3 /*break*/, 7];
                    case 7:
                        _i++;
                        return [3 /*break*/, 3];
                    case 8: return [2 /*return*/, successCount > 0];
                }
            });
        });
    };
    /**
     * Get Telegram configuration (for display purposes, token is masked)
     */
    TelegramNotifier.prototype.getMaskedConfig = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            var config, tokenParts, maskedToken, hasChats;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, loadTelegramConfig(userId)];
                    case 1:
                        config = _a.sent();
                        if (!config) {
                            return [2 /*return*/, null];
                        }
                        tokenParts = config.botToken.split(':');
                        maskedToken = tokenParts.length > 1
                            ? "".concat(tokenParts[0].substring(0, 4), "***:").concat(tokenParts[1].substring(0, 4), "***")
                            : '****';
                        return [4 /*yield*/, (0, telegram_chats_js_1.hasTelegramChats)(userId)];
                    case 2:
                        hasChats = _a.sent();
                        return [2 /*return*/, {
                                enabled: config.enabled,
                                botToken: maskedToken,
                                hasChats: hasChats,
                            }];
                }
            });
        });
    };
    /**
     * Check if Telegram is enabled and configured for a user
     */
    TelegramNotifier.prototype.isEnabled = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            var config;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, loadTelegramConfig(userId)];
                    case 1:
                        config = _a.sent();
                        if (!config)
                            return [2 /*return*/, false];
                        return [2 /*return*/, (0, telegram_chats_js_1.hasTelegramChats)(userId)];
                }
            });
        });
    };
    /**
     * Get active chats for a user
     */
    TelegramNotifier.prototype.getActiveChats = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, (0, telegram_chats_js_1.getActiveTelegramChats)(userId)];
            });
        });
    };
    return TelegramNotifier;
}());
// Singleton instance
var _instance = null;
/**
 * Get Telegram notifier instance
 */
function getTelegramNotifier() {
    if (!_instance) {
        _instance = new TelegramNotifier();
    }
    return _instance;
}
