"use strict";
/**
 * Settings Service
 *
 * Database operations for user settings management.
 * Settings are stored as key-value pairs in the settings table.
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
exports.getUserSetting = getUserSetting;
exports.setUserSetting = setUserSetting;
exports.getUserSettings = getUserSettings;
exports.getAllUserSettings = getAllUserSettings;
exports.deleteUserSetting = deleteUserSetting;
exports.batchSetUserSettings = batchSetUserSettings;
exports.getSchedulerSettings = getSchedulerSettings;
exports.updateSchedulerSettings = updateSchedulerSettings;
exports.getChromaSettings = getChromaSettings;
exports.updateChromaSettings = updateChromaSettings;
exports.getTelegramSettings = getTelegramSettings;
exports.updateTelegramSettings = updateTelegramSettings;
var db_js_1 = require("../db.js");
var logger_js_1 = require("../logger.js");
var log = logger_js_1.logger.child({ module: 'settings-service' });
/**
 * Boolean to string conversion for database storage
 */
function boolToString(value) {
    return value ? 'true' : 'false';
}
/**
 * String to boolean conversion for database retrieval
 */
function stringToBool(value, defaultValue) {
    if (defaultValue === void 0) { defaultValue = false; }
    if (!value)
        return defaultValue;
    return value === 'true';
}
/**
 * Get user setting
 * @param userId - User ID
 * @param key - Setting key
 * @returns Setting value or null
 */
function getUserSetting(userId, key) {
    return __awaiter(this, void 0, void 0, function () {
        var db, result;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('settings')
                            .where('user_id', '=', userId)
                            .where('key', '=', key)
                            .select('value')
                            .executeTakeFirst()];
                case 1:
                    result = _b.sent();
                    return [2 /*return*/, (_a = result === null || result === void 0 ? void 0 : result.value) !== null && _a !== void 0 ? _a : null];
            }
        });
    });
}
/**
 * Set user setting
 * @param userId - User ID
 * @param key - Setting key
 * @param value - Setting value
 */
function setUserSetting(userId, key, value) {
    return __awaiter(this, void 0, void 0, function () {
        var db, stringValue, now, existing;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    stringValue = String(value);
                    now = new Date().toISOString();
                    return [4 /*yield*/, db
                            .selectFrom('settings')
                            .where('user_id', '=', userId)
                            .where('key', '=', key)
                            .select('id')
                            .executeTakeFirst()];
                case 1:
                    existing = _a.sent();
                    if (!existing) return [3 /*break*/, 3];
                    // Update
                    return [4 /*yield*/, db
                            .updateTable('settings')
                            .set({
                            value: stringValue,
                            updated_at: now,
                        })
                            .where('id', '=', existing.id)
                            .execute()];
                case 2:
                    // Update
                    _a.sent();
                    return [3 /*break*/, 5];
                case 3: 
                // Insert
                return [4 /*yield*/, db
                        .insertInto('settings')
                        .values({
                        user_id: userId,
                        key: key,
                        value: stringValue,
                        updated_at: now,
                    })
                        .execute()];
                case 4:
                    // Insert
                    _a.sent();
                    _a.label = 5;
                case 5:
                    log.info({ userId: userId, key: key, value: value }, 'Setting updated');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Get multiple user settings
 * @param userId - User ID
 * @param keys - Setting keys
 * @returns Record of key-value pairs
 */
function getUserSettings(userId, keys) {
    return __awaiter(this, void 0, void 0, function () {
        var db, results, settings, _i, results_1, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('settings')
                            .where('user_id', '=', userId)
                            .where('key', 'in', keys)
                            .select(['key', 'value'])
                            .execute()];
                case 1:
                    results = _a.sent();
                    settings = {};
                    for (_i = 0, results_1 = results; _i < results_1.length; _i++) {
                        result = results_1[_i];
                        settings[result.key] = result.value;
                    }
                    return [2 /*return*/, settings];
            }
        });
    });
}
/**
 * Get all user settings
 * @param userId - User ID
 * @returns Record of all key-value pairs
 */
function getAllUserSettings(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, results, settings, _i, results_2, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('settings')
                            .where('user_id', '=', userId)
                            .select(['key', 'value'])
                            .execute()];
                case 1:
                    results = _a.sent();
                    settings = {};
                    for (_i = 0, results_2 = results; _i < results_2.length; _i++) {
                        result = results_2[_i];
                        settings[result.key] = result.value;
                    }
                    return [2 /*return*/, settings];
            }
        });
    });
}
/**
 * Delete user setting
 * @param userId - User ID
 * @param key - Setting key
 */
function deleteUserSetting(userId, key) {
    return __awaiter(this, void 0, void 0, function () {
        var db;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .deleteFrom('settings')
                            .where('user_id', '=', userId)
                            .where('key', '=', key)
                            .execute()];
                case 1:
                    _a.sent();
                    log.info({ userId: userId, key: key }, 'Setting deleted');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Batch set user settings
 * @param userId - User ID
 * @param settings - Key-value pairs
 */
function batchSetUserSettings(userId, settings) {
    return __awaiter(this, void 0, void 0, function () {
        var _i, _a, _b, key, value;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _i = 0, _a = Object.entries(settings);
                    _c.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    _b = _a[_i], key = _b[0], value = _b[1];
                    return [4 /*yield*/, setUserSetting(userId, key, value)];
                case 2:
                    _c.sent();
                    _c.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    log.info({ userId: userId, count: Object.keys(settings).length }, 'Batch settings updated');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Get scheduler-related settings
 * @param userId - User ID
 */
function getSchedulerSettings(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var settings;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getUserSettings(userId, [
                        'rss_fetch_schedule',
                        'rss_fetch_enabled',
                        'max_concurrent_fetch',
                    ])];
                case 1:
                    settings = _a.sent();
                    return [2 /*return*/, {
                            rssFetchSchedule: settings.rss_fetch_schedule || '0 9 * * *',
                            rssFetchEnabled: stringToBool(settings.rss_fetch_enabled, false),
                            maxConcurrentFetch: parseInt(settings.max_concurrent_fetch || '5', 10),
                        }];
            }
        });
    });
}
/**
 * Update scheduler settings
 * @param userId - User ID
 * @param settings - Scheduler settings
 */
function updateSchedulerSettings(userId, settings) {
    return __awaiter(this, void 0, void 0, function () {
        var updates;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    updates = {};
                    if (settings.rssFetchSchedule !== undefined) {
                        updates.rss_fetch_schedule = settings.rssFetchSchedule;
                    }
                    if (settings.rssFetchEnabled !== undefined) {
                        updates.rss_fetch_enabled = boolToString(settings.rssFetchEnabled);
                    }
                    if (settings.maxConcurrentFetch !== undefined) {
                        updates.max_concurrent_fetch = settings.maxConcurrentFetch;
                    }
                    if (!(Object.keys(updates).length > 0)) return [3 /*break*/, 2];
                    return [4 /*yield*/, batchSetUserSettings(userId, updates)];
                case 1:
                    _a.sent();
                    log.info({ userId: userId, settings: updates }, 'Scheduler settings updated');
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
/**
 * 获取 Chroma 设置
 */
function getChromaSettings(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var settings, rawMetric, distanceMetric;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getUserSettings(userId, [
                        'chroma_host',
                        'chroma_port',
                        'chroma_collection',
                        'chroma_distance_metric',
                    ])];
                case 1:
                    settings = _a.sent();
                    rawMetric = (settings.chroma_distance_metric || 'cosine').toLowerCase();
                    distanceMetric = (rawMetric === 'l2' || rawMetric === 'ip' ? rawMetric : 'cosine');
                    return [2 /*return*/, {
                            host: settings.chroma_host || '127.0.0.1',
                            port: parseInt(settings.chroma_port || '8000', 10),
                            collection: settings.chroma_collection || 'articles',
                            distanceMetric: distanceMetric,
                        }];
            }
        });
    });
}
/**
 * 更新 Chroma 设置
 */
function updateChromaSettings(userId, settings) {
    return __awaiter(this, void 0, void 0, function () {
        var updates;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    updates = {};
                    if (settings.host !== undefined) {
                        updates.chroma_host = settings.host;
                    }
                    if (settings.port !== undefined) {
                        updates.chroma_port = settings.port;
                    }
                    if (settings.collection !== undefined) {
                        updates.chroma_collection = settings.collection;
                    }
                    if (settings.distanceMetric !== undefined) {
                        updates.chroma_distance_metric = settings.distanceMetric;
                    }
                    if (!(Object.keys(updates).length > 0)) return [3 /*break*/, 2];
                    return [4 /*yield*/, batchSetUserSettings(userId, updates)];
                case 1:
                    _a.sent();
                    log.info({ userId: userId, settings: updates }, 'Chroma settings updated');
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
/**
 * 获取 Telegram 设置
 */
function getTelegramSettings(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var settings;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getUserSettings(userId, [
                        'telegram_enabled',
                        'telegram_bot_token',
                        'telegram_chat_id',
                        'telegram_daily_summary',
                        'telegram_new_articles',
                    ])];
                case 1:
                    settings = _a.sent();
                    return [2 /*return*/, {
                            enabled: stringToBool(settings.telegram_enabled, false),
                            botToken: settings.telegram_bot_token || '',
                            chatId: settings.telegram_chat_id || '',
                            dailySummary: stringToBool(settings.telegram_daily_summary, false),
                            newArticles: stringToBool(settings.telegram_new_articles, false),
                        }];
            }
        });
    });
}
/**
 * 更新 Telegram 设置
 */
function updateTelegramSettings(userId, settings) {
    return __awaiter(this, void 0, void 0, function () {
        var updates;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    updates = {};
                    if (settings.enabled !== undefined) {
                        updates.telegram_enabled = boolToString(settings.enabled);
                    }
                    if (settings.botToken !== undefined) {
                        updates.telegram_bot_token = settings.botToken;
                    }
                    if (settings.chatId !== undefined) {
                        updates.telegram_chat_id = settings.chatId;
                    }
                    if (settings.dailySummary !== undefined) {
                        updates.telegram_daily_summary = boolToString(settings.dailySummary);
                    }
                    if (settings.newArticles !== undefined) {
                        updates.telegram_new_articles = boolToString(settings.newArticles);
                    }
                    if (!(Object.keys(updates).length > 0)) return [3 /*break*/, 2];
                    return [4 /*yield*/, batchSetUserSettings(userId, updates)];
                case 1:
                    _a.sent();
                    log.info({ userId: userId, settings: updates }, 'Telegram settings updated');
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
