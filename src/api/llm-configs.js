"use strict";
/**
 * LLM Configs Service
 *
 * Database operations for LLM configuration management.
 * Supports multiple LLM configurations per user with encryption for API keys.
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
exports.getUserLLMConfigs = getUserLLMConfigs;
exports.getLLMConfigById = getLLMConfigById;
exports.getSafeLLMConfigById = getSafeLLMConfigById;
exports.getDefaultLLMConfig = getDefaultLLMConfig;
exports.getDefaultConfigByType = getDefaultConfigByType;
exports.createLLMConfig = createLLMConfig;
exports.updateLLMConfig = updateLLMConfig;
exports.deleteLLMConfig = deleteLLMConfig;
exports.setDefaultLLMConfig = setDefaultLLMConfig;
exports.getDecryptedAPIKey = getDecryptedAPIKey;
exports.testLLMConnection = testLLMConnection;
exports.getActiveLLMConfig = getActiveLLMConfig;
exports.getActiveConfigByType = getActiveConfigByType;
exports.getActiveConfigListByType = getActiveConfigListByType;
exports.getActiveConfigByTypeAndTask = getActiveConfigByTypeAndTask;
exports.getActiveConfigListByTypeAndTask = getActiveConfigListByTypeAndTask;
var db_js_1 = require("../db.js");
var logger_js_1 = require("../logger.js");
var crypto_js_1 = require("../utils/crypto.js");
var config_js_1 = require("../config.js");
var log = logger_js_1.logger.child({ module: 'llm-configs-service' });
/**
 * Convert database record to safe record (without API key)
 */
function toSafeRecord(record) {
    var api_key_encrypted = record.api_key_encrypted, rest = __rest(record, ["api_key_encrypted"]);
    return __assign(__assign({}, rest), { has_api_key: !!api_key_encrypted });
}
/**
 * Get user's LLM configurations (paginated)
 */
function getUserLLMConfigs(userId_1) {
    return __awaiter(this, arguments, void 0, function (userId, options) {
        var db, page, limit, offset, query, totalCountResult, total, configs;
        var _a, _b, _c;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    page = (_a = options.page) !== null && _a !== void 0 ? _a : 1;
                    limit = (_b = options.limit) !== null && _b !== void 0 ? _b : 20;
                    offset = (page - 1) * limit;
                    query = db
                        .selectFrom('llm_configs')
                        .where('user_id', '=', userId);
                    if (options.provider) {
                        query = query.where('provider', '=', options.provider);
                    }
                    if (options.configType) {
                        query = query.where('config_type', '=', options.configType);
                    }
                    if (options.taskType) {
                        query = query.where('task_type', '=', options.taskType);
                    }
                    return [4 /*yield*/, query
                            .select(function (eb) { return eb.fn.count('id').as('count'); })
                            .executeTakeFirst()];
                case 1:
                    totalCountResult = _d.sent();
                    total = Number((_c = totalCountResult === null || totalCountResult === void 0 ? void 0 : totalCountResult.count) !== null && _c !== void 0 ? _c : 0);
                    return [4 /*yield*/, query
                            .selectAll()
                            .orderBy('is_default', 'desc')
                            .orderBy('priority', 'asc')
                            .orderBy('created_at', 'asc')
                            .limit(limit)
                            .offset(offset)
                            .execute()];
                case 2:
                    configs = _d.sent();
                    return [2 /*return*/, {
                            configs: configs.map(toSafeRecord),
                            total: total,
                            page: page,
                            limit: limit,
                            totalPages: Math.ceil(total / limit),
                        }];
            }
        });
    });
}
/**
 * Get LLM config by ID
 */
function getLLMConfigById(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, config;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('llm_configs')
                            .where('id', '=', id)
                            .where('user_id', '=', userId)
                            .selectAll()
                            .executeTakeFirst()];
                case 1:
                    config = _a.sent();
                    return [2 /*return*/, config];
            }
        });
    });
}
/**
 * Get safe LLM config by ID (without API key)
 */
function getSafeLLMConfigById(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var config;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getLLMConfigById(id, userId)];
                case 1:
                    config = _a.sent();
                    return [2 /*return*/, config ? toSafeRecord(config) : undefined];
            }
        });
    });
}
/**
 * Get default LLM config for a user
 */
function getDefaultLLMConfig(userId) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, getDefaultConfigByType(userId, 'llm')];
        });
    });
}
/**
 * 获取指定类型的默认配置
 */
function getDefaultConfigByType(userId, configType) {
    return __awaiter(this, void 0, void 0, function () {
        var db, config;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('llm_configs')
                            .where('user_id', '=', userId)
                            .where('config_type', '=', configType)
                            .where('is_default', '=', 1)
                            .selectAll()
                            .executeTakeFirst()];
                case 1:
                    config = _a.sent();
                    return [2 /*return*/, config];
            }
        });
    });
}
/**
 * Create a new LLM configuration
 */
function createLLMConfig(userId, data) {
    return __awaiter(this, void 0, void 0, function () {
        var db, configType, enabled, encryptedKey, result, insertedId;
        var _a, _b, _c, _d, _e, _f, _g;
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    configType = (_a = data.configType) !== null && _a !== void 0 ? _a : 'llm';
                    enabled = (_b = data.enabled) !== null && _b !== void 0 ? _b : false;
                    // 约束验证：taskType 和 isDefault 互斥
                    if (data.taskType && data.isDefault) {
                        throw new Error('有任务类型的配置不能设置为默认配置。只有通用配置（task_type 为空）才能设置为默认。');
                    }
                    encryptedKey = (0, crypto_js_1.encryptAPIKey)(data.apiKey, config_js_1.config.llmEncryptionKey);
                    if (!data.isDefault) return [3 /*break*/, 2];
                    return [4 /*yield*/, db
                            .updateTable('llm_configs')
                            .set({ is_default: 0, updated_at: new Date().toISOString() })
                            .where('user_id', '=', userId)
                            .where('config_type', '=', configType)
                            .where('is_default', '=', 1)
                            .execute()];
                case 1:
                    _h.sent();
                    _h.label = 2;
                case 2: return [4 /*yield*/, db
                        .insertInto('llm_configs')
                        .values({
                        user_id: userId,
                        provider: data.provider,
                        base_url: data.baseURL,
                        api_key_encrypted: encryptedKey,
                        model: data.model,
                        config_type: configType,
                        task_type: (_c = data.taskType) !== null && _c !== void 0 ? _c : null,
                        enabled: enabled ? 1 : 0,
                        is_default: data.isDefault ? 1 : 0,
                        priority: (_d = data.priority) !== null && _d !== void 0 ? _d : 100,
                        timeout: (_e = data.timeout) !== null && _e !== void 0 ? _e : 30000,
                        max_retries: (_f = data.maxRetries) !== null && _f !== void 0 ? _f : 3,
                        max_concurrent: (_g = data.maxConcurrent) !== null && _g !== void 0 ? _g : 5,
                        updated_at: new Date().toISOString(),
                    })
                        .executeTakeFirstOrThrow()];
                case 3:
                    result = _h.sent();
                    insertedId = Number(result.insertId);
                    log.info({ userId: userId, llmConfigId: insertedId, provider: data.provider, model: data.model }, 'LLM config created');
                    return [2 /*return*/, {
                            id: insertedId,
                            provider: data.provider,
                            model: data.model,
                        }];
            }
        });
    });
}
/**
 * Update LLM configuration
 */
function updateLLMConfig(id, userId, data) {
    return __awaiter(this, void 0, void 0, function () {
        var db, updateData, existing, newTaskType, newIsDefault, result;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    updateData = {
                        updated_at: new Date().toISOString(),
                    };
                    return [4 /*yield*/, getLLMConfigById(id, userId)];
                case 1:
                    existing = _d.sent();
                    if (!existing) {
                        throw new Error('LLM config not found');
                    }
                    newTaskType = (_a = data.taskType) !== null && _a !== void 0 ? _a : existing.task_type;
                    newIsDefault = (_b = data.isDefault) !== null && _b !== void 0 ? _b : (existing.is_default === 1);
                    if (newTaskType && newIsDefault) {
                        throw new Error('有任务类型的配置不能设置为默认配置。只有通用配置（task_type 为空）才能设置为默认。');
                    }
                    if (data.provider !== undefined) {
                        updateData.provider = data.provider;
                    }
                    if (data.baseURL !== undefined) {
                        updateData.base_url = data.baseURL;
                    }
                    if (data.apiKey !== undefined) {
                        updateData.api_key_encrypted = (0, crypto_js_1.encryptAPIKey)(data.apiKey, config_js_1.config.llmEncryptionKey);
                    }
                    if (data.model !== undefined) {
                        updateData.model = data.model;
                    }
                    if (data.configType !== undefined) {
                        updateData.config_type = data.configType;
                    }
                    if (data.taskType !== undefined) {
                        updateData.task_type = data.taskType;
                    }
                    if (data.enabled !== undefined) {
                        updateData.enabled = data.enabled ? 1 : 0;
                    }
                    if (!(data.isDefault !== undefined)) return [3 /*break*/, 4];
                    if (!data.isDefault) return [3 /*break*/, 3];
                    return [4 /*yield*/, db
                            .updateTable('llm_configs')
                            .set({ is_default: 0, updated_at: new Date().toISOString() })
                            .where('user_id', '=', userId)
                            .where('config_type', '=', ((_c = data.configType) !== null && _c !== void 0 ? _c : existing.config_type))
                            .where('id', '!=', id)
                            .execute()];
                case 2:
                    _d.sent();
                    _d.label = 3;
                case 3:
                    updateData.is_default = data.isDefault ? 1 : 0;
                    _d.label = 4;
                case 4:
                    if (data.timeout !== undefined) {
                        updateData.timeout = data.timeout;
                    }
                    if (data.maxRetries !== undefined) {
                        updateData.max_retries = data.maxRetries;
                    }
                    if (data.maxConcurrent !== undefined) {
                        updateData.max_concurrent = data.maxConcurrent;
                    }
                    if (data.priority !== undefined) {
                        updateData.priority = data.priority;
                    }
                    return [4 /*yield*/, db
                            .updateTable('llm_configs')
                            .set(updateData)
                            .where('id', '=', id)
                            .where('user_id', '=', userId)
                            .executeTakeFirst()];
                case 5:
                    result = _d.sent();
                    if (result.numUpdatedRows === 0n) {
                        throw new Error('LLM config not found');
                    }
                    log.info({ userId: userId, llmConfigId: id }, 'LLM config updated');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Delete LLM configuration
 */
function deleteLLMConfig(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .deleteFrom('llm_configs')
                            .where('id', '=', id)
                            .where('user_id', '=', userId)
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    if (result.numDeletedRows === 0n) {
                        throw new Error('LLM config not found');
                    }
                    log.info({ userId: userId, llmConfigId: id }, 'LLM config deleted');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Set LLM config as default
 */
function setDefaultLLMConfig(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, config;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, getLLMConfigById(id, userId)];
                case 1:
                    config = _a.sent();
                    if (!config) {
                        throw new Error('LLM config not found');
                    }
                    // Unset all other defaults for this user
                    return [4 /*yield*/, db
                            .updateTable('llm_configs')
                            .set({ is_default: 0, updated_at: new Date().toISOString() })
                            .where('user_id', '=', userId)
                            .where('config_type', '=', config.config_type)
                            .where('id', '!=', id)
                            .execute()];
                case 2:
                    // Unset all other defaults for this user
                    _a.sent();
                    // Set this one as default
                    return [4 /*yield*/, db
                            .updateTable('llm_configs')
                            .set({ is_default: 1, updated_at: new Date().toISOString() })
                            .where('id', '=', id)
                            .execute()];
                case 3:
                    // Set this one as default
                    _a.sent();
                    log.info({ userId: userId, llmConfigId: id }, 'LLM config set as default');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Get decrypted API key for a config
 */
function getDecryptedAPIKey(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var dbConfig;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getLLMConfigById(id, userId)];
                case 1:
                    dbConfig = _a.sent();
                    if (!dbConfig) {
                        throw new Error('LLM config not found');
                    }
                    return [2 /*return*/, (0, crypto_js_1.decryptAPIKey)(dbConfig.api_key_encrypted, config_js_1.config.llmEncryptionKey)];
            }
        });
    });
}
/**
 * Test LLM connection
 */
function testLLMConnection(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var dbConfig, apiKey, configType, response, errorText, response, errorText, response, errorText, url, response, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 16, , 17]);
                    return [4 /*yield*/, getLLMConfigById(id, userId)];
                case 1:
                    dbConfig = _a.sent();
                    if (!dbConfig) {
                        return [2 /*return*/, { success: false, error: 'LLM config not found' }];
                    }
                    apiKey = (0, crypto_js_1.decryptAPIKey)(dbConfig.api_key_encrypted, config_js_1.config.llmEncryptionKey);
                    configType = (dbConfig.config_type || 'llm');
                    if (!(configType === 'embedding')) return [3 /*break*/, 5];
                    return [4 /*yield*/, fetch("".concat(dbConfig.base_url, "/embeddings"), {
                            method: 'POST',
                            headers: {
                                'Authorization': "Bearer ".concat(apiKey),
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                model: dbConfig.model,
                                input: ['test'],
                            }),
                            signal: AbortSignal.timeout(15000),
                        })];
                case 2:
                    response = _a.sent();
                    if (!!response.ok) return [3 /*break*/, 4];
                    return [4 /*yield*/, response.text().catch(function () { return ''; })];
                case 3:
                    errorText = _a.sent();
                    return [2 /*return*/, {
                            success: false,
                            error: "HTTP ".concat(response.status, ": ").concat(response.statusText).concat(errorText ? " - ".concat(errorText.slice(0, 100)) : ''),
                        }];
                case 4: return [3 /*break*/, 15];
                case 5:
                    if (!(configType === 'rerank')) return [3 /*break*/, 9];
                    return [4 /*yield*/, fetch("".concat(dbConfig.base_url, "/rerank"), {
                            method: 'POST',
                            headers: {
                                'Authorization': "Bearer ".concat(apiKey),
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                model: dbConfig.model,
                                query: 'test',
                                documents: ['a', 'b'],
                                top_n: 2,
                            }),
                            signal: AbortSignal.timeout(15000),
                        })];
                case 6:
                    response = _a.sent();
                    if (!!response.ok) return [3 /*break*/, 8];
                    return [4 /*yield*/, response.text().catch(function () { return ''; })];
                case 7:
                    errorText = _a.sent();
                    return [2 /*return*/, {
                            success: false,
                            error: "HTTP ".concat(response.status, ": ").concat(response.statusText).concat(errorText ? " - ".concat(errorText.slice(0, 100)) : ''),
                        }];
                case 8: return [3 /*break*/, 15];
                case 9:
                    if (!(dbConfig.provider === 'openai' || dbConfig.provider === 'custom')) return [3 /*break*/, 13];
                    return [4 /*yield*/, fetch("".concat(dbConfig.base_url, "/chat/completions"), {
                            method: 'POST',
                            headers: {
                                'Authorization': "Bearer ".concat(apiKey),
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                model: dbConfig.model,
                                messages: [{ role: 'user', content: 'Hi' }],
                                max_tokens: 10,
                            }),
                            signal: AbortSignal.timeout(15000),
                        })];
                case 10:
                    response = _a.sent();
                    if (!!response.ok) return [3 /*break*/, 12];
                    return [4 /*yield*/, response.text().catch(function () { return ''; })];
                case 11:
                    errorText = _a.sent();
                    return [2 /*return*/, {
                            success: false,
                            error: "HTTP ".concat(response.status, ": ").concat(response.statusText).concat(errorText ? " - ".concat(errorText.slice(0, 100)) : ''),
                        }];
                case 12: return [3 /*break*/, 15];
                case 13:
                    if (!(dbConfig.provider === 'gemini')) return [3 /*break*/, 15];
                    url = "".concat(dbConfig.base_url, "/").concat(dbConfig.model, ":generateContent?key=").concat(apiKey);
                    return [4 /*yield*/, fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: 'test' }] }],
                                generationConfig: { maxOutputTokens: 1 },
                            }),
                            signal: AbortSignal.timeout(10000),
                        })];
                case 14:
                    response = _a.sent();
                    if (!response.ok) {
                        return [2 /*return*/, { success: false, error: "HTTP ".concat(response.status, ": ").concat(response.statusText) }];
                    }
                    _a.label = 15;
                case 15: return [2 /*return*/, { success: true }];
                case 16:
                    error_1 = _a.sent();
                    if (error_1 instanceof Error) {
                        if (error_1.name === 'AbortError') {
                            return [2 /*return*/, { success: false, error: 'Connection timeout' }];
                        }
                        return [2 /*return*/, { success: false, error: error_1.message }];
                    }
                    return [2 /*return*/, { success: false, error: 'Unknown error' }];
                case 17: return [2 /*return*/];
            }
        });
    });
}
/**
 * Get active LLM config for use (default or first available)
 */
function getActiveLLMConfig(userId) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, getActiveConfigByType(userId, 'llm')];
        });
    });
}
/**
 * 获取指定类型的活跃配置（默认优先）
 */
function getActiveConfigByType(userId, configType) {
    return __awaiter(this, void 0, void 0, function () {
        var db, config;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('llm_configs')
                            .where('user_id', '=', userId)
                            .where('config_type', '=', configType)
                            .where('enabled', '=', 1)
                            .selectAll()
                            .orderBy('is_default', 'desc')
                            .orderBy('priority', 'asc')
                            .orderBy('created_at', 'asc')
                            .limit(1)
                            .executeTakeFirst()];
                case 1:
                    config = _a.sent();
                    return [2 /*return*/, config !== null && config !== void 0 ? config : null];
            }
        });
    });
}
/**
 * 获取指定类型的活跃配置列表（默认优先 + 优先级排序）
 */
function getActiveConfigListByType(userId, configType) {
    return __awaiter(this, void 0, void 0, function () {
        var db, configs;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('llm_configs')
                            .where('user_id', '=', userId)
                            .where('config_type', '=', configType)
                            .where('enabled', '=', 1)
                            .selectAll()
                            .orderBy('is_default', 'desc')
                            .orderBy('priority', 'asc')
                            .orderBy('created_at', 'asc')
                            .execute()];
                case 1:
                    configs = _a.sent();
                    return [2 /*return*/, configs];
            }
        });
    });
}
/**
 * 获取指定类型和任务类型的活跃配置（单条）
 * 优先级：精确匹配 task_type > task_type 为空（兜底）
 */
function getActiveConfigByTypeAndTask(userId, configType, taskType) {
    return __awaiter(this, void 0, void 0, function () {
        var configs;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, getActiveConfigListByTypeAndTask(userId, configType, taskType)];
                case 1:
                    configs = _b.sent();
                    return [2 /*return*/, (_a = configs[0]) !== null && _a !== void 0 ? _a : null];
            }
        });
    });
}
/**
 * 获取指定类型和任务类型的活跃配置列表（支持故障转移）
 * 优先级：精确匹配 task_type > task_type 为空（兜底配置）
 */
function getActiveConfigListByTypeAndTask(userId, configType, taskType) {
    return __awaiter(this, void 0, void 0, function () {
        var db, configs;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('llm_configs')
                            .where('user_id', '=', userId)
                            .where('config_type', '=', configType)
                            .where('enabled', '=', 1)
                            .where(function (eb) {
                            return eb.or([
                                eb('task_type', '=', taskType !== null && taskType !== void 0 ? taskType : null),
                                eb('task_type', 'is', null),
                            ]);
                        })
                            .selectAll()
                            .execute()];
                case 1:
                    configs = _a.sent();
                    // 在应用层排序：精确匹配 task_type 优先，然后是 task_type 为空的兜底配置
                    return [2 /*return*/, configs.sort(function (a, b) {
                            var _a, _b, _c, _d, _e, _f;
                            // 优先级 1: task_type 精确匹配
                            var aExactMatch = a.task_type === (taskType !== null && taskType !== void 0 ? taskType : null) ? 1 : 0;
                            var bExactMatch = b.task_type === (taskType !== null && taskType !== void 0 ? taskType : null) ? 1 : 0;
                            if (aExactMatch !== bExactMatch) {
                                return bExactMatch - aExactMatch; // 精确匹配优先
                            }
                            // 优先级 2: is_default（默认配置优先）
                            if (a.is_default !== b.is_default) {
                                return ((_a = b.is_default) !== null && _a !== void 0 ? _a : 0) - ((_b = a.is_default) !== null && _b !== void 0 ? _b : 0);
                            }
                            // 优先级 3: priority（数字越小越优先）
                            if (((_c = a.priority) !== null && _c !== void 0 ? _c : 100) !== ((_d = b.priority) !== null && _d !== void 0 ? _d : 100)) {
                                return ((_e = a.priority) !== null && _e !== void 0 ? _e : 100) - ((_f = b.priority) !== null && _f !== void 0 ? _f : 100);
                            }
                            // 优先级 4: created_at（最早创建的优先）
                            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                        })];
            }
        });
    });
}
