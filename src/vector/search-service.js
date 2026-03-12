"use strict";
/**
 * Unified Search Service
 *
 * Provides a single entry point for all search operations:
 * - Semantic search (vector similarity)
 * - Keyword search (SQL LIKE)
 * - Hybrid search (semantic + keyword fusion)
 * - Related articles (with caching)
 *
 * Includes automatic fallback to keyword search when semantic search fails.
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchMode = void 0;
exports.search = search;
var db_js_1 = require("../db.js");
var logger_js_1 = require("../logger.js");
var embedding_client_js_1 = require("./embedding-client.js");
var vector_store_js_1 = require("./vector-store.js");
var reranker_js_1 = require("./reranker.js");
var text_builder_js_1 = require("./text-builder.js");
var log = logger_js_1.logger.child({ module: 'search-service' });
/* ── Public Types ── */
var SearchMode;
(function (SearchMode) {
    SearchMode["SEMANTIC"] = "semantic";
    SearchMode["KEYWORD"] = "keyword";
    SearchMode["HYBRID"] = "hybrid";
    SearchMode["RELATED"] = "related";
})(SearchMode || (exports.SearchMode = SearchMode = {}));
/* ── Configuration ── */
var DEFAULT_LIMIT = 50; // Increased from 10 to show more results
var MAX_RESULTS = 100; // Maximum results to fetch from vector DB (optimized for performance)
var DEFAULT_SEMANTIC_WEIGHT = 0.7;
var DEFAULT_KEYWORD_WEIGHT = 0.3;
/* ── Main Search Entry ── */
/**
 * Unified search entry point.
 */
function search(request) {
    return __awaiter(this, void 0, void 0, function () {
        var mode, userId, query, articleId, _a, limit, _b, offset, _c, semanticWeight, _d, keywordWeight, _e, normalizeScores, _f, useCache, _g, refreshCache, _h, fallbackEnabled, effectiveQuery, startTime, results, fallback, _j, hybridResult, duration, error_1;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    mode = request.mode, userId = request.userId, query = request.query, articleId = request.articleId, _a = request.limit, limit = _a === void 0 ? DEFAULT_LIMIT : _a, _b = request.offset, offset = _b === void 0 ? 0 : _b, _c = request.semanticWeight, semanticWeight = _c === void 0 ? DEFAULT_SEMANTIC_WEIGHT : _c, _d = request.keywordWeight, keywordWeight = _d === void 0 ? DEFAULT_KEYWORD_WEIGHT : _d, _e = request.normalizeScores, normalizeScores = _e === void 0 ? true : _e, _f = request.useCache, useCache = _f === void 0 ? true : _f, _g = request.refreshCache, refreshCache = _g === void 0 ? false : _g, _h = request.fallbackEnabled, fallbackEnabled = _h === void 0 ? true : _h;
                    // Validate parameters
                    if (mode === SearchMode.RELATED && !articleId) {
                        throw new Error('articleId is required for RELATED mode');
                    }
                    if ((mode === SearchMode.SEMANTIC || mode === SearchMode.HYBRID || mode === SearchMode.KEYWORD) && !query) {
                        throw new Error('query is required for search modes');
                    }
                    // Related articles with cache
                    if (mode === SearchMode.RELATED) {
                        return [2 /*return*/, searchRelated(userId, articleId, limit, useCache && !refreshCache)];
                    }
                    effectiveQuery = query.trim();
                    startTime = Date.now();
                    _k.label = 1;
                case 1:
                    _k.trys.push([1, 10, , 11]);
                    results = void 0;
                    fallback = false;
                    _j = mode;
                    switch (_j) {
                        case SearchMode.SEMANTIC: return [3 /*break*/, 2];
                        case SearchMode.KEYWORD: return [3 /*break*/, 4];
                        case SearchMode.HYBRID: return [3 /*break*/, 6];
                    }
                    return [3 /*break*/, 8];
                case 2: return [4 /*yield*/, semanticSearchOnly(userId, effectiveQuery, limit)];
                case 3:
                    results = _k.sent();
                    return [3 /*break*/, 9];
                case 4: return [4 /*yield*/, keywordSearchOnly(userId, effectiveQuery, limit)];
                case 5:
                    results = _k.sent();
                    return [3 /*break*/, 9];
                case 6: return [4 /*yield*/, hybridSearch(userId, effectiveQuery, limit, semanticWeight, keywordWeight, normalizeScores, fallbackEnabled)];
                case 7:
                    hybridResult = _k.sent();
                    results = hybridResult.results;
                    fallback = hybridResult.fallback;
                    return [3 /*break*/, 9];
                case 8: throw new Error("Unsupported search mode: ".concat(mode));
                case 9:
                    duration = Date.now() - startTime;
                    log.info({ userId: userId, mode: mode, query: effectiveQuery, resultCount: results.length, duration: duration, fallback: fallback }, 'Search completed');
                    return [2 /*return*/, {
                            results: results.slice(offset, offset + limit),
                            mode: mode,
                            query: effectiveQuery,
                            total: results.length,
                            page: Math.floor(offset / limit) + 1,
                            limit: limit,
                            cached: false,
                            fallback: fallback,
                        }];
                case 10:
                    error_1 = _k.sent();
                    log.warn({ error: error_1, userId: userId, mode: mode, query: effectiveQuery }, 'Search failed, returning empty results');
                    return [2 /*return*/, {
                            results: [],
                            mode: mode,
                            query: effectiveQuery,
                            total: 0,
                            page: 1,
                            limit: limit,
                            cached: false,
                            fallback: false,
                        }];
                case 11: return [2 /*return*/];
            }
        });
    });
}
/* ── Semantic Search Only ── */
function semanticSearchOnly(userId, query, limit) {
    return __awaiter(this, void 0, void 0, function () {
        var embedding, hits, candidates, finalList, rerankResults;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, embedding_client_js_1.getEmbedding)(query, userId)];
                case 1:
                    embedding = _a.sent();
                    return [4 /*yield*/, (0, vector_store_js_1.query)(userId, embedding, MAX_RESULTS, {
                            user_id: userId,
                        })];
                case 2:
                    hits = _a.sent();
                    candidates = hits
                        .filter(function (hit) { return Number.isFinite(hit.articleId) && hit.articleId > 0; })
                        .map(function (hit) { return ({
                        articleId: hit.articleId,
                        score: hit.score,
                        document: hit.document,
                    }); });
                    finalList = candidates;
                    if (!(candidates.length > 0)) return [3 /*break*/, 4];
                    return [4 /*yield*/, (0, reranker_js_1.rerank)(query, candidates.map(function (c) { return c.document; }), userId, Math.min(MAX_RESULTS, candidates.length))];
                case 3:
                    rerankResults = _a.sent();
                    if (rerankResults) {
                        finalList = applyRerank(candidates, rerankResults, MAX_RESULTS);
                    }
                    _a.label = 4;
                case 4: return [4 /*yield*/, enrichWithMetadata(userId, finalList)];
                case 5: return [2 /*return*/, _a.sent()];
            }
        });
    });
}
/* ── Keyword Search Only ── */
function keywordSearchOnly(userId_1, query_1, limit_1) {
    return __awaiter(this, arguments, void 0, function (userId, query, limit, includeRejected // 默认包含未通过的文章
    ) {
        var db, lowerQuery, terms, calcRelevance, queryBuilder, articles;
        if (includeRejected === void 0) { includeRejected = true; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    lowerQuery = query.toLowerCase();
                    terms = query.trim().split(/\s+/).filter(function (t) { return t.length > 0; });
                    calcRelevance = function (title) {
                        var score = 0;
                        var safeTitle = title.toLowerCase();
                        if (safeTitle.includes(lowerQuery))
                            score += 0.7;
                        if (safeTitle.startsWith(lowerQuery))
                            score += 0.3;
                        return Math.min(score, 1);
                    };
                    queryBuilder = db
                        .selectFrom('articles')
                        .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                        .leftJoin('journals', 'journals.id', 'articles.journal_id')
                        .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                        .where(function (eb) {
                        return eb.or([
                            eb('rss_sources.user_id', '=', userId),
                            eb('journals.user_id', '=', userId),
                            eb('keyword_subscriptions.user_id', '=', userId),
                        ]);
                    });
                    // 只有当 includeRejected 为 false 时才过滤只返回 passed 的文章
                    if (!includeRejected) {
                        queryBuilder = queryBuilder.where('articles.filter_status', '=', 'passed');
                    }
                    if (terms.length > 0) {
                        queryBuilder = queryBuilder.where(function (eb) {
                            return eb.and(terms.map(function (term) {
                                var pattern = "%".concat(term, "%");
                                return eb.or([
                                    eb('articles.title', 'like', pattern),
                                    eb('articles.markdown_content', 'like', pattern),
                                ]);
                            }));
                        });
                    }
                    return [4 /*yield*/, queryBuilder
                            .select([
                            'articles.id',
                            'articles.title',
                            'articles.url',
                            'articles.published_at',
                            'articles.source_origin',
                            'rss_sources.name as rss_source_name',
                            'journals.name as journal_name',
                            'keyword_subscriptions.keyword as keyword_name',
                        ])
                            .orderBy('articles.published_at', 'desc')
                            .limit(MAX_RESULTS)
                            .execute()];
                case 1:
                    articles = _a.sent();
                    return [2 /*return*/, articles
                            .map(function (article) {
                            var _a, _b, _c;
                            return ({
                                articleId: article.id,
                                score: calcRelevance(article.title),
                                keywordScore: calcRelevance(article.title),
                                metadata: {
                                    title: article.title,
                                    url: article.url,
                                    summary: null,
                                    published_at: article.published_at,
                                    source_origin: article.source_origin,
                                    rss_source_name: (_a = article.rss_source_name) !== null && _a !== void 0 ? _a : undefined,
                                    journal_name: (_b = article.journal_name) !== null && _b !== void 0 ? _b : undefined,
                                    keyword_name: (_c = article.keyword_name) !== null && _c !== void 0 ? _c : undefined,
                                },
                            });
                        })
                            .sort(function (a, b) { return b.score - a.score; })];
            }
        });
    });
}
function hybridSearch(userId, query, limit, semanticWeight, keywordWeight, normalizeScores, fallbackEnabled) {
    return __awaiter(this, void 0, void 0, function () {
        var semanticResults, semanticFailed, error_2, keywordResults, mergedByArticleId, _i, semanticResults_1, result, _a, keywordResults_1, result, existing, kwScore, semScore, finalScore, maxSemScore, normalizedSem, results;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    semanticResults = [];
                    semanticFailed = false;
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, semanticSearchOnly(userId, query, limit)];
                case 2:
                    semanticResults = _d.sent();
                    return [3 /*break*/, 4];
                case 3:
                    error_2 = _d.sent();
                    semanticFailed = true;
                    log.warn({ error: error_2, query: query }, 'Semantic search failed in hybrid mode');
                    return [3 /*break*/, 4];
                case 4: return [4 /*yield*/, keywordSearchOnly(userId, query, limit)];
                case 5:
                    keywordResults = _d.sent();
                    // Fallback: if semantic failed and fallback enabled, return keyword-only
                    if (semanticFailed && semanticResults.length === 0) {
                        if (fallbackEnabled) {
                            log.info({ query: query, count: keywordResults.length }, 'Using keyword-only results (fallback)');
                            return [2 /*return*/, { results: keywordResults, fallback: true }];
                        }
                        // If fallback disabled, throw the original error
                        throw new Error('Semantic search failed and fallback is disabled');
                    }
                    mergedByArticleId = new Map();
                    // Add semantic results
                    for (_i = 0, semanticResults_1 = semanticResults; _i < semanticResults_1.length; _i++) {
                        result = semanticResults_1[_i];
                        mergedByArticleId.set(result.articleId, __assign(__assign({}, result), { semanticScore: result.score }));
                    }
                    // Merge keyword results
                    for (_a = 0, keywordResults_1 = keywordResults; _a < keywordResults_1.length; _a++) {
                        result = keywordResults_1[_a];
                        existing = mergedByArticleId.get(result.articleId);
                        if (existing) {
                            kwScore = (_b = result.keywordScore) !== null && _b !== void 0 ? _b : result.score;
                            semScore = (_c = existing.semanticScore) !== null && _c !== void 0 ? _c : existing.score;
                            finalScore = void 0;
                            if (normalizeScores) {
                                maxSemScore = Math.max.apply(Math, __spreadArray(__spreadArray([], semanticResults.map(function (r) { var _a; return (_a = r.semanticScore) !== null && _a !== void 0 ? _a : r.score; }), false), [0.01], false));
                                normalizedSem = semScore / maxSemScore;
                                finalScore = normalizedSem * semanticWeight + kwScore * keywordWeight;
                            }
                            else {
                                // No normalization (related articles behavior)
                                finalScore = semScore * semanticWeight + kwScore * keywordWeight;
                            }
                            mergedByArticleId.set(result.articleId, __assign(__assign({}, existing), { score: finalScore, keywordScore: kwScore }));
                        }
                        else {
                            // Keyword-only result
                            mergedByArticleId.set(result.articleId, __assign(__assign({}, result), { keywordScore: result.score }));
                        }
                    }
                    results = Array.from(mergedByArticleId.values())
                        .sort(function (a, b) { return b.score - a.score; });
                    return [2 /*return*/, { results: results, fallback: false }];
            }
        });
    });
}
/* ── Related Articles Search ── */
function searchRelated(userId, articleId, limit, useCache) {
    return __awaiter(this, void 0, void 0, function () {
        var cached, computed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!useCache) return [3 /*break*/, 2];
                    return [4 /*yield*/, getRelatedFromCache(userId, articleId, limit)];
                case 1:
                    cached = _a.sent();
                    if (cached.length > 0) {
                        return [2 /*return*/, {
                                results: cached,
                                mode: SearchMode.RELATED,
                                total: cached.length,
                                limit: limit,
                                cached: true,
                            }];
                    }
                    _a.label = 2;
                case 2: return [4 /*yield*/, computeRelated(userId, articleId, limit)];
                case 3:
                    computed = _a.sent();
                    // Save cache asynchronously
                    saveRelatedToCache(articleId, computed).catch(function (error) {
                        log.warn({ error: error, articleId: articleId }, 'Failed to save related articles cache');
                    });
                    return [2 /*return*/, {
                            results: computed,
                            mode: SearchMode.RELATED,
                            total: computed.length,
                            limit: limit,
                            cached: false,
                        }];
            }
        });
    });
}
function computeRelated(userId, articleId, limit) {
    return __awaiter(this, void 0, void 0, function () {
        var db, article, text, embedding, semanticHits, semanticResults, highScoreArticles, effectiveLimit, topResults, topIds, rows, scoreLookup, semScoreLookup;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('articles')
                            .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                            .leftJoin('journals', 'journals.id', 'articles.journal_id')
                            .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                            .where('articles.id', '=', articleId)
                            .where(function (eb) {
                            return eb.or([
                                eb('rss_sources.user_id', '=', userId),
                                eb('journals.user_id', '=', userId),
                                eb('keyword_subscriptions.user_id', '=', userId),
                            ]);
                        })
                            .select([
                            'articles.id',
                            'articles.title',
                            'articles.content',
                            'articles.markdown_content',
                        ])
                            .executeTakeFirst()];
                case 1:
                    article = _a.sent();
                    if (!article)
                        return [2 /*return*/, []];
                    text = (0, text_builder_js_1.buildVectorText)(article);
                    if (!text)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, (0, embedding_client_js_1.getEmbedding)(text, userId)];
                case 2:
                    embedding = _a.sent();
                    return [4 /*yield*/, (0, vector_store_js_1.query)(userId, embedding, Math.max(limit * 3, limit), {
                            user_id: userId,
                        })];
                case 3:
                    semanticHits = _a.sent();
                    semanticResults = semanticHits
                        .filter(function (hit) { return hit.articleId && hit.articleId !== articleId; })
                        .map(function (hit) { return ({
                        articleId: hit.articleId,
                        finalScore: hit.score,
                        semanticScore: hit.score,
                    }); });
                    if (semanticResults.length === 0)
                        return [2 /*return*/, []];
                    // Sort by score descending
                    semanticResults.sort(function (a, b) { return b.finalScore - a.finalScore; });
                    highScoreArticles = semanticResults.filter(function (r) { return r.finalScore > 0.6; });
                    effectiveLimit = highScoreArticles.length >= 3 ? Math.min(limit, 5) : Math.min(limit, 3);
                    topResults = highScoreArticles.length >= effectiveLimit
                        ? highScoreArticles.slice(0, effectiveLimit)
                        : semanticResults.slice(0, effectiveLimit);
                    topIds = topResults.map(function (item) { return item.articleId; });
                    if (topIds.length === 0)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, db
                            .selectFrom('articles')
                            .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                            .leftJoin('journals', 'journals.id', 'articles.journal_id')
                            .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                            .where(function (eb) {
                            return eb.or([
                                eb('rss_sources.user_id', '=', userId),
                                eb('journals.user_id', '=', userId),
                                eb('keyword_subscriptions.user_id', '=', userId),
                            ]);
                        })
                            .where('articles.filter_status', '=', 'passed')
                            .where('articles.process_status', '=', 'completed')
                            .where('articles.id', 'in', topIds)
                            .select([
                            'articles.id',
                            'articles.title',
                            'articles.url',
                            'articles.published_at',
                            'articles.source_origin',
                            'rss_sources.name as rss_source_name',
                            'journals.name as journal_name',
                            'keyword_subscriptions.keyword as keyword_name',
                        ])
                            .execute()];
                case 4:
                    rows = _a.sent();
                    scoreLookup = new Map(topResults.map(function (item) { return [item.articleId, item.finalScore]; }));
                    semScoreLookup = new Map(topResults.map(function (item) { return [item.articleId, item.semanticScore]; }));
                    return [2 /*return*/, rows
                            .map(function (row) {
                            var _a, _b, _c, _d;
                            return ({
                                articleId: row.id,
                                score: Number((_a = scoreLookup.get(row.id)) !== null && _a !== void 0 ? _a : 0),
                                semanticScore: semScoreLookup.get(row.id),
                                keywordScore: undefined,
                                metadata: {
                                    title: row.title,
                                    url: row.url,
                                    summary: null,
                                    published_at: row.published_at,
                                    source_origin: row.source_origin,
                                    rss_source_name: (_b = row.rss_source_name) !== null && _b !== void 0 ? _b : undefined,
                                    journal_name: (_c = row.journal_name) !== null && _c !== void 0 ? _c : undefined,
                                    keyword_name: (_d = row.keyword_name) !== null && _d !== void 0 ? _d : undefined,
                                },
                            });
                        })
                            .filter(function (row) { return row.articleId !== articleId; })
                            .sort(function (a, b) {
                            var _a, _b;
                            if (b.score !== a.score)
                                return b.score - a.score;
                            var aTime = ((_a = a.metadata) === null || _a === void 0 ? void 0 : _a.published_at) ? Date.parse(a.metadata.published_at) : 0;
                            var bTime = ((_b = b.metadata) === null || _b === void 0 ? void 0 : _b.published_at) ? Date.parse(b.metadata.published_at) : 0;
                            return bTime - aTime;
                        })
                            .slice(0, effectiveLimit)];
            }
        });
    });
}
function getRelatedFromCache(userId, articleId, limit) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('article_related as ar')
                            .innerJoin('articles', 'articles.id', 'ar.related_article_id')
                            .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                            .leftJoin('journals', 'journals.id', 'articles.journal_id')
                            .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                            .where('ar.article_id', '=', articleId)
                            .where(function (eb) {
                            return eb.or([
                                eb('rss_sources.user_id', '=', userId),
                                eb('journals.user_id', '=', userId),
                                eb('keyword_subscriptions.user_id', '=', userId),
                            ]);
                        })
                            .where('articles.filter_status', '=', 'passed')
                            .where('articles.process_status', '=', 'completed')
                            .select([
                            'articles.id',
                            'articles.title',
                            'articles.url',
                            'articles.published_at',
                            'articles.source_origin',
                            'rss_sources.name as rss_source_name',
                            'journals.name as journal_name',
                            'keyword_subscriptions.keyword as keyword_name',
                            'ar.score as score',
                        ])
                            .orderBy('ar.score', 'desc')
                            .orderBy('articles.published_at', 'desc')
                            .limit(limit)
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(function (row) {
                            var _a, _b, _c, _d;
                            return ({
                                articleId: row.id,
                                score: Number((_a = row.score) !== null && _a !== void 0 ? _a : 0),
                                metadata: {
                                    title: row.title,
                                    url: row.url,
                                    summary: null,
                                    published_at: row.published_at,
                                    source_origin: row.source_origin,
                                    rss_source_name: (_b = row.rss_source_name) !== null && _b !== void 0 ? _b : undefined,
                                    journal_name: (_c = row.journal_name) !== null && _c !== void 0 ? _c : undefined,
                                    keyword_name: (_d = row.keyword_name) !== null && _d !== void 0 ? _d : undefined,
                                },
                            });
                        })];
            }
        });
    });
}
function saveRelatedToCache(articleId, results) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    return [4 /*yield*/, db.transaction().execute(function (trx) { return __awaiter(_this, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, trx.deleteFrom('article_related').where('article_id', '=', articleId).execute()];
                                    case 1:
                                        _a.sent();
                                        if (results.length === 0)
                                            return [2 /*return*/];
                                        return [4 /*yield*/, trx
                                                .insertInto('article_related')
                                                .values(results.map(function (item) { return ({
                                                article_id: articleId,
                                                related_article_id: item.articleId,
                                                score: item.score,
                                                created_at: now,
                                                updated_at: now,
                                            }); }))
                                                .execute()];
                                    case 2:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/* ── Utility Functions ── */
function enrichWithMetadata(userId, results) {
    return __awaiter(this, void 0, void 0, function () {
        var ids, db, articles, articleMap;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (results.length === 0)
                        return [2 /*return*/, []];
                    ids = results.map(function (r) { return r.articleId; });
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('articles')
                            .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                            .leftJoin('journals', 'journals.id', 'articles.journal_id')
                            .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                            .where(function (eb) {
                            return eb.or([
                                eb('rss_sources.user_id', '=', userId),
                                eb('journals.user_id', '=', userId),
                                eb('keyword_subscriptions.user_id', '=', userId),
                            ]);
                        })
                            .where('articles.filter_status', '=', 'passed')
                            .where('articles.id', 'in', ids)
                            .select([
                            'articles.id',
                            'articles.title',
                            'articles.url',
                            'articles.published_at',
                            'articles.source_origin',
                            'rss_sources.name as rss_source_name',
                            'journals.name as journal_name',
                            'keyword_subscriptions.keyword as keyword_name',
                        ])
                            .execute()];
                case 1:
                    articles = _a.sent();
                    articleMap = new Map(articles.map(function (a) { return [a.id, a]; }));
                    return [2 /*return*/, results
                            .filter(function (r) { return articleMap.has(r.articleId); })
                            .map(function (r) {
                            var _a, _b, _c;
                            var article = articleMap.get(r.articleId);
                            return {
                                articleId: r.articleId,
                                score: r.score,
                                metadata: {
                                    title: article.title,
                                    url: article.url,
                                    summary: null,
                                    published_at: article.published_at,
                                    source_origin: article.source_origin,
                                    rss_source_name: (_a = article.rss_source_name) !== null && _a !== void 0 ? _a : undefined,
                                    journal_name: (_b = article.journal_name) !== null && _b !== void 0 ? _b : undefined,
                                    keyword_name: (_c = article.keyword_name) !== null && _c !== void 0 ? _c : undefined,
                                },
                            };
                        })];
            }
        });
    });
}
function applyRerank(candidates, rerankResults, limit) {
    if (rerankResults.length === 0)
        return candidates.slice(0, limit);
    var picked = new Set();
    var reordered = [];
    for (var _i = 0, rerankResults_1 = rerankResults; _i < rerankResults_1.length; _i++) {
        var item = rerankResults_1[_i];
        var idx = item.index;
        if (!Number.isFinite(idx) || idx < 0 || idx >= candidates.length)
            continue;
        picked.add(idx);
        reordered.push(__assign(__assign({}, candidates[idx]), { score: item.score }));
    }
    for (var i = 0; i < candidates.length; i++) {
        if (picked.has(i))
            continue;
        reordered.push(candidates[i]);
    }
    return reordered.slice(0, limit);
}
