"use strict";
/**
 * LLM Call Logger
 *
 * 专门用于记录大模型调用过程中的调试信息，包括：
 * - API Key（脱敏）
 * - 模型名
 * - Base URL
 * - 系统提示词
 * - 用户提示词
 * - 请求参数
 * - 响应结果
 * - 调用耗时
 *
 * ENV:
 *   LLM_LOG_FILE — LLM 日志文件路径
 *   LLM_LOG_RETENTION_DAYS — LLM 日志保留天数 (default: 7)
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMLogger = exports.LLMLoggerSession = void 0;
var pino_1 = require("pino");
var pino_pretty_1 = require("pino-pretty");
var fs_1 = require("fs");
var path_1 = require("path");
var config_js_1 = require("./config.js");
var logger_js_1 = require("./logger.js");
var _cleanupTimer = null;
/** 获取今天的日期字符串 YYYY-MM-DD */
function getDateStr() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return "".concat(year, "-").concat(month, "-").concat(day);
}
/** 清理过期日志文件 */
function cleanupOldLogs(logDir, logBaseName, retentionDays) {
    try {
        var files = fs_1.default.readdirSync(logDir);
        var now = Date.now();
        var maxAge = retentionDays * 24 * 60 * 60 * 1000;
        for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
            var file = files_1[_i];
            if (!file.startsWith(logBaseName))
                continue;
            var filePath = path_1.default.join(logDir, file);
            var stats = fs_1.default.statSync(filePath);
            var age = now - stats.mtimeMs;
            if (age > maxAge) {
                fs_1.default.unlinkSync(filePath);
            }
        }
    }
    catch (_a) {
        // 忽略清理错误
    }
}
/**
 * 创建独立的 LLM 日志记录器（带日期轮转）
 */
function createLLMLogger() {
    var level = process.env.LOG_LEVEL || 'info';
    var llmLogFile = config_js_1.config.llmLogFile;
    var retentionDays = parseInt(process.env.LLM_LOG_RETENTION_DAYS || '7', 10);
    // Pretty stream for stdout
    var prettyStream = (0, pino_pretty_1.default)({ colorize: true });
    if (!llmLogFile) {
        // 如果没有设置 LLM_LOG_FILE，使用主 logger 的 child
        return logger_js_1.logger.child({ module: 'llm-call' });
    }
    // 创建独立的 LLM 日志文件，带日期后缀
    var absPath = path_1.default.resolve(llmLogFile);
    var logDir = path_1.default.dirname(absPath);
    var logName = path_1.default.basename(absPath);
    var ext = path_1.default.extname(logName);
    var baseName = path_1.default.basename(logName, ext);
    fs_1.default.mkdirSync(logDir, { recursive: true });
    var dateStr = getDateStr();
    var rotatedPath = path_1.default.join(logDir, "".concat(baseName, ".").concat(dateStr).concat(ext));
    var fileStream = fs_1.default.createWriteStream(rotatedPath, { flags: 'a' });
    // 每天凌晨清理过期日志
    if (_cleanupTimer)
        clearInterval(_cleanupTimer);
    _cleanupTimer = setInterval(function () {
        cleanupOldLogs(logDir, "".concat(baseName, "."), retentionDays);
    }, 60 * 60 * 1000); // 每小时检查一次
    var multistream = pino_1.default.multistream([
        { level: level, stream: prettyStream },
        { level: level, stream: fileStream },
    ]);
    return (0, pino_1.default)({ level: level }, multistream);
}
var llmLog = createLLMLogger();
var llmCallCounter = 0;
/**
 * 脱敏 API Key，只显示前 4 位和后 4 位
 */
function maskApiKey(apiKey) {
    if (!apiKey || apiKey.length <= 8) {
        return '***';
    }
    return "".concat(apiKey.slice(0, 4), "...").concat(apiKey.slice(-4));
}
/**
 * 脱敏 Base URL 中的敏感信息
 */
function maskBaseUrl(baseUrl) {
    // 如果 URL 中包含 api key，进行脱敏
    try {
        var url = new URL(baseUrl);
        if (url.searchParams.has('key')) {
            var key = url.searchParams.get('key');
            url.searchParams.set('key', maskApiKey(key));
        }
        return url.toString();
    }
    catch (_a) {
        return baseUrl;
    }
}
/**
 * 截断过长的文本，避免日志过大
 */
function truncateText(text, maxLength) {
    if (maxLength === void 0) { maxLength = 500; }
    if (!text)
        return '';
    if (text.length <= maxLength)
        return text;
    return "".concat(text.slice(0, maxLength), "... (truncated, total: ").concat(text.length, " chars)");
}
/**
 * 是否记录完整提示词（支持采样）
 */
function shouldLogFullPrompt() {
    if (config_js_1.config.llmLogFullPrompt) {
        return { enabled: true, sampleRate: 1 };
    }
    var rawRate = config_js_1.config.llmLogFullSampleRate;
    var sampleRate = Number.isFinite(rawRate) && rawRate > 0 ? Math.floor(rawRate) : 20;
    if (sampleRate <= 1) {
        return { enabled: true, sampleRate: 1 };
    }
    var count = ++llmCallCounter;
    return { enabled: count % sampleRate === 0, sampleRate: sampleRate };
}
/**
 * 提取系统提示词
 */
function extractSystemPrompt(messages) {
    var systemMsg = messages.find(function (m) { return m.role === 'system'; });
    return (systemMsg === null || systemMsg === void 0 ? void 0 : systemMsg.content) || '';
}
/**
 * 提取用户提示词
 */
function extractUserPrompt(messages) {
    var userMessages = messages.filter(function (m) { return m.role === 'user'; });
    return userMessages.map(function (m) { return m.content; }).join('\n\n');
}
/**
 * 大模型调用日志会话
 *
 * 使用方式：
 * ```typescript
 * const session = LLMLogger.start({ provider: 'openai', model: 'gpt-4', apiKey: 'sk-...', baseUrl: 'https://...', label: 'filter' });
 * session.logRequest({ messages: [...], temperature: 0.7 });
 * // ... 执行调用 ...
 * session.logResponse({ success: true, response: '...', elapsedMs: 1234 });
 * ```
 */
var LLMLoggerSession = /** @class */ (function () {
    function LLMLoggerSession(context) {
        this.startTime = Date.now();
        this.context = context;
    }
    /**
     * 记录请求开始
     */
    LLMLoggerSession.prototype.logRequest = function (params) {
        var systemPrompt = extractSystemPrompt(params.messages);
        var userPrompt = extractUserPrompt(params.messages);
        var fullPromptState = shouldLogFullPrompt();
        var systemPromptLogged = fullPromptState.enabled ? systemPrompt : truncateText(systemPrompt);
        var userPromptLogged = fullPromptState.enabled ? userPrompt : truncateText(userPrompt);
        llmLog.debug(__assign({ provider: this.context.provider, model: this.context.model, apiKey: maskApiKey(this.context.apiKey), baseUrl: maskBaseUrl(this.context.baseUrl), apiKeySource: this.context.apiKeySource, baseUrlSource: this.context.baseUrlSource, modelSource: this.context.modelSource, label: this.context.label, userId: this.context.userId, configId: this.context.configId, systemPrompt: systemPromptLogged, userPrompt: userPromptLogged, systemPromptSource: params.systemPromptSource || 'messages', userPromptSource: params.userPromptSource || 'messages', fullPromptLogged: fullPromptState.enabled, fullPromptSampleRate: fullPromptState.sampleRate, messages: params.messages.map(function (m) { return ({ role: m.role, contentLength: m.content.length }); }), temperature: params.temperature, maxTokens: params.maxTokens, jsonMode: params.jsonMode }, this.extractExtraParams(params)), "\u2192 LLM Request: ".concat(this.context.label || this.context.model));
    };
    /**
     * 记录响应结果
     */
    LLMLoggerSession.prototype.logResponse = function (result) {
        var _a, _b;
        var elapsed = Date.now() - this.startTime;
        if (result.success) {
            llmLog.info({
                provider: this.context.provider,
                model: this.context.model,
                label: this.context.label,
                userId: this.context.userId,
                configId: this.context.configId,
                responseLength: result.responseLength || ((_a = result.response) === null || _a === void 0 ? void 0 : _a.length) || 0,
                elapsed: "".concat(elapsed, "ms"),
                responsePreview: result.response ? truncateText(result.response, 200) : undefined,
            }, "\u2190 LLM Response: ".concat(this.context.label || this.context.model, " done"));
        }
        else {
            llmLog.error({
                provider: this.context.provider,
                model: this.context.model,
                label: this.context.label,
                userId: this.context.userId,
                configId: this.context.configId,
                error: ((_b = result.error) === null || _b === void 0 ? void 0 : _b.message) || 'Unknown error',
                elapsed: "".concat(elapsed, "ms"),
            }, "\u2717 LLM Error: ".concat(this.context.label || this.context.model));
        }
    };
    /**
     * 提取额外参数（排除已知的标准参数）
     */
    LLMLoggerSession.prototype.extractExtraParams = function (params) {
        var messages = params.messages, temperature = params.temperature, maxTokens = params.maxTokens, jsonMode = params.jsonMode, extra = __rest(params, ["messages", "temperature", "maxTokens", "jsonMode"]);
        return extra;
    };
    return LLMLoggerSession;
}());
exports.LLMLoggerSession = LLMLoggerSession;
/**
 * 大模型调用日志记录器
 */
var LLMLogger = /** @class */ (function () {
    function LLMLogger() {
    }
    /**
     * 开始一个新的日志会话
     */
    LLMLogger.start = function (context) {
        return new LLMLoggerSession(context);
    };
    /**
     * 快捷方式：一次性记录调用
     */
    LLMLogger.log = function (context, params, fn) {
        return __awaiter(this, void 0, void 0, function () {
            var session, result, responseText, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        session = this.start(context);
                        session.logRequest(params);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, fn()];
                    case 2:
                        result = _a.sent();
                        responseText = typeof result === 'string' ? result : JSON.stringify(result);
                        session.logResponse({
                            success: true,
                            response: responseText,
                            responseLength: responseText.length,
                            elapsedMs: 0, // 会在 logResponse 中重新计算
                        });
                        return [2 /*return*/, result];
                    case 3:
                        error_1 = _a.sent();
                        session.logResponse({
                            success: false,
                            error: error_1 instanceof Error ? error_1 : new Error('Unknown error'),
                            elapsedMs: 0,
                        });
                        throw error_1;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * 记录速率限制统计信息
     * 用于监控和调试速率限制器的状态
     */
    LLMLogger.logRateLimitStats = function (stats) {
        llmLog.info({
            availableTokens: stats.availableTokens,
            queueLength: stats.queueLength,
            totalRequests: stats.totalRequests,
            rejectedRequests: stats.rejectedRequests,
            avgWaitTimeMs: stats.avgWaitTimeMs,
        }, 'Rate Limiter Stats');
    };
    return LLMLogger;
}());
exports.LLMLogger = LLMLogger;
