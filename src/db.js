"use strict";
/**
 * Database module - Kysely + SQLite
 *
 * Database operations with Kysely ORM and SQLite.
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
exports.initDb = initDb;
exports.getDb = getDb;
exports.closeDb = closeDb;
var better_sqlite3_1 = require("better-sqlite3");
var kysely_1 = require("kysely");
var logger_js_1 = require("./logger.js");
var config_js_1 = require("./config.js");
var fs_1 = require("fs");
var path_1 = require("path");
var _db = null;
/**
 * Initialize database connection
 */
function initDb() {
    if (_db)
        return _db;
    // Ensure data directory exists
    var dbDir = path_1.default.dirname(config_js_1.config.databasePath);
    if (!fs_1.default.existsSync(dbDir)) {
        fs_1.default.mkdirSync(dbDir, { recursive: true });
    }
    var sqlite = new better_sqlite3_1.default(config_js_1.config.databasePath);
    // Enable WAL mode for better concurrency
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('cache_size = -64000'); // 64MB cache
    sqlite.pragma('foreign_keys = ON'); // Enable foreign key constraints
    _db = new kysely_1.Kysely({
        dialect: new kysely_1.SqliteDialect({
            database: sqlite,
        }),
    });
    logger_js_1.logger.info({ database: config_js_1.config.databasePath }, 'Database initialized');
    return _db;
}
/**
 * Get database instance
 */
function getDb() {
    if (!_db) {
        return initDb();
    }
    return _db;
}
/**
 * Close database connection
 */
function closeDb() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!_db) return [3 /*break*/, 2];
                    return [4 /*yield*/, _db.destroy()];
                case 1:
                    _a.sent();
                    _db = null;
                    logger_js_1.logger.info('Database connection closed');
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
