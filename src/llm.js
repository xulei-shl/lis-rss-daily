"use strict";
/**
 * LLM abstraction layer.
 *
 * Provides a unified interface for chat completions across providers.
 * Supports both environment variable configuration and database-stored user configs.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLLM = getLLM;
exports.getUserLLMProvider = getUserLLMProvider;
exports.createLLMProvider = createLLMProvider;
var openai_1 = require("openai");
var logger_js_1 = require("./logger.js");
var llm_configs_js_1 = require("./api/llm-configs.js");
var crypto_js_1 = require("./utils/crypto.js");
var config_js_1 = require("./config.js");
var llm_logger_js_1 = require("./llm-logger.js");
var rate_limiter_js_1 = require("./utils/rate-limiter.js");
var log = logger_js_1.logger.child({ module: 'llm' });
/* ── Rate Limiter Integration ── */
/**
 * Initialize the global rate limiter if enabled
 */
function ensureRateLimiterInitialized() {
    if (!(0, rate_limiter_js_1.getGlobalRateLimiter)() && config_js_1.config.llmRateLimitEnabled) {
        var rateLimiterConfig = {
            requestsPerMinute: config_js_1.config.llmRateLimitRequestsPerMinute,
            burstCapacity: config_js_1.config.llmRateLimitBurstCapacity,
            queueTimeout: config_js_1.config.llmRateLimitQueueTimeout,
        };
        (0, rate_limiter_js_1.initGlobalRateLimiter)(rateLimiterConfig);
    }
}
/**
 * Wrap an LLMProvider with rate limiting
 * If rate limiting is disabled, returns the original provider
 */
function withRateLimit(provider) {
    if (!config_js_1.config.llmRateLimitEnabled) {
        return provider;
    }
    ensureRateLimiterInitialized();
    var rateLimiter = (0, rate_limiter_js_1.getGlobalRateLimiter)();
    return {
        name: "".concat(provider.name, " (rate-limited)"),
        chat: function (messages_1) {
            return __awaiter(this, arguments, void 0, function (messages, options) {
                var label, error_1;
                if (options === void 0) { options = {}; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            label = options.label || 'chat';
                            if (!rateLimiter) {
                                // Rate limiter not available, proceed without limiting
                                return [2 /*return*/, provider.chat(messages, options)];
                            }
                            _a.label = 1;
                        case 1:
                            _a.trys.push([1, 3, , 4]);
                            return [4 /*yield*/, rateLimiter.waitForToken(label)];
                        case 2:
                            _a.sent();
                            return [3 /*break*/, 4];
                        case 3:
                            error_1 = _a.sent();
                            // Queue timeout - still allow the request to proceed
                            // This is better than failing the request
                            log.warn({ label: label, provider: provider.name }, 'Rate limit queue timeout, proceeding anyway');
                            return [3 /*break*/, 4];
                        case 4: 
                        // Proceed with actual LLM call
                        return [2 /*return*/, provider.chat(messages, options)];
                    }
                });
            });
        },
    };
}
/* ── Provider: OpenAI-compatible (Qwen via dashscope, etc.) ── */
function createOpenAIProvider(llmConfig, configId) {
    var _a, _b, _c;
    var client = new openai_1.default({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
        timeout: (_a = llmConfig.timeout) !== null && _a !== void 0 ? _a : 30000,
        maxRetries: (_b = llmConfig.maxRetries) !== null && _b !== void 0 ? _b : 3,
    });
    var model = llmConfig.model;
    var source = (_c = llmConfig.source) !== null && _c !== void 0 ? _c : 'unknown';
    var provider = {
        name: "openai/".concat(model),
        chat: function (messages_1) {
            return __awaiter(this, arguments, void 0, function (messages, options) {
                var label, callContext, session, requestConfig, response, text, error_2;
                var _a, _b;
                if (options === void 0) { options = {}; }
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            label = options.label || 'chat';
                            callContext = {
                                provider: 'openai',
                                model: model,
                                apiKey: llmConfig.apiKey,
                                baseUrl: llmConfig.baseURL,
                                apiKeySource: source,
                                baseUrlSource: source,
                                modelSource: source,
                                label: label,
                                configId: configId,
                            };
                            session = llm_logger_js_1.LLMLogger.start(callContext);
                            session.logRequest({
                                messages: messages,
                                temperature: options.temperature,
                                maxTokens: options.maxTokens,
                                jsonMode: options.jsonMode,
                            });
                            _c.label = 1;
                        case 1:
                            _c.trys.push([1, 3, , 4]);
                            requestConfig = __assign({ model: model, temperature: options.temperature, messages: messages.map(function (m) { return ({ role: m.role, content: m.content }); }) }, (options.jsonMode ? { response_format: { type: 'json_object' } } : {}));
                            // 只有明确指定 maxTokens 时才添加限制
                            if (options.maxTokens !== undefined) {
                                requestConfig.max_tokens = options.maxTokens;
                            }
                            return [4 /*yield*/, client.chat.completions.create(requestConfig)];
                        case 2:
                            response = _c.sent();
                            text = ((_b = (_a = response.choices[0]) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.content) || '';
                            session.logResponse({
                                success: true,
                                response: text,
                                responseLength: text.length,
                                elapsedMs: 0,
                            });
                            return [2 /*return*/, text];
                        case 3:
                            error_2 = _c.sent();
                            session.logResponse({
                                success: false,
                                error: error_2 instanceof Error ? error_2 : new Error('Unknown error'),
                                elapsedMs: 0,
                            });
                            throw error_2;
                        case 4: return [2 /*return*/];
                    }
                });
            });
        },
    };
    return withRateLimit(provider);
}
/* ── Provider: Gemini (direct REST API) ── */
var GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
function createGeminiProvider(llmConfig, configId) {
    var _a;
    var apiKey = llmConfig.apiKey;
    var model = llmConfig.model;
    var baseURL = llmConfig.baseURL;
    var source = (_a = llmConfig.source) !== null && _a !== void 0 ? _a : 'unknown';
    var provider = {
        name: "gemini/".concat(model),
        chat: function (messages_1) {
            return __awaiter(this, arguments, void 0, function (messages, options) {
                var label, callContext, session, systemParts, contents, _i, messages_2, msg, generationConfig, body, apiUrl, url, res, err, data, text, error_3;
                var _a, _b, _c, _d, _e, _f;
                if (options === void 0) { options = {}; }
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            label = options.label || 'chat';
                            callContext = {
                                provider: 'gemini',
                                model: model,
                                apiKey: apiKey,
                                baseUrl: baseURL || GEMINI_API_BASE,
                                apiKeySource: source,
                                baseUrlSource: source,
                                modelSource: source,
                                label: label,
                                configId: configId,
                            };
                            session = llm_logger_js_1.LLMLogger.start(callContext);
                            session.logRequest({
                                messages: messages,
                                temperature: options.temperature,
                                maxTokens: options.maxTokens,
                                jsonMode: options.jsonMode,
                            });
                            _g.label = 1;
                        case 1:
                            _g.trys.push([1, 6, , 7]);
                            systemParts = [];
                            contents = [];
                            for (_i = 0, messages_2 = messages; _i < messages_2.length; _i++) {
                                msg = messages_2[_i];
                                if (msg.role === 'system') {
                                    systemParts.push(msg.content);
                                }
                                else {
                                    contents.push({
                                        role: msg.role === 'assistant' ? 'model' : 'user',
                                        parts: [{ text: msg.content }],
                                    });
                                }
                            }
                            generationConfig = __assign({ temperature: (_a = options.temperature) !== null && _a !== void 0 ? _a : 0.3 }, (options.jsonMode ? { responseMimeType: 'application/json' } : {}));
                            // 只有明确指定 maxTokens 时才添加限制
                            if (options.maxTokens !== undefined) {
                                generationConfig.maxOutputTokens = options.maxTokens;
                            }
                            body = {
                                contents: contents,
                                generationConfig: generationConfig,
                            };
                            if (systemParts.length > 0) {
                                body.systemInstruction = {
                                    parts: systemParts.map(function (text) { return ({ text: text }); }),
                                };
                            }
                            apiUrl = baseURL || GEMINI_API_BASE;
                            url = "".concat(apiUrl, "/models/").concat(model, ":generateContent?key=").concat(apiKey);
                            return [4 /*yield*/, fetch(url, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(body),
                                })];
                        case 2:
                            res = _g.sent();
                            if (!!res.ok) return [3 /*break*/, 4];
                            return [4 /*yield*/, res.text()];
                        case 3:
                            err = _g.sent();
                            throw new Error("Gemini ".concat(label, " error (").concat(res.status, "): ").concat(err));
                        case 4: return [4 /*yield*/, res.json()];
                        case 5:
                            data = _g.sent();
                            text = ((_f = (_e = (_d = (_c = (_b = data === null || data === void 0 ? void 0 : data.candidates) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.parts) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.text) || '';
                            if (!text) {
                                throw new Error("Gemini ".concat(label, ": empty response"));
                            }
                            session.logResponse({
                                success: true,
                                response: text,
                                responseLength: text.length,
                                elapsedMs: 0,
                            });
                            return [2 /*return*/, text];
                        case 6:
                            error_3 = _g.sent();
                            session.logResponse({
                                success: false,
                                error: error_3 instanceof Error ? error_3 : new Error('Unknown error'),
                                elapsedMs: 0,
                            });
                            throw error_3;
                        case 7: return [2 /*return*/];
                    }
                });
            });
        },
    };
    return withRateLimit(provider);
}
/* ── Provider from environment variables (fallback) ── */
function createProviderFromEnv() {
    var _a, _b, _c;
    var providerName = (_a = process.env.LLM_PROVIDER) !== null && _a !== void 0 ? _a : 'openai';
    switch (providerName) {
        case 'gemini':
            return createGeminiProvider({
                provider: 'gemini',
                apiKey: process.env.GEMINI_API_KEY || '',
                baseURL: GEMINI_API_BASE,
                model: (_b = process.env.GEMINI_MODEL) !== null && _b !== void 0 ? _b : 'gemini-2.0-flash',
                source: 'env',
            });
        case 'openai':
        default:
            return createOpenAIProvider({
                provider: 'openai',
                apiKey: process.env.OPENAI_API_KEY || '',
                baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
                model: (_c = process.env.OPENAI_DEFAULT_MODEL) !== null && _c !== void 0 ? _c : 'gpt-4o-mini',
                source: 'env',
            });
    }
}
/* ── Factory functions ── */
/**
 * Get LLM provider from environment variables (fallback)
 * This is used when no user context is available or config is not found
 */
var _envProvider = null;
function getLLM() {
    if (_envProvider)
        return _envProvider;
    _envProvider = createProviderFromEnv();
    log.info({ provider: _envProvider.name }, 'LLM provider initialized from environment');
    return _envProvider;
}
/**
 * Get LLM provider for a specific user from database configuration
 * Throws error if no config is found (no fallback to environment variables)
 *
 * @param userId - User ID to get LLM config for
 * @param taskType - Optional task type (filter, translation, daily_summary, etc.)
 * @returns LLM provider instance
 * @throws Error if no LLM config found for user
 */
function getUserLLMProvider(userId, taskType) {
    return __awaiter(this, void 0, void 0, function () {
        var dbConfigs, _a, entries, _i, dbConfigs_1, dbConfig, provider, failoverProvider;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!taskType) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, llm_configs_js_1.getActiveConfigListByTypeAndTask)(userId, 'llm', taskType)];
                case 1:
                    _a = _b.sent();
                    return [3 /*break*/, 4];
                case 2: return [4 /*yield*/, (0, llm_configs_js_1.getActiveConfigListByType)(userId, 'llm')];
                case 3:
                    _a = _b.sent();
                    _b.label = 4;
                case 4:
                    dbConfigs = _a;
                    if (!dbConfigs || dbConfigs.length === 0) {
                        throw new Error("\u672A\u627E\u5230\u7528\u6237 ".concat(userId).concat(taskType ? " \u7684 ".concat(taskType, " \u4EFB\u52A1\u7C7B\u578B") : '', " \u7684 LLM \u914D\u7F6E\u3002") +
                            "\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u6DFB\u52A0\u5E76\u542F\u7528\u81F3\u5C11\u4E00\u4E2A LLM \u914D\u7F6E\u3002");
                    }
                    entries = [];
                    for (_i = 0, dbConfigs_1 = dbConfigs; _i < dbConfigs_1.length; _i++) {
                        dbConfig = dbConfigs_1[_i];
                        provider = buildProviderFromDbConfig(dbConfig);
                        if (provider) {
                            entries.push({ configId: dbConfig.id, provider: provider });
                        }
                    }
                    if (entries.length === 0) {
                        throw new Error("\u7528\u6237 ".concat(userId).concat(taskType ? " \u7684 ".concat(taskType, " \u4EFB\u52A1\u7C7B\u578B") : '', " \u7684\u6240\u6709 LLM \u914D\u7F6E\u5747\u65E0\u6548\u3002") +
                            "\u8BF7\u68C0\u67E5\u914D\u7F6E\u662F\u5426\u6B63\u786E\u3002");
                    }
                    if (entries.length === 1) {
                        log.info({ userId: userId, taskType: taskType, provider: entries[0].provider.name }, 'LLM provider initialized from database');
                        return [2 /*return*/, entries[0].provider];
                    }
                    failoverProvider = createFailoverProvider(entries);
                    log.info({ userId: userId, taskType: taskType, provider: failoverProvider.name, count: entries.length }, 'LLM provider initialized with failover');
                    return [2 /*return*/, failoverProvider];
            }
        });
    });
}
/**
 * Create LLM provider from explicit config options
 * Useful for testing or temporary providers
 *
 * @param llmConfig - LLM configuration options
 * @param configId - Optional config ID for logging
 * @returns LLM provider instance
 */
function createLLMProvider(llmConfig, configId) {
    var _a;
    var normalizedConfig = __assign(__assign({}, llmConfig), { source: (_a = llmConfig.source) !== null && _a !== void 0 ? _a : 'explicit' });
    switch (llmConfig.provider) {
        case 'gemini':
            return createGeminiProvider(normalizedConfig, configId);
        case 'openai':
        case 'custom':
        default:
            return createOpenAIProvider(normalizedConfig, configId);
    }
}
function buildProviderFromDbConfig(dbConfig) {
    try {
        var llmConfig = {
            provider: dbConfig.provider,
            baseURL: dbConfig.base_url,
            apiKey: (0, crypto_js_1.decryptAPIKey)(dbConfig.api_key_encrypted, config_js_1.config.llmEncryptionKey),
            model: dbConfig.model,
            timeout: dbConfig.timeout,
            maxRetries: dbConfig.max_retries,
            source: 'db',
        };
        return createLLMProvider(llmConfig, dbConfig.id);
    }
    catch (error) {
        log.warn({ error: error, configId: dbConfig.id }, 'Failed to build LLM provider from config');
        return null;
    }
}
function createFailoverProvider(entries) {
    var names = entries.map(function (entry) { return entry.provider.name; }).join(' -> ');
    var provider = {
        name: "failover(".concat(names, ")"),
        chat: function (messages_1) {
            return __awaiter(this, arguments, void 0, function (messages, options) {
                var lastError, _i, entries_1, entry, text, emptyError, error_4;
                if (options === void 0) { options = {}; }
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            lastError = null;
                            _i = 0, entries_1 = entries;
                            _a.label = 1;
                        case 1:
                            if (!(_i < entries_1.length)) return [3 /*break*/, 6];
                            entry = entries_1[_i];
                            _a.label = 2;
                        case 2:
                            _a.trys.push([2, 4, , 5]);
                            return [4 /*yield*/, entry.provider.chat(messages, options)];
                        case 3:
                            text = _a.sent();
                            if (text && text.trim().length > 0) {
                                return [2 /*return*/, text];
                            }
                            emptyError = new Error('空响应');
                            lastError = emptyError;
                            log.warn({ configId: entry.configId, provider: entry.provider.name, label: options.label }, 'LLM 空响应，尝试下一个配置');
                            return [3 /*break*/, 5];
                        case 4:
                            error_4 = _a.sent();
                            lastError = error_4 instanceof Error ? error_4 : new Error('未知错误');
                            log.warn({ error: lastError, configId: entry.configId, provider: entry.provider.name, label: options.label }, 'LLM 调用失败，尝试下一个配置');
                            return [3 /*break*/, 5];
                        case 5:
                            _i++;
                            return [3 /*break*/, 1];
                        case 6: throw lastError !== null && lastError !== void 0 ? lastError : new Error('全部 LLM 配置均失败');
                    }
                });
            });
        },
    };
    return withRateLimit(provider);
}
