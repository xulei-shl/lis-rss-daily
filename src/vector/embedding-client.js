"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
exports.EmbeddingConfigError = void 0;
exports.getEmbedding = getEmbedding;
exports.getEmbeddingsBatch = getEmbeddingsBatch;
var logger_js_1 = require("../logger.js");
var crypto_js_1 = require("../utils/crypto.js");
var config_js_1 = require("../config.js");
var llm_configs_js_1 = require("../api/llm-configs.js");
var log = logger_js_1.logger.child({ module: 'vector-embedding' });
/**
 * Embedding 配置错误
 * 提供清晰的配置缺失提示
 */
var EmbeddingConfigError = /** @class */ (function (_super) {
    __extends(EmbeddingConfigError, _super);
    function EmbeddingConfigError(missingType) {
        var _this = this;
        var messages = {
            embedding: '缺少 Embedding 配置。请在"LLM 配置"中添加一个 config_type 为 "embedding" 的配置。',
            chroma: 'Chroma 服务不可用。请检查 Chroma 服务是否运行，或在"设置"中配置正确的 host 和 port。',
        };
        _this = _super.call(this, messages[missingType]) || this;
        _this.name = 'EmbeddingConfigError';
        return _this;
    }
    return EmbeddingConfigError;
}(Error));
exports.EmbeddingConfigError = EmbeddingConfigError;
function loadEmbeddingConfig(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var dbConfig;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, (0, llm_configs_js_1.getActiveConfigByType)(userId, 'embedding')];
                case 1:
                    dbConfig = _c.sent();
                    if (!dbConfig) {
                        throw new EmbeddingConfigError('embedding');
                    }
                    return [2 /*return*/, {
                            baseUrl: dbConfig.base_url,
                            apiKey: (0, crypto_js_1.decryptAPIKey)(dbConfig.api_key_encrypted, config_js_1.config.llmEncryptionKey),
                            model: dbConfig.model,
                            timeout: (_a = dbConfig.timeout) !== null && _a !== void 0 ? _a : 30000,
                            maxRetries: (_b = dbConfig.max_retries) !== null && _b !== void 0 ? _b : 3,
                        }];
            }
        });
    });
}
function sleep(ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
}
function requestEmbeddings(cfg, inputs) {
    return __awaiter(this, void 0, void 0, function () {
        var url, body, _loop_1, attempt, state_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    url = "".concat(cfg.baseUrl, "/embeddings");
                    body = {
                        model: cfg.model,
                        input: inputs,
                    };
                    _loop_1 = function (attempt) {
                        var controller, timer, res, text, retryable, data, vectors, error_1;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0:
                                    controller = new AbortController();
                                    timer = setTimeout(function () { return controller.abort(); }, cfg.timeout);
                                    _b.label = 1;
                                case 1:
                                    _b.trys.push([1, 7, 9, 10]);
                                    return [4 /*yield*/, fetch(url, {
                                            method: 'POST',
                                            headers: {
                                                'Authorization': "Bearer ".concat(cfg.apiKey),
                                                'Content-Type': 'application/json',
                                            },
                                            body: JSON.stringify(body),
                                            signal: controller.signal,
                                        })];
                                case 2:
                                    res = _b.sent();
                                    if (!!res.ok) return [3 /*break*/, 5];
                                    return [4 /*yield*/, res.text().catch(function () { return ''; })];
                                case 3:
                                    text = _b.sent();
                                    retryable = res.status >= 500 || res.status === 429;
                                    if (!retryable || attempt === cfg.maxRetries) {
                                        throw new Error("Embedding \u8BF7\u6C42\u5931\u8D25: HTTP ".concat(res.status, " ").concat(text));
                                    }
                                    return [4 /*yield*/, sleep(500 * (attempt + 1))];
                                case 4:
                                    _b.sent();
                                    return [2 /*return*/, "continue"];
                                case 5: return [4 /*yield*/, res.json()];
                                case 6:
                                    data = _b.sent();
                                    vectors = Array.isArray(data === null || data === void 0 ? void 0 : data.data)
                                        ? data.data.map(function (item) { return item.embedding; }).filter(function (v) { return Array.isArray(v); })
                                        : [];
                                    if (vectors.length !== inputs.length) {
                                        throw new Error('Embedding 返回数量不匹配');
                                    }
                                    return [2 /*return*/, { value: vectors }];
                                case 7:
                                    error_1 = _b.sent();
                                    if (attempt >= cfg.maxRetries) {
                                        throw error_1;
                                    }
                                    return [4 /*yield*/, sleep(500 * (attempt + 1))];
                                case 8:
                                    _b.sent();
                                    return [3 /*break*/, 10];
                                case 9:
                                    clearTimeout(timer);
                                    return [7 /*endfinally*/];
                                case 10: return [2 /*return*/];
                            }
                        });
                    };
                    attempt = 0;
                    _a.label = 1;
                case 1:
                    if (!(attempt <= cfg.maxRetries)) return [3 /*break*/, 4];
                    return [5 /*yield**/, _loop_1(attempt)];
                case 2:
                    state_1 = _a.sent();
                    if (typeof state_1 === "object")
                        return [2 /*return*/, state_1.value];
                    _a.label = 3;
                case 3:
                    attempt++;
                    return [3 /*break*/, 1];
                case 4: throw new Error('Embedding 请求失败');
            }
        });
    });
}
function getEmbedding(text, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var cfg, vectors;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, loadEmbeddingConfig(userId)];
                case 1:
                    cfg = _a.sent();
                    return [4 /*yield*/, requestEmbeddings(cfg, [text])];
                case 2:
                    vectors = _a.sent();
                    return [2 /*return*/, vectors[0] || []];
            }
        });
    });
}
function getEmbeddingsBatch(texts, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var cfg, vectors;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, loadEmbeddingConfig(userId)];
                case 1:
                    cfg = _a.sent();
                    if (texts.length === 0)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, requestEmbeddings(cfg, texts)];
                case 2:
                    vectors = _a.sent();
                    log.debug({ count: vectors.length }, 'Embedding batch done');
                    return [2 /*return*/, vectors];
            }
        });
    });
}
