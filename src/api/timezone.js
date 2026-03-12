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
exports.getUserTimezone = getUserTimezone;
exports.getUserLocalDate = getUserLocalDate;
exports.buildUtcRangeFromLocalDate = buildUtcRangeFromLocalDate;
var config_js_1 = require("../config.js");
var settings_js_1 = require("./settings.js");
/**
 * 读取用户时区设置，默认回退到全局配置
 */
function getUserTimezone(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var setting;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!userId) {
                        return [2 /*return*/, config_js_1.config.defaultTimezone];
                    }
                    return [4 /*yield*/, (0, settings_js_1.getUserSetting)(userId, 'timezone')];
                case 1:
                    setting = _a.sent();
                    return [2 /*return*/, setting || config_js_1.config.defaultTimezone];
            }
        });
    });
}
/**
 * 获取用户时区下的当前日期（YYYY-MM-DD 格式）
 * @param userId - 用户 ID
 * @returns 用户时区下的当前日期字符串
 */
function getUserLocalDate(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var timezone;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getUserTimezone(userId)];
                case 1:
                    timezone = _a.sent();
                    return [2 /*return*/, getLocalDateInTimezone(timezone)];
            }
        });
    });
}
/**
 * 获取指定时区下的当前日期（YYYY-MM-DD 格式）
 * @param timezone - 时区字符串
 * @returns 该时区下的当前日期字符串
 */
function getLocalDateInTimezone(timezone) {
    var _a, _b, _c, _d, _e, _f;
    var formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    var parts = formatter.formatToParts(new Date());
    var year = (_b = (_a = parts.find(function (p) { return p.type === 'year'; })) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : '';
    var month = (_d = (_c = parts.find(function (p) { return p.type === 'month'; })) === null || _c === void 0 ? void 0 : _c.value) !== null && _d !== void 0 ? _d : '';
    var day = (_f = (_e = parts.find(function (p) { return p.type === 'day'; })) === null || _e === void 0 ? void 0 : _e.value) !== null && _f !== void 0 ? _f : '';
    return "".concat(year, "-").concat(month, "-").concat(day);
}
/**
 * 根据本地自然日计算 UTC 查询区间
 */
function buildUtcRangeFromLocalDate(dateStr, timezone) {
    var resolvedTimezone = timezone || config_js_1.config.defaultTimezone;
    var _a = parseDateParts(dateStr), year = _a[0], month = _a[1], day = _a[2];
    var startRef = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    var endRef = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    var startUtc = new Date(startRef.getTime() - getTimezoneOffsetMs(startRef, resolvedTimezone));
    var endUtc = new Date(endRef.getTime() - getTimezoneOffsetMs(endRef, resolvedTimezone));
    return [startUtc.toISOString(), endUtc.toISOString()];
}
function parseDateParts(dateStr) {
    var _a;
    var parts = (_a = dateStr === null || dateStr === void 0 ? void 0 : dateStr.split('-').map(function (v) { return Number(v); })) !== null && _a !== void 0 ? _a : [];
    if (parts.length === 3 && parts.every(function (n) { return Number.isFinite(n); })) {
        return parts;
    }
    var fallback = new Date(dateStr);
    if (Number.isNaN(fallback.getTime())) {
        throw new Error("Invalid date string: ".concat(dateStr));
    }
    return [
        fallback.getUTCFullYear(),
        fallback.getUTCMonth() + 1,
        fallback.getUTCDate(),
    ];
}
function getTimezoneOffsetMs(date, timezone) {
    var formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    var parts = formatter.formatToParts(date);
    var filled = {};
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var part = parts_1[_i];
        if (part.type !== 'literal') {
            filled[part.type] = part.value;
        }
    }
    var zonedTime = Date.UTC(Number(filled.year), Number(filled.month) - 1, Number(filled.day), Number(filled.hour), Number(filled.minute), Number(filled.second));
    return zonedTime - date.getTime();
}
