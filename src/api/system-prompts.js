"use strict";
/**
 * 系统提示词服务
 *
 * 负责 system_prompts 表的 CRUD 操作。
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
exports.renderSystemPrompt = renderSystemPrompt;
exports.getActiveSystemPromptByType = getActiveSystemPromptByType;
exports.resolveSystemPrompt = resolveSystemPrompt;
exports.ensureDefaultSystemPrompts = ensureDefaultSystemPrompts;
exports.listSystemPrompts = listSystemPrompts;
exports.getSystemPromptById = getSystemPromptById;
exports.createSystemPrompt = createSystemPrompt;
exports.updateSystemPrompt = updateSystemPrompt;
exports.deleteSystemPrompt = deleteSystemPrompt;
var db_js_1 = require("../db.js");
var logger_js_1 = require("../logger.js");
var system_prompt_variables_js_1 = require("../config/system-prompt-variables.js");
var fs_1 = require("fs");
var path_1 = require("path");
var url_1 = require("url");
var __filename = (0, url_1.fileURLToPath)(import.meta.url);
var __dirname = path_1.default.dirname(__filename);
var log = logger_js_1.logger.child({ module: 'system-prompts-service' });
/**
 * 默认提示词配置
 * 每种类型对应一个 md 文件，如果文件不存在则不创建该类型的默认提示词
 */
var DEFAULT_PROMPT_CONFIG = {
    filter: { fileName: 'filter.md', name: '默认文章过滤提示词' },
    summary: { fileName: 'summary.md', name: '默认摘要提示词' },
    keywords: { fileName: 'keywords.md', name: '默认关键词提示词' },
    translation: { fileName: 'translation.md', name: '默认翻译提示词' },
    daily_summary: { fileName: 'daily_summary.md', name: '默认当日总结提示词' },
};
/**
 * 默认提示词模板目录
 */
var DEFAULT_PROMPTS_DIR = path_1.default.join(__dirname, '../config/default-prompts');
/**
 * 从 md 文件读取默认提示词模板
 */
function readDefaultPromptTemplate(type) {
    var config = DEFAULT_PROMPT_CONFIG[type];
    if (!config) {
        return null;
    }
    var filePath = path_1.default.join(DEFAULT_PROMPTS_DIR, config.fileName);
    try {
        return fs_1.default.readFileSync(filePath, 'utf-8');
    }
    catch (error) {
        // 文件不存在，跳过该类型的默认提示词
        return null;
    }
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function renderSystemPrompt(template, variables) {
    if (!template)
        return template;
    var output = template;
    for (var _i = 0, _a = Object.entries(variables); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        if (value === undefined || value === null)
            continue;
        var pattern = new RegExp("{{\\s*".concat(escapeRegExp(key), "\\s*}}"), 'g');
        output = output.replace(pattern, String(value));
    }
    return output;
}
function normalizeVariables(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value === 'string') {
        var trimmed = value.trim();
        if (!trimmed)
            return null;
        JSON.parse(trimmed);
        return trimmed;
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    throw new Error('variables 必须是 JSON 字符串或对象');
}
function getActiveSystemPromptByType(userId, type) {
    return __awaiter(this, void 0, void 0, function () {
        var db;
        return __generator(this, function (_a) {
            db = (0, db_js_1.getDb)();
            return [2 /*return*/, db
                    .selectFrom('system_prompts')
                    .where('user_id', '=', userId)
                    .where('type', '=', type)
                    .where('is_active', '=', 1)
                    .selectAll()
                    .orderBy('updated_at', 'desc')
                    .executeTakeFirst()];
        });
    });
}
function resolveSystemPrompt(userId, type, fallback, variables) {
    return __awaiter(this, void 0, void 0, function () {
        var record;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!userId)
                        return [2 /*return*/, fallback];
                    return [4 /*yield*/, getActiveSystemPromptByType(userId, type)];
                case 1:
                    record = _a.sent();
                    if (!record || !record.template || record.template.trim().length === 0) {
                        return [2 /*return*/, fallback];
                    }
                    return [2 /*return*/, renderSystemPrompt(record.template, variables)];
            }
        });
    });
}
function ensureDefaultSystemPrompts(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, created, skipped, _i, _a, _b, type, config, existing, template;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    created = 0;
                    skipped = 0;
                    _i = 0, _a = Object.entries(DEFAULT_PROMPT_CONFIG);
                    _c.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 5];
                    _b = _a[_i], type = _b[0], config = _b[1];
                    return [4 /*yield*/, db
                            .selectFrom('system_prompts')
                            .where('user_id', '=', userId)
                            .where('type', '=', type)
                            .select(['id'])
                            .executeTakeFirst()];
                case 2:
                    existing = _c.sent();
                    if (existing) {
                        skipped += 1;
                        return [3 /*break*/, 4];
                    }
                    template = readDefaultPromptTemplate(type);
                    if (!template) {
                        // md 文件不存在，跳过
                        log.debug({ type: type, fileName: config.fileName }, 'Default prompt template file not found, skipping');
                        skipped += 1;
                        return [3 /*break*/, 4];
                    }
                    return [4 /*yield*/, db
                            .insertInto('system_prompts')
                            .values({
                            user_id: userId,
                            type: type,
                            name: config.name,
                            template: template,
                            variables: (0, system_prompt_variables_js_1.variablesToJSON)(type),
                            is_active: 1,
                            updated_at: new Date().toISOString(),
                        })
                            .executeTakeFirst()];
                case 3:
                    _c.sent();
                    created += 1;
                    _c.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 1];
                case 5: return [2 /*return*/, { created: created, skipped: skipped }];
            }
        });
    });
}
function listSystemPrompts(userId_1) {
    return __awaiter(this, arguments, void 0, function (userId, options) {
        var db, query;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            db = (0, db_js_1.getDb)();
            query = db
                .selectFrom('system_prompts')
                .where('user_id', '=', userId);
            if (options.type) {
                query = query.where('type', '=', options.type);
            }
            if (options.isActive !== undefined) {
                query = query.where('is_active', '=', options.isActive ? 1 : 0);
            }
            return [2 /*return*/, query
                    .selectAll()
                    .orderBy('updated_at', 'desc')
                    .execute()];
        });
    });
}
function getSystemPromptById(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db;
        return __generator(this, function (_a) {
            db = (0, db_js_1.getDb)();
            return [2 /*return*/, db
                    .selectFrom('system_prompts')
                    .where('id', '=', id)
                    .where('user_id', '=', userId)
                    .selectAll()
                    .executeTakeFirst()];
        });
    });
}
function createSystemPrompt(userId, data) {
    return __awaiter(this, void 0, void 0, function () {
        var db, variables, result, insertedId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    variables = normalizeVariables(data.variables);
                    return [4 /*yield*/, db
                            .insertInto('system_prompts')
                            .values({
                            user_id: userId,
                            type: data.type.trim(),
                            name: data.name.trim(),
                            template: data.template,
                            variables: variables,
                            is_active: data.isActive === undefined ? 1 : data.isActive ? 1 : 0,
                            updated_at: new Date().toISOString(),
                        })
                            .executeTakeFirstOrThrow()];
                case 1:
                    result = _a.sent();
                    insertedId = Number(result.insertId);
                    log.info({ userId: userId, promptId: insertedId, type: data.type }, 'System prompt created');
                    return [2 /*return*/, { id: insertedId }];
            }
        });
    });
}
function updateSystemPrompt(id, userId, data) {
    return __awaiter(this, void 0, void 0, function () {
        var db, updateData, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    updateData = {
                        updated_at: new Date().toISOString(),
                    };
                    if (data.type !== undefined) {
                        updateData.type = data.type.trim();
                    }
                    if (data.name !== undefined) {
                        updateData.name = data.name.trim();
                    }
                    if (data.template !== undefined) {
                        updateData.template = data.template;
                    }
                    if (data.variables !== undefined) {
                        updateData.variables = normalizeVariables(data.variables);
                    }
                    if (data.isActive !== undefined) {
                        updateData.is_active = data.isActive ? 1 : 0;
                    }
                    return [4 /*yield*/, db
                            .updateTable('system_prompts')
                            .set(updateData)
                            .where('id', '=', id)
                            .where('user_id', '=', userId)
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    if (result.numUpdatedRows === 0n) {
                        throw new Error('System prompt not found');
                    }
                    log.info({ userId: userId, promptId: id }, 'System prompt updated');
                    return [2 /*return*/];
            }
        });
    });
}
function deleteSystemPrompt(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .deleteFrom('system_prompts')
                            .where('id', '=', id)
                            .where('user_id', '=', userId)
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    if (result.numDeletedRows === 0n) {
                        throw new Error('System prompt not found');
                    }
                    log.info({ userId: userId, promptId: id }, 'System prompt deleted');
                    return [2 /*return*/];
            }
        });
    });
}
