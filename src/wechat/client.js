"use strict";
/**
 * 企业微信 API Client
 *
 * HTTP client for WeChat Work Webhook API.
 * 使用 Node.js 内置 fetch，不使用代理（企业微信不需要代理）。
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
exports.WeChatClient = void 0;
var logger_js_1 = require("../logger.js");
var log = logger_js_1.logger.child({ module: 'wechat-client' });
var DEFAULT_TIMEOUT = 30000;
var MAX_RETRIES = 2;
var MAX_MESSAGE_LENGTH = 4096; // 企业微信 Markdown 消息最大字节数
function sleep(ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
}
/**
 * 计算 UTF-8 字节长度
 */
function getByteLength(str) {
    return new TextEncoder().encode(str).length;
}
/**
 * 在合适的位置截断字符串（避免在单词或 Markdown 标记中间截断）
 * 返回截断后的字符串和实际截断位置
 */
function smartTruncate(str, maxBytes) {
    var encoder = new TextEncoder();
    var totalBytes = getByteLength(str);
    if (totalBytes <= maxBytes) {
        return { truncated: str, remaining: '' };
    }
    // 二分查找找到最大安全截断点
    var low = 0;
    var high = str.length;
    var bestLen = 0;
    while (low <= high) {
        var mid = Math.floor((low + high) / 2);
        var sliced = str.substring(0, mid);
        var bytes = encoder.encode(sliced).length;
        if (bytes <= maxBytes) {
            bestLen = mid;
            low = mid + 1;
        }
        else {
            high = mid - 1;
        }
    }
    // 尝试在换行、标点符号或空格处截断
    var truncateLen = bestLen;
    var slice = str.substring(0, bestLen);
    // 优先在换行处截断
    var lastNewline = slice.lastIndexOf('\n');
    if (lastNewline > bestLen * 0.5) {
        truncateLen = lastNewline + 1;
    }
    else {
        // 其次在句号、感叹号等标点处
        var lastPunc = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'), slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
        if (lastPunc > bestLen * 0.5) {
            truncateLen = lastPunc + 1;
        }
        else {
            // 最后在空格处
            var lastSpace = slice.lastIndexOf(' ');
            if (lastSpace > bestLen * 0.7) {
                truncateLen = lastSpace + 1;
            }
        }
    }
    return {
        truncated: str.substring(0, truncateLen),
        remaining: str.substring(truncateLen)
    };
}
/**
 * 将长消息拆分为多条消息
 * 每条消息都在合适的位置截断，避免破坏 Markdown 格式
 */
function splitMessage(content, maxBytes) {
    var chunks = [];
    var remaining = content;
    // 防止无限循环的计数器
    var loopCount = 0;
    var MAX_LOOPS = content.length; // 最多循环字符数次
    while (remaining.length > 0 && loopCount < MAX_LOOPS) {
        loopCount++;
        var _a = smartTruncate(remaining, maxBytes), truncated = _a.truncated, newRemaining = _a.remaining;
        // 只有当截断部分包含实际内容时才添加到块中
        if (truncated.trim().length > 0) {
            chunks.push(truncated);
        }
        // 如果截断后剩余部分和原来一样，说明无法截断，需要强制截断
        if (newRemaining === remaining) {
            var encoder = new TextEncoder();
            var len = 1;
            while (len < remaining.length && encoder.encode(remaining.substring(0, len + 1)).length <= maxBytes) {
                len++;
            }
            var forceChunk = remaining.substring(0, len);
            if (forceChunk.trim().length > 0) {
                chunks.push(forceChunk);
            }
            remaining = remaining.substring(len);
        }
        else {
            remaining = newRemaining;
        }
    }
    return chunks;
}
/**
 * 企业微信 Webhook Client
 */
var WeChatClient = /** @class */ (function () {
    function WeChatClient(webhookUrl) {
        this.abortController = null;
        this.webhookUrl = webhookUrl;
    }
    /**
     * 发送 HTTP 请求到企业微信
     */
    WeChatClient.prototype.apiRequest = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var attempt, timer, response, data, retryable, delay, error_1, delay;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        attempt = 0;
                        _a.label = 1;
                    case 1:
                        if (!(attempt <= MAX_RETRIES)) return [3 /*break*/, 10];
                        this.abortController = new AbortController();
                        timer = setTimeout(function () { return _this.abortController.abort(); }, DEFAULT_TIMEOUT);
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 6, 8, 9]);
                        log.debug({ attempt: attempt, messageType: message.msgtype }, 'WeChat API request');
                        return [4 /*yield*/, fetch(this.webhookUrl, {
                                method: 'POST',
                                headers: {
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify(message),
                                signal: this.abortController.signal,
                            })];
                    case 3:
                        response = _a.sent();
                        return [4 /*yield*/, response.json()];
                    case 4:
                        data = _a.sent();
                        if (data.errcode === 0) {
                            log.debug('WeChat API request successful');
                            return [2 /*return*/, data];
                        }
                        retryable = attempt < MAX_RETRIES && data.errcode !== 40001;
                        if (!retryable) {
                            log.error({ errcode: data.errcode, errmsg: data.errmsg }, 'WeChat API request failed');
                            throw new Error("WeChat API error: ".concat(data.errmsg, " (errcode: ").concat(data.errcode, ")"));
                        }
                        delay = 500 * Math.pow(2, attempt);
                        log.info({ attempt: attempt, delay: delay, errcode: data.errcode }, 'Retrying WeChat API request');
                        return [4 /*yield*/, sleep(delay)];
                    case 5:
                        _a.sent();
                        return [3 /*break*/, 9];
                    case 6:
                        error_1 = _a.sent();
                        if (attempt >= MAX_RETRIES) {
                            log.error({ error: error_1 }, 'WeChat API request failed after retries');
                            throw error_1;
                        }
                        delay = 500 * Math.pow(2, attempt);
                        log.info({ attempt: attempt, delay: delay, error: error_1 instanceof Error ? error_1.message : String(error_1) }, 'Retrying WeChat API request (network error)');
                        return [4 /*yield*/, sleep(delay)];
                    case 7:
                        _a.sent();
                        return [3 /*break*/, 9];
                    case 8:
                        clearTimeout(timer);
                        this.abortController = null;
                        return [7 /*endfinally*/];
                    case 9:
                        attempt++;
                        return [3 /*break*/, 1];
                    case 10: throw new Error('WeChat API request failed');
                }
            });
        });
    };
    /**
     * 发送单条 Markdown 消息（不自动拆分）
     * @param content - Markdown 格式的内容，最长不超过 4096 个字节
     */
    WeChatClient.prototype.sendSingleMarkdown = function (content) {
        return __awaiter(this, void 0, void 0, function () {
            var message, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        message = {
                            msgtype: 'markdown',
                            markdown: { content: content },
                        };
                        return [4 /*yield*/, this.apiRequest(message)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, true];
                    case 2:
                        error_2 = _a.sent();
                        log.error({ error: error_2 }, 'Failed to send Markdown message');
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * 发送 Markdown 消息（自动拆分超长消息）
     * @param content - Markdown 格式的内容，超长时自动拆分为多条发送
     */
    WeChatClient.prototype.sendMarkdown = function (content) {
        return __awaiter(this, void 0, void 0, function () {
            var byteLength, reservedSpace, initialChunks, allSuccess, i, chunk, marker, markedChunk, markerBytes, maxContentBytes, truncated, finalChunk, success, success;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        byteLength = getByteLength(content);
                        if (!(byteLength <= MAX_MESSAGE_LENGTH)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.sendSingleMarkdown(content)];
                    case 1: return [2 /*return*/, _a.sent()];
                    case 2:
                        log.info({ byteLength: byteLength, maxLength: MAX_MESSAGE_LENGTH }, 'Message too long, splitting into chunks');
                        reservedSpace = 20;
                        initialChunks = splitMessage(content, MAX_MESSAGE_LENGTH - reservedSpace);
                        log.info({ chunkCount: initialChunks.length }, 'Split message into chunks');
                        allSuccess = true;
                        i = 0;
                        _a.label = 3;
                    case 3:
                        if (!(i < initialChunks.length)) return [3 /*break*/, 10];
                        chunk = initialChunks[i];
                        marker = "**[".concat(i + 1, "/").concat(initialChunks.length, "]**\n\n");
                        markedChunk = initialChunks.length > 1
                            ? marker + chunk
                            : chunk;
                        if (!(getByteLength(markedChunk) > MAX_MESSAGE_LENGTH)) return [3 /*break*/, 5];
                        log.warn({ chunkIndex: i + 1, byteLength: getByteLength(markedChunk) }, 'Chunk still too long after adding marker, truncating further');
                        markerBytes = getByteLength(marker);
                        maxContentBytes = MAX_MESSAGE_LENGTH - markerBytes;
                        truncated = smartTruncate(chunk, maxContentBytes).truncated;
                        finalChunk = marker + truncated;
                        return [4 /*yield*/, this.sendSingleMarkdown(finalChunk)];
                    case 4:
                        success = _a.sent();
                        if (!success) {
                            allSuccess = false;
                            log.error({ chunkIndex: i + 1 }, 'Failed to send message chunk');
                        }
                        return [3 /*break*/, 7];
                    case 5: return [4 /*yield*/, this.sendSingleMarkdown(markedChunk)];
                    case 6:
                        success = _a.sent();
                        if (!success) {
                            allSuccess = false;
                            log.error({ chunkIndex: i + 1 }, 'Failed to send message chunk');
                        }
                        _a.label = 7;
                    case 7:
                        if (!(i < initialChunks.length - 1)) return [3 /*break*/, 9];
                        return [4 /*yield*/, sleep(300)];
                    case 8:
                        _a.sent();
                        _a.label = 9;
                    case 9:
                        i++;
                        return [3 /*break*/, 3];
                    case 10: return [2 /*return*/, allSuccess];
                }
            });
        });
    };
    /**
     * 发送文本消息
     * @param content - 文本内容，最长不超过 2048 个字节
     */
    WeChatClient.prototype.sendText = function (content) {
        return __awaiter(this, void 0, void 0, function () {
            var message, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        message = {
                            msgtype: 'text',
                            text: { content: content },
                        };
                        return [4 /*yield*/, this.apiRequest(message)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, true];
                    case 2:
                        error_3 = _a.sent();
                        log.error({ error: error_3 }, 'Failed to send text message');
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * 测试连接
     * 发送一条测试消息验证 webhook 是否有效
     */
    WeChatClient.prototype.testConnection = function () {
        return __awaiter(this, void 0, void 0, function () {
            var success, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.sendText('🔔 企业微信通知连接测试成功！')];
                    case 1:
                        success = _a.sent();
                        if (success) {
                            log.info('WeChat connection test successful');
                        }
                        return [2 /*return*/, success];
                    case 2:
                        error_4 = _a.sent();
                        log.error({ error: error_4 }, 'WeChat connection test failed');
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * 中止待处理的请求
     */
    WeChatClient.prototype.abort = function () {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    };
    return WeChatClient;
}());
exports.WeChatClient = WeChatClient;
