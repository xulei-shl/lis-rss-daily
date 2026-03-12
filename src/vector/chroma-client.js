"use strict";
/**
 * Chroma Client Singleton
 *
 * Manages singleton Chroma client instances per user to avoid connection issues.
 * Each user gets their own cached client instance with collection caching.
 */
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
exports.ChromaConnectionError = void 0;
exports.getClient = getClient;
exports.getCollection = getCollection;
exports.closeClient = closeClient;
exports.closeAllClients = closeAllClients;
var chromadb_1 = require("chromadb");
var logger_js_1 = require("../logger.js");
var settings_js_1 = require("../api/settings.js");
var log = logger_js_1.logger.child({ module: 'chroma-client' });
/**
 * Chroma 连接错误
 * 提供清晰的连接失败提示
 */
var ChromaConnectionError = /** @class */ (function (_super) {
    __extends(ChromaConnectionError, _super);
    function ChromaConnectionError(host, port) {
        var _this = _super.call(this, "Chroma \u670D\u52A1\u4E0D\u53EF\u7528 (".concat(host, ":").concat(port, ")\u3002\u8BF7\u68C0\u67E5 Chroma \u670D\u52A1\u662F\u5426\u8FD0\u884C\uFF0C\u6216\u5728\"\u8BBE\u7F6E\"\u4E2D\u914D\u7F6E\u6B63\u786E\u7684 host \u548C port\u3002")) || this;
        _this.name = 'ChromaConnectionError';
        return _this;
    }
    return ChromaConnectionError;
}(Error));
exports.ChromaConnectionError = ChromaConnectionError;
// User-level client cache
var clientCache = new Map();
/**
 * Get or create a Chroma client for the user.
 */
function getClient(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var settings, baseUrl, cached, client;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, settings_js_1.getChromaSettings)(userId)];
                case 1:
                    settings = _a.sent();
                    baseUrl = "http://".concat(settings.host, ":").concat(settings.port);
                    // Reuse existing client if config unchanged
                    if (clientCache.has(userId)) {
                        cached = clientCache.get(userId);
                        if (cached.baseUrl === baseUrl) {
                            return [2 /*return*/, cached.client];
                        }
                        // Config changed, clear old cache
                        clientCache.delete(userId);
                    }
                    client = new chromadb_1.ChromaClient({ path: baseUrl });
                    clientCache.set(userId, {
                        client: client,
                        baseUrl: baseUrl,
                        collections: new Map(),
                    });
                    log.debug({ userId: userId, baseUrl: baseUrl }, 'Chroma client created');
                    return [2 /*return*/, client];
            }
        });
    });
}
/**
 * Get or create a collection for the user.
 */
function getCollection(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var client, settings, cache, cacheKey, collection, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getClient(userId)];
                case 1:
                    client = _a.sent();
                    return [4 /*yield*/, (0, settings_js_1.getChromaSettings)(userId)];
                case 2:
                    settings = _a.sent();
                    cache = clientCache.get(userId);
                    cacheKey = "".concat(settings.collection, ":").concat(settings.distanceMetric);
                    // Reuse existing collection
                    if (cache.collections.has(cacheKey)) {
                        return [2 /*return*/, {
                                collection: cache.collections.get(cacheKey),
                                settings: settings,
                            }];
                    }
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, client.getOrCreateCollection({
                            name: settings.collection,
                            metadata: { 'hnsw:space': settings.distanceMetric },
                        })];
                case 4:
                    collection = _a.sent();
                    cache.collections.set(cacheKey, collection);
                    return [2 /*return*/, { collection: collection, settings: settings }];
                case 5:
                    error_1 = _a.sent();
                    // 捕获连接错误，转换为更有用的错误信息
                    throw new ChromaConnectionError(settings.host, settings.port);
                case 6: return [2 /*return*/];
            }
        });
    });
}
/**
 * Close and remove a user's Chroma client.
 */
function closeClient(userId) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            if (clientCache.has(userId)) {
                clientCache.delete(userId);
                log.debug({ userId: userId }, 'Chroma client closed');
            }
            return [2 /*return*/];
        });
    });
}
/**
 * Close all Chroma clients (useful for testing/shutdown).
 */
function closeAllClients() {
    return __awaiter(this, void 0, void 0, function () {
        var count;
        return __generator(this, function (_a) {
            count = clientCache.size;
            clientCache.clear();
            log.debug({ count: count }, 'All Chroma clients closed');
            return [2 /*return*/];
        });
    });
}
