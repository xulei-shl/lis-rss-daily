"use strict";
/**
 * Telegram API Client
 *
 * HTTP client for Telegram Bot API with proxy support.
 * Uses undici ProxyAgent for proxy support (per-request, not global).
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
exports.TelegramClient = void 0;
var logger_js_1 = require("../logger.js");
var undici_1 = require("undici");
var log = logger_js_1.logger.child({ module: 'telegram-client' });
var TELEGRAM_API_BASE = 'https://api.telegram.org';
var DEFAULT_TIMEOUT = 30000;
var MAX_RETRIES = 3;
// Read proxy from environment variable
var HTTP_PROXY = process.env.HTTP_PROXY || null;
// Create proxy agent only for Telegram requests (not global)
var httpProxyAgent = null;
if (HTTP_PROXY) {
    log.info({ proxy: HTTP_PROXY }, 'Telegram client configured with proxy');
    httpProxyAgent = new undici_1.ProxyAgent(HTTP_PROXY);
}
else {
    log.warn('No HTTP proxy configured (HTTP_PROXY not set)');
}
function sleep(ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
}
/**
 * Telegram Bot API Client
 */
var TelegramClient = /** @class */ (function () {
    function TelegramClient(botToken) {
        this.abortController = null;
        this.botToken = botToken;
    }
    /**
     * Make an API request to Telegram
     */
    TelegramClient.prototype.apiRequest = function (method, params) {
        return __awaiter(this, void 0, void 0, function () {
            var url, body, attempt, timer, response, data, statusCode, errorDesc, retryable, error, delay, error_1, delay;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        url = "".concat(TELEGRAM_API_BASE, "/bot").concat(this.botToken, "/").concat(method);
                        body = JSON.stringify(params);
                        attempt = 0;
                        _b.label = 1;
                    case 1:
                        if (!(attempt <= MAX_RETRIES)) return [3 /*break*/, 11];
                        this.abortController = new AbortController();
                        timer = setTimeout(function () { return _this.abortController.abort(); }, DEFAULT_TIMEOUT);
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 7, 9, 10]);
                        log.debug({ method: method, attempt: attempt, params: params }, 'Telegram API request');
                        return [4 /*yield*/, fetch(url, {
                                method: 'POST',
                                headers: {
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json',
                                },
                                body: body,
                                signal: this.abortController.signal,
                                // Only use proxy for Telegram requests (not global)
                                dispatcher: httpProxyAgent,
                            })];
                    case 3:
                        response = _b.sent();
                        return [4 /*yield*/, response.json()];
                    case 4:
                        data = _b.sent();
                        if (!!response.ok) return [3 /*break*/, 6];
                        statusCode = response.status;
                        errorDesc = data.description || '';
                        // Don't retry for "message is not modified" errors - this is expected when
                        // the new keyboard is the same as the current one
                        if (statusCode === 400 && errorDesc.includes('message is not modified')) {
                            log.debug({ method: method, statusCode: statusCode }, 'Message not modified, skipping update');
                            return [2 /*return*/, data];
                        }
                        retryable = statusCode >= 500 || statusCode === 429;
                        if (!retryable || attempt === MAX_RETRIES) {
                            error = data.description || "HTTP ".concat(statusCode);
                            log.error({ method: method, statusCode: statusCode, error: error }, 'Telegram API request failed');
                            throw new Error("Telegram API error: ".concat(error));
                        }
                        delay = 500 * Math.pow(2, attempt);
                        log.info({ method: method, attempt: attempt, delay: delay }, 'Retrying Telegram API request');
                        return [4 /*yield*/, sleep(delay)];
                    case 5:
                        _b.sent();
                        return [3 /*break*/, 10];
                    case 6:
                        log.debug({ method: method, messageId: (_a = data.result) === null || _a === void 0 ? void 0 : _a.message_id }, 'Telegram API request successful');
                        return [2 /*return*/, data];
                    case 7:
                        error_1 = _b.sent();
                        if (attempt >= MAX_RETRIES) {
                            log.error({ method: method, error: error_1 }, 'Telegram API request failed after retries');
                            throw error_1;
                        }
                        delay = 500 * Math.pow(2, attempt);
                        log.info({ method: method, attempt: attempt, delay: delay, error: error_1 instanceof Error ? error_1.message : String(error_1) }, 'Retrying Telegram API request (network error)');
                        return [4 /*yield*/, sleep(delay)];
                    case 8:
                        _b.sent();
                        return [3 /*break*/, 10];
                    case 9:
                        clearTimeout(timer);
                        this.abortController = null;
                        return [7 /*endfinally*/];
                    case 10:
                        attempt++;
                        return [3 /*break*/, 1];
                    case 11: throw new Error('Telegram API request failed');
                }
            });
        });
    };
    /**
     * Send a text message
     * @param chatId - Target chat ID
     * @param text - Message text
     * @param parseMode - Optional parse mode ('Markdown', 'MarkdownV2', or 'HTML')
     */
    TelegramClient.prototype.sendMessage = function (chatId, text, parseMode) {
        return __awaiter(this, void 0, void 0, function () {
            var params;
            return __generator(this, function (_a) {
                params = {
                    chat_id: chatId,
                    text: text,
                };
                if (parseMode) {
                    params.parse_mode = parseMode;
                }
                return [2 /*return*/, this.apiRequest('sendMessage', params)];
            });
        });
    };
    /**
     * Send a message with inline keyboard
     * @param chatId - Target chat ID
     * @param text - Message text
     * @param keyboard - Inline keyboard markup
     * @param parseMode - Optional parse mode
     */
    TelegramClient.prototype.sendMessageWithKeyboard = function (chatId, text, keyboard, parseMode) {
        return __awaiter(this, void 0, void 0, function () {
            var params;
            return __generator(this, function (_a) {
                params = {
                    chat_id: chatId,
                    text: text,
                    reply_markup: keyboard,
                };
                if (parseMode) {
                    params.parse_mode = parseMode;
                }
                return [2 /*return*/, this.apiRequest('sendMessage', params)];
            });
        });
    };
    /**
     * Edit message reply markup (inline keyboard)
     * @param chatId - Chat ID
     * @param messageId - Message ID to edit
     * @param keyboard - New inline keyboard markup (or empty to remove)
     */
    TelegramClient.prototype.editMessageReplyMarkup = function (chatId, messageId, keyboard) {
        return __awaiter(this, void 0, void 0, function () {
            var params;
            return __generator(this, function (_a) {
                params = {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard,
                };
                return [2 /*return*/, this.apiRequest('editMessageReplyMarkup', params)];
            });
        });
    };
    /**
     * Answer callback query (removes loading state)
     * @param queryId - Callback query ID
     * @param text - Optional notification text
     * @param showAlert - Whether to show as alert (true) or toast (false)
     */
    TelegramClient.prototype.answerCallbackQuery = function (queryId, text, showAlert) {
        return __awaiter(this, void 0, void 0, function () {
            var params;
            return __generator(this, function (_a) {
                params = {
                    callback_query_id: queryId,
                };
                if (text !== undefined) {
                    params.text = text;
                }
                if (showAlert !== undefined) {
                    params.show_alert = showAlert;
                }
                return [2 /*return*/, this.apiRequest('answerCallbackQuery', params)];
            });
        });
    };
    /**
     * Get updates (polling)
     * @param offset - Offset for pagination (use highest update_id + 1)
     * @param limit - Limit number of updates (1-100, default 100)
     * @param timeout - Long polling timeout in seconds (0 for short polling)
     */
    TelegramClient.prototype.getUpdates = function (offset_1) {
        return __awaiter(this, arguments, void 0, function (offset, limit, timeout) {
            var params;
            if (limit === void 0) { limit = 100; }
            if (timeout === void 0) { timeout = 30; }
            return __generator(this, function (_a) {
                params = {
                    limit: Math.min(limit, 100),
                    timeout: Math.max(timeout, 0),
                };
                if (offset !== undefined) {
                    params.offset = offset;
                }
                return [2 /*return*/, this.apiRequest('getUpdates', params)];
            });
        });
    };
    /**
     * Test the connection by sending a simple message
     */
    TelegramClient.prototype.testConnection = function (chatId) {
        return __awaiter(this, void 0, void 0, function () {
            var result, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.sendMessage(chatId, '🔔 Telegram 通知连接测试成功！', 'Markdown')];
                    case 1:
                        result = _a.sent();
                        return [2 /*return*/, result.ok];
                    case 2:
                        error_2 = _a.sent();
                        log.error({ error: error_2 }, 'Telegram connection test failed');
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Abort any pending requests
     */
    TelegramClient.prototype.abort = function () {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    };
    return TelegramClient;
}());
exports.TelegramClient = TelegramClient;
