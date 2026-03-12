"use strict";
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
exports.rerank = rerank;
var logger_js_1 = require("../logger.js");
var crypto_js_1 = require("../utils/crypto.js");
var config_js_1 = require("../config.js");
var llm_configs_js_1 = require("../api/llm-configs.js");
var log = logger_js_1.logger.child({ module: 'vector-rerank' });
function rerank(query, documents, userId, topN) {
    return __awaiter(this, void 0, void 0, function () {
        var dbConfig, apiKey, url, body, res, text, data, results, error_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, llm_configs_js_1.getActiveConfigByType)(userId, 'rerank')];
                case 1:
                    dbConfig = _b.sent();
                    if (!dbConfig || dbConfig.enabled !== 1) {
                        return [2 /*return*/, null];
                    }
                    apiKey = (0, crypto_js_1.decryptAPIKey)(dbConfig.api_key_encrypted, config_js_1.config.llmEncryptionKey);
                    url = "".concat(dbConfig.base_url, "/rerank");
                    body = {
                        model: dbConfig.model,
                        query: query,
                        documents: documents,
                        top_n: topN !== null && topN !== void 0 ? topN : documents.length,
                    };
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 7, , 8]);
                    return [4 /*yield*/, fetch(url, {
                            method: 'POST',
                            headers: {
                                'Authorization': "Bearer ".concat(apiKey),
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(body),
                            signal: AbortSignal.timeout((_a = dbConfig.timeout) !== null && _a !== void 0 ? _a : 30000),
                        })];
                case 3:
                    res = _b.sent();
                    if (!!res.ok) return [3 /*break*/, 5];
                    return [4 /*yield*/, res.text().catch(function () { return ''; })];
                case 4:
                    text = _b.sent();
                    log.warn({ status: res.status, text: text }, 'Rerank 请求失败');
                    return [2 /*return*/, null];
                case 5: return [4 /*yield*/, res.json()];
                case 6:
                    data = _b.sent();
                    results = Array.isArray(data === null || data === void 0 ? void 0 : data.results) ? data.results : [];
                    return [2 /*return*/, results
                            .map(function (item) { return ({
                            index: Number(item.index),
                            score: typeof item.relevance_score === 'number'
                                ? item.relevance_score
                                : typeof item.score === 'number'
                                    ? item.score
                                    : 0,
                        }); })
                            .filter(function (item) { return Number.isFinite(item.index); })];
                case 7:
                    error_1 = _b.sent();
                    log.warn({ error: error_1 }, 'Rerank 请求异常');
                    return [2 /*return*/, null];
                case 8: return [2 /*return*/];
            }
        });
    });
}
