"use strict";
/**
 * Telegram Chats Service
 *
 * Database operations for managing multiple Telegram chat configurations.
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
exports.getTelegramChats = getTelegramChats;
exports.getActiveTelegramChats = getActiveTelegramChats;
exports.getTelegramChatById = getTelegramChatById;
exports.getTelegramChatByChatId = getTelegramChatByChatId;
exports.addTelegramChat = addTelegramChat;
exports.updateTelegramChat = updateTelegramChat;
exports.deleteTelegramChat = deleteTelegramChat;
exports.isChatAdmin = isChatAdmin;
exports.getAdminTelegramChats = getAdminTelegramChats;
exports.getViewerTelegramChats = getViewerTelegramChats;
exports.hasTelegramChats = hasTelegramChats;
exports.getDailySummaryChats = getDailySummaryChats;
exports.getNewArticlesChats = getNewArticlesChats;
exports.getJournalAllChats = getJournalAllChats;
var db_js_1 = require("../db.js");
var logger_js_1 = require("../logger.js");
var log = logger_js_1.logger.child({ module: 'telegram-chats-service' });
/**
 * Convert database row to config object
 */
function rowToConfig(row) {
    return {
        id: row.id,
        userId: row.user_id,
        chatId: row.chat_id,
        chatName: row.chat_name,
        role: row.role,
        dailySummary: row.daily_summary === 1,
        journalAll: row.journal_all === 1,
        newArticles: row.new_articles === 1,
        isActive: row.is_active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
/**
 * Get all Telegram chats for a user
 */
function getTelegramChats(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .orderBy('created_at', 'asc')
                            .selectAll()
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(rowToConfig)];
            }
        });
    });
}
/**
 * Get active Telegram chats for a user
 */
function getActiveTelegramChats(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('is_active', '=', 1)
                            .orderBy('created_at', 'asc')
                            .selectAll()
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(rowToConfig)];
            }
        });
    });
}
/**
 * Get a specific Telegram chat by ID
 */
function getTelegramChatById(userId, id) {
    return __awaiter(this, void 0, void 0, function () {
        var db, row;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('id', '=', id)
                            .where('user_id', '=', userId)
                            .selectAll()
                            .executeTakeFirst()];
                case 1:
                    row = _a.sent();
                    return [2 /*return*/, row ? rowToConfig(row) : null];
            }
        });
    });
}
/**
 * Get a specific Telegram chat by chat_id
 */
function getTelegramChatByChatId(userId, chatId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, row;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('chat_id', '=', chatId)
                            .selectAll()
                            .executeTakeFirst()];
                case 1:
                    row = _a.sent();
                    return [2 /*return*/, row ? rowToConfig(row) : null];
            }
        });
    });
}
/**
 * Add a new Telegram chat
 */
function addTelegramChat(userId, input) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now, result;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    return [4 /*yield*/, db
                            .insertInto('telegram_chats')
                            .values({
                            user_id: userId,
                            chat_id: input.chatId.trim(),
                            chat_name: ((_a = input.chatName) === null || _a === void 0 ? void 0 : _a.trim()) || null,
                            role: input.role || 'viewer',
                            daily_summary: input.dailySummary !== false ? 1 : 0,
                            journal_all: input.journalAll !== false ? 1 : 0,
                            new_articles: input.newArticles !== false ? 1 : 0,
                            is_active: input.isActive !== false ? 1 : 0,
                            updated_at: now,
                        })
                            .returningAll()
                            .executeTakeFirstOrThrow()];
                case 1:
                    result = _b.sent();
                    log.info({ userId: userId, chatId: input.chatId, role: input.role || 'viewer' }, 'Telegram chat added');
                    return [2 /*return*/, rowToConfig(result)];
            }
        });
    });
}
/**
 * Update a Telegram chat
 */
function updateTelegramChat(userId, id, input) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now, updates, result;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    updates = { updated_at: now };
                    if (input.chatName !== undefined) {
                        updates.chat_name = ((_a = input.chatName) === null || _a === void 0 ? void 0 : _a.trim()) || null;
                    }
                    if (input.role !== undefined) {
                        updates.role = input.role;
                    }
                    if (input.dailySummary !== undefined) {
                        updates.daily_summary = input.dailySummary ? 1 : 0;
                    }
                    if (input.journalAll !== undefined) {
                        updates.journal_all = input.journalAll ? 1 : 0;
                    }
                    if (input.newArticles !== undefined) {
                        updates.new_articles = input.newArticles ? 1 : 0;
                    }
                    if (input.isActive !== undefined) {
                        updates.is_active = input.isActive ? 1 : 0;
                    }
                    return [4 /*yield*/, db
                            .updateTable('telegram_chats')
                            .set(updates)
                            .where('id', '=', id)
                            .where('user_id', '=', userId)
                            .returningAll()
                            .executeTakeFirst()];
                case 1:
                    result = _b.sent();
                    if (!result) {
                        return [2 /*return*/, null];
                    }
                    log.info({ userId: userId, id: id, updates: Object.keys(input) }, 'Telegram chat updated');
                    return [2 /*return*/, rowToConfig(result)];
            }
        });
    });
}
/**
 * Delete a Telegram chat
 */
function deleteTelegramChat(userId, id) {
    return __awaiter(this, void 0, void 0, function () {
        var db, result, deleted;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .deleteFrom('telegram_chats')
                            .where('id', '=', id)
                            .where('user_id', '=', userId)
                            .execute()];
                case 1:
                    result = _a.sent();
                    deleted = result.length > 0;
                    if (deleted) {
                        log.info({ userId: userId, id: id }, 'Telegram chat deleted');
                    }
                    return [2 /*return*/, deleted];
            }
        });
    });
}
/**
 * Check if a chat has admin role
 */
function isChatAdmin(userId, chatId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, row;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('chat_id', '=', chatId)
                            .where('is_active', '=', 1)
                            .select('role')
                            .executeTakeFirst()];
                case 1:
                    row = _a.sent();
                    return [2 /*return*/, (row === null || row === void 0 ? void 0 : row.role) === 'admin'];
            }
        });
    });
}
/**
 * Get admin chats for a user
 */
function getAdminTelegramChats(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('is_active', '=', 1)
                            .where('role', '=', 'admin')
                            .orderBy('created_at', 'asc')
                            .selectAll()
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(rowToConfig)];
            }
        });
    });
}
/**
 * Get viewer chats for a user
 */
function getViewerTelegramChats(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('is_active', '=', 1)
                            .where('role', '=', 'viewer')
                            .orderBy('created_at', 'asc')
                            .selectAll()
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(rowToConfig)];
            }
        });
    });
}
/**
 * Check if user has any active Telegram chats configured
 */
function hasTelegramChats(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, row;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('is_active', '=', 1)
                            .select('id')
                            .executeTakeFirst()];
                case 1:
                    row = _a.sent();
                    return [2 /*return*/, !!row];
            }
        });
    });
}
/**
 * Get chats that should receive daily summary
 */
function getDailySummaryChats(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('is_active', '=', 1)
                            .where('daily_summary', '=', 1)
                            .orderBy('created_at', 'asc')
                            .selectAll()
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(rowToConfig)];
            }
        });
    });
}
/**
 * Get chats that should receive new articles
 */
function getNewArticlesChats(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('is_active', '=', 1)
                            .where('new_articles', '=', 1)
                            .orderBy('created_at', 'asc')
                            .selectAll()
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(rowToConfig)];
            }
        });
    });
}
/**
 * Get chats that should receive journal all summary
 */
function getJournalAllChats(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('telegram_chats')
                            .where('user_id', '=', userId)
                            .where('is_active', '=', 1)
                            .where('journal_all', '=', 1)
                            .orderBy('created_at', 'asc')
                            .selectAll()
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(rowToConfig)];
            }
        });
    });
}
