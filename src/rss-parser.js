"use strict";
/**
 * RSS Parser Module
 *
 * RSS/Atom feed parser using rss-parser library.
 * Provides feed parsing, validation, and error handling.
 * Supports HTTP proxy for accessing restricted feeds.
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
exports.RSSParserImpl = void 0;
exports.getRSSParser = getRSSParser;
exports.initRSSParser = initRSSParser;
var rss_parser_1 = require("rss-parser");
var logger_js_1 = require("./logger.js");
var log = logger_js_1.logger.child({ module: 'rss-parser' });
var HTTP_PROXY = process.env.HTTP_PROXY || null;
/**
 * RSS Parser implementation
 */
var RSSParserImpl = /** @class */ (function () {
    function RSSParserImpl() {
        // rss-parser uses node-fetch under the hood which doesn't support undici ProxyAgent
        // Proxy configuration should be handled via environment variables for node-fetch
        this.parser = new rss_parser_1.default({
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
            },
            customFields: {
                item: ['author', 'categories'],
            },
        });
    }
    /**
     * Parse RSS feed from URL
     * @param url - RSS feed URL
     * @returns Parse result with feed data or error
     */
    RSSParserImpl.prototype.parseFeed = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var startTime, feed, elapsed, error_1, elapsed, errorMessage;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        startTime = Date.now();
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        log.debug({ url: url, proxy: HTTP_PROXY ? 'enabled' : 'disabled' }, 'Parsing RSS feed');
                        return [4 /*yield*/, this.parser.parseURL(url)];
                    case 2:
                        feed = _a.sent();
                        elapsed = Date.now() - startTime;
                        log.info({ url: url, itemCount: feed.items.length, elapsed: "".concat(elapsed, "ms") }, 'RSS feed parsed successfully');
                        return [2 /*return*/, {
                                success: true,
                                feed: {
                                    title: feed.title || 'Untitled Feed',
                                    description: feed.description,
                                    link: feed.link,
                                    language: feed.language,
                                    lastBuildDate: feed.lastBuildDate,
                                    items: feed.items.map(function (item) {
                                        // Atom author may be an object with name property
                                        var authorValue;
                                        if (item.creator) {
                                            authorValue = item.creator;
                                        }
                                        else if (item.author) {
                                            if (typeof item.author === 'string') {
                                                authorValue = item.author;
                                            }
                                            else if (typeof item.author === 'object' && item.author.name) {
                                                authorValue = item.author.name;
                                            }
                                        }
                                        return {
                                            title: item.title || 'Untitled',
                                            link: item.link || '',
                                            // Atom uses <published>, RSS uses <pubDate>
                                            pubDate: item.pubDate || item.published || item.isoDate,
                                            content: item.content || item['content:encoded'] || item.summary,
                                            contentSnippet: item.contentSnippet,
                                            description: item.description || item.summary,
                                            // Atom uses <id>, RSS uses <guid>
                                            guid: item.guid || item.id,
                                            author: authorValue,
                                            categories: item.categories || [],
                                        };
                                    }),
                                },
                                itemCount: feed.items.length,
                                fetchTime: elapsed,
                            }];
                    case 3:
                        error_1 = _a.sent();
                        elapsed = Date.now() - startTime;
                        errorMessage = error_1 instanceof Error ? error_1.message : String(error_1);
                        log.error({ url: url, error: errorMessage, elapsed: "".concat(elapsed, "ms") }, 'Failed to parse RSS feed');
                        return [2 /*return*/, {
                                success: false,
                                error: errorMessage,
                                itemCount: 0,
                                fetchTime: elapsed,
                            }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Validate RSS source (quick check)
     * @param url - RSS feed URL to validate
     * @returns Validation result
     */
    RSSParserImpl.prototype.validateSource = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var result, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.parseFeed(url)];
                    case 1:
                        result = _a.sent();
                        if (result.success && result.feed) {
                            return [2 /*return*/, {
                                    valid: true,
                                    feedTitle: result.feed.title,
                                    itemCount: result.itemCount,
                                }];
                        }
                        return [2 /*return*/, {
                                valid: false,
                                error: result.error || 'Unknown error',
                            }];
                    case 2:
                        error_2 = _a.sent();
                        return [2 /*return*/, {
                                valid: false,
                                error: error_2 instanceof Error ? error_2.message : String(error_2),
                            }];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Parse RSS feed from raw XML string
     * @param xml - Raw XML string
     * @returns Parse result
     */
    RSSParserImpl.prototype.parseFromString = function (xml) {
        return __awaiter(this, void 0, void 0, function () {
            var startTime, feed, elapsed, error_3, elapsed, errorMessage;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        startTime = Date.now();
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        log.debug('Parsing RSS feed from string');
                        return [4 /*yield*/, this.parser.parseString(xml)];
                    case 2:
                        feed = _a.sent();
                        elapsed = Date.now() - startTime;
                        log.info({ itemCount: feed.items.length, elapsed: "".concat(elapsed, "ms") }, 'RSS feed parsed successfully from string');
                        return [2 /*return*/, {
                                success: true,
                                feed: {
                                    title: feed.title || 'Untitled Feed',
                                    description: feed.description,
                                    link: feed.link,
                                    items: feed.items.map(function (item) {
                                        // Atom author may be an object with name property
                                        var authorValue;
                                        if (item.creator) {
                                            authorValue = item.creator;
                                        }
                                        else if (item.author) {
                                            if (typeof item.author === 'string') {
                                                authorValue = item.author;
                                            }
                                            else if (typeof item.author === 'object' && item.author.name) {
                                                authorValue = item.author.name;
                                            }
                                        }
                                        return {
                                            title: item.title || 'Untitled',
                                            link: item.link || '',
                                            // Atom uses <published>, RSS uses <pubDate>
                                            pubDate: item.pubDate || item.published || item.isoDate,
                                            content: item.content || item['content:encoded'] || item.summary,
                                            contentSnippet: item.contentSnippet,
                                            description: item.description || item.summary,
                                            // Atom uses <id>, RSS uses <guid>
                                            guid: item.guid || item.id,
                                            author: authorValue,
                                            categories: item.categories || [],
                                        };
                                    }),
                                },
                                itemCount: feed.items.length,
                                fetchTime: elapsed,
                            }];
                    case 3:
                        error_3 = _a.sent();
                        elapsed = Date.now() - startTime;
                        errorMessage = error_3 instanceof Error ? error_3.message : String(error_3);
                        log.error({ error: errorMessage, elapsed: "".concat(elapsed, "ms") }, 'Failed to parse RSS feed from string');
                        return [2 /*return*/, {
                                success: false,
                                error: errorMessage,
                                itemCount: 0,
                                fetchTime: elapsed,
                            }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return RSSParserImpl;
}());
exports.RSSParserImpl = RSSParserImpl;
// Singleton instance
var _instance = null;
/**
 * Get RSS parser instance
 */
function getRSSParser() {
    if (!_instance) {
        _instance = new RSSParserImpl();
    }
    return _instance;
}
/**
 * Initialize RSS parser
 */
function initRSSParser() {
    return getRSSParser();
}
