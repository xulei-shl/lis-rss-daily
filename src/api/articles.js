"use strict";
/**
 * Articles CRUD Service
 *
 * Database operations for article management.
 * Provides article storage with URL deduplication.
 */
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveArticles = saveArticles;
exports.checkArticlesExistByTitle = checkArticlesExistByTitle;
exports.checkArticlesExistByURL = checkArticlesExistByURL;
exports.getArticleById = getArticleById;
exports.getArticleFilterMatches = getArticleFilterMatches;
exports.getArticleTranslation = getArticleTranslation;
exports.upsertArticleTranslation = upsertArticleTranslation;
exports.getUserArticles = getUserArticles;
exports.batchUpdateFilterStatus = batchUpdateFilterStatus;
exports.updateArticleProcessStatus = updateArticleProcessStatus;
exports.deleteArticle = deleteArticle;
exports.getRelatedArticles = getRelatedArticles;
exports.refreshRelatedArticles = refreshRelatedArticles;
exports.updateArticleReadStatus = updateArticleReadStatus;
exports.batchUpdateArticleReadStatus = batchUpdateArticleReadStatus;
exports.markAllAsRead = markAllAsRead;
exports.getUnreadCount = getUnreadCount;
exports.getMergedSources = getMergedSources;
exports.updateArticleRating = updateArticleRating;
exports.updateArticleAiSummary = updateArticleAiSummary;
var db_js_1 = require("../db.js");
var kysely_1 = require("kysely");
var logger_js_1 = require("../logger.js");
var markdown_js_1 = require("../utils/markdown.js");
var title_js_1 = require("../utils/title.js");
var search_js_1 = require("../vector/search.js");
var timezone_js_1 = require("./timezone.js");
var datetime_js_1 = require("../utils/datetime.js");
var log = logger_js_1.logger.child({ module: 'articles-service' });
var ARTICLE_DATE_FIELDS = [
    'created_at',
    'updated_at',
    'filtered_at',
    'processed_at',
    'published_at',
];
function normalizeArticleDates(article) {
    if (!article)
        return article;
    (0, datetime_js_1.normalizeDateFields)(article, ARTICLE_DATE_FIELDS);
    return article;
}
function buildIdList(list, single) {
    var values = [];
    if (Array.isArray(list)) {
        for (var _i = 0, list_1 = list; _i < list_1.length; _i++) {
            var id = list_1[_i];
            if (typeof id === 'number' && !Number.isNaN(id)) {
                values.push(id);
            }
        }
    }
    if (typeof single === 'number' && !Number.isNaN(single)) {
        values.push(single);
    }
    var unique = Array.from(new Set(values));
    return unique.length > 0 ? unique : undefined;
}
/**
 * Batch save articles
 * @param rssSourceId - RSS source ID
 * @param items - RSS feed items
 * @returns Number of saved articles and array of saved article IDs
 */
function saveArticles(rssSourceId, items) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now, savedArticleIds, _i, items_1, item, titleNormalized, exists, rawContent, markdown, result, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    savedArticleIds = [];
                    _i = 0, items_1 = items;
                    _a.label = 1;
                case 1:
                    if (!(_i < items_1.length)) return [3 /*break*/, 8];
                    item = items_1[_i];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 6, , 7]);
                    // Validate required fields
                    if (!item.title || !item.title.trim()) {
                        log.warn({ rssSourceId: rssSourceId, url: item.link }, 'Article missing title, skipping');
                        return [3 /*break*/, 7];
                    }
                    titleNormalized = (0, title_js_1.generateNormalizedTitle)(item.title);
                    if (!titleNormalized) return [3 /*break*/, 4];
                    return [4 /*yield*/, db
                            .selectFrom('articles')
                            .where('title_normalized', '=', titleNormalized)
                            .select('id')
                            .executeTakeFirst()];
                case 3:
                    exists = _a.sent();
                    if (exists) {
                        log.debug({ rssSourceId: rssSourceId, title: item.title, url: item.link, existingId: exists.id }, 'Article title already exists, skipping');
                        return [3 /*break*/, 7];
                    }
                    _a.label = 4;
                case 4:
                    rawContent = chooseBestContent([
                        item.content,
                        item.description,
                        item.contentSnippet,
                    ]);
                    markdown = (0, markdown_js_1.toSimpleMarkdown)(rawContent);
                    return [4 /*yield*/, db
                            .insertInto('articles')
                            .values({
                            rss_source_id: rssSourceId,
                            title: item.title,
                            title_normalized: titleNormalized,
                            url: item.link,
                            // RSS 入库阶段不生成摘要（由后续 AI 分析生成）
                            summary: null,
                            // content 保存原始 RSS 文本，markdown_content 保存清洗后的 Markdown
                            content: rawContent || null,
                            markdown_content: markdown || null,
                            filter_status: 'pending',
                            process_status: 'pending',
                            created_at: now,
                            published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
                            is_read: 0,
                            source_origin: 'rss',
                            updated_at: now,
                        })
                            .returning('id')
                            .executeTakeFirst()];
                case 5:
                    result = _a.sent();
                    if (result) {
                        savedArticleIds.push(result.id);
                    }
                    else {
                        log.warn({ rssSourceId: rssSourceId, url: item.link }, 'Failed to get inserted article ID');
                    }
                    return [3 /*break*/, 7];
                case 6:
                    error_1 = _a.sent();
                    // Check if this is a UNIQUE constraint error on URL
                    if (error_1 && typeof error_1 === 'object' && 'code' in error_1 && error_1.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                        // URL already exists in a different RSS source - this is expected for cross-source duplicates
                        log.debug({ rssSourceId: rssSourceId, url: item.link, title: item.title }, 'Article URL exists in another RSS source, skipping');
                        return [3 /*break*/, 7];
                    }
                    // Log other errors
                    log.error({ error: error_1, rssSourceId: rssSourceId, url: item.link }, 'Failed to save article');
                    return [3 /*break*/, 7];
                case 7:
                    _i++;
                    return [3 /*break*/, 1];
                case 8:
                    if (savedArticleIds.length > 0) {
                        log.info({ rssSourceId: rssSourceId, savedCount: savedArticleIds.length, totalItems: items.length }, 'Articles saved');
                    }
                    return [2 /*return*/, { count: savedArticleIds.length, articleIds: savedArticleIds }];
            }
        });
    });
}
/**
 * 选择最有价值的内容来源（优先更长且更丰富的文本）
 */
function chooseBestContent(candidates) {
    var cleaned = candidates
        .filter(function (c) { return typeof c === 'string' && c.trim().length > 0; })
        .map(function (c) { return c.trim(); });
    if (cleaned.length === 0)
        return '';
    var best = cleaned[0];
    var bestScore = scoreContent(best);
    for (var _i = 0, _a = cleaned.slice(1); _i < _a.length; _i++) {
        var content = _a[_i];
        var score = scoreContent(content);
        if (score > bestScore) {
            best = content;
            bestScore = score;
        }
    }
    return best;
}
/**
 * 简单评分：正文长度 + 去标签长度
 */
function scoreContent(content) {
    var textOnly = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    var lengthScore = textOnly.length;
    var rawScore = content.length * 0.1;
    return lengthScore + rawScore;
}
/**
 * Batch check if articles exist by (rss_source_id, title) combination
 * @param rssSourceId - RSS source ID
 * @param titles - Article titles to check
 * @returns Set of existing titles within this RSS source
 */
function checkArticlesExistByTitle(rssSourceId, titles) {
    return __awaiter(this, void 0, void 0, function () {
        var db, existing;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (titles.length === 0) {
                        return [2 /*return*/, new Set()];
                    }
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('articles')
                            .where('rss_source_id', '=', rssSourceId)
                            .where('title', 'in', titles)
                            .select('title')
                            .execute()];
                case 1:
                    existing = _a.sent();
                    return [2 /*return*/, new Set(existing.map(function (e) { return e.title; }))];
            }
        });
    });
}
/**
 * Batch check if articles exist by URL (fallback method)
 * @param urls - Article URLs
 * @returns Set of existing URLs
 */
function checkArticlesExistByURL(urls) {
    return __awaiter(this, void 0, void 0, function () {
        var db, existing;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (urls.length === 0) {
                        return [2 /*return*/, new Set()];
                    }
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('articles')
                            .where('url', 'in', urls)
                            .select('url')
                            .execute()];
                case 1:
                    existing = _a.sent();
                    return [2 /*return*/, new Set(existing.map(function (e) { return e.url; }))];
            }
        });
    });
}
/**
 * Get article by ID
 * @param id - Article ID
 * @param userId - User ID (for permission check)
 */
function getArticleById(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, article, merged;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('articles')
                            .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                            .leftJoin('journals', 'journals.id', 'articles.journal_id')
                            .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                            .leftJoin('article_translations', 'article_translations.article_id', 'articles.id')
                            .where('articles.id', '=', id)
                            .where(function (eb) { return eb.or([
                            eb.and([
                                eb('articles.rss_source_id', 'is not', null),
                                eb('rss_sources.user_id', '=', userId),
                            ]),
                            eb.and([
                                eb('articles.journal_id', 'is not', null),
                                eb('journals.user_id', '=', userId),
                            ]),
                            eb.and([
                                eb('articles.keyword_id', 'is not', null),
                                eb('keyword_subscriptions.user_id', '=', userId),
                            ]),
                        ]); })
                            .select([
                            'articles.id',
                            'articles.rss_source_id',
                            'articles.journal_id',
                            'articles.keyword_id',
                            'articles.title',
                            'articles.url',
                            'articles.summary',
                            'articles.ai_summary',
                            'articles.content',
                            'articles.markdown_content',
                            'article_translations.summary_zh',
                            'articles.filter_status',
                            'articles.filter_score',
                            'articles.filtered_at',
                            'articles.process_status',
                            'articles.processed_at',
                            'articles.published_at',
                            'articles.published_year',
                            'articles.published_issue',
                            'articles.published_volume',
                            'articles.error_message',
                            'articles.is_read',
                            'articles.source_origin',
                            'articles.rating',
                            'articles.created_at',
                            'articles.updated_at',
                            'rss_sources.name as rss_source_name',
                            'journals.name as journal_name',
                            'keyword_subscriptions.keyword as keyword_name',
                        ])
                            .executeTakeFirst()];
                case 1:
                    article = _a.sent();
                    if (!article)
                        return [2 /*return*/, undefined];
                    merged = __assign(__assign({}, article), { source_name: article.journal_name || article.rss_source_name || article.keyword_name || 'Unknown' });
                    normalizeArticleDates(merged);
                    return [2 /*return*/, merged];
            }
        });
    });
}
/**
 * 获取过滤匹配结果（含原因）
 */
function getArticleFilterMatches(articleId, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, rows;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('article_filter_logs')
                            .innerJoin('articles', 'articles.id', 'article_filter_logs.article_id')
                            .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                            .leftJoin('journals', 'journals.id', 'articles.journal_id')
                            .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                            .leftJoin('topic_domains', 'topic_domains.id', 'article_filter_logs.domain_id')
                            .where('article_filter_logs.article_id', '=', articleId)
                            .where(function (eb) { return eb.or([
                            eb.and([
                                eb('articles.rss_source_id', 'is not', null),
                                eb('rss_sources.user_id', '=', userId),
                            ]),
                            eb.and([
                                eb('articles.journal_id', 'is not', null),
                                eb('journals.user_id', '=', userId),
                            ]),
                            eb.and([
                                eb('articles.keyword_id', 'is not', null),
                                eb('keyword_subscriptions.user_id', '=', userId),
                            ]),
                        ]); })
                            .where('article_filter_logs.is_passed', '=', 1)
                            .select([
                            'article_filter_logs.domain_id as domainId',
                            'topic_domains.name as domainName',
                            'article_filter_logs.is_passed as isPassed',
                            'article_filter_logs.relevance_score as relevanceScore',
                            'article_filter_logs.filter_reason as filterReason',
                        ])
                            .orderBy('article_filter_logs.id', 'asc')
                            .execute()];
                case 1:
                    rows = _a.sent();
                    return [2 /*return*/, rows.map(function (row) {
                            var _a, _b, _c, _d;
                            return ({
                                domainId: (_a = row.domainId) !== null && _a !== void 0 ? _a : null,
                                domainName: (_b = row.domainName) !== null && _b !== void 0 ? _b : null,
                                isPassed: Number(row.isPassed) === 1,
                                relevanceScore: (_c = row.relevanceScore) !== null && _c !== void 0 ? _c : null,
                                filterReason: (_d = row.filterReason) !== null && _d !== void 0 ? _d : null,
                            });
                        })];
            }
        });
    });
}
/**
 * 获取翻译结果
 */
function getArticleTranslation(articleId, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, article, row;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, getArticleById(articleId, userId)];
                case 1:
                    article = _d.sent();
                    if (!article)
                        return [2 /*return*/, null];
                    return [4 /*yield*/, db
                            .selectFrom('article_translations')
                            .select(['title_zh', 'summary_zh', 'source_lang'])
                            .where('article_id', '=', articleId)
                            .executeTakeFirst()];
                case 2:
                    row = _d.sent();
                    if (!row)
                        return [2 /*return*/, null];
                    return [2 /*return*/, {
                            title_zh: (_a = row.title_zh) !== null && _a !== void 0 ? _a : null,
                            summary_zh: (_b = row.summary_zh) !== null && _b !== void 0 ? _b : null,
                            source_lang: (_c = row.source_lang) !== null && _c !== void 0 ? _c : null,
                        }];
            }
        });
    });
}
/**
 * 写入翻译结果（覆盖更新）
 */
function upsertArticleTranslation(articleId, userId, translation) {
    return __awaiter(this, void 0, void 0, function () {
        var db, article, now;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, getArticleById(articleId, userId)];
                case 1:
                    article = _d.sent();
                    if (!article) {
                        throw new Error('Article not found');
                    }
                    now = new Date().toISOString();
                    return [4 /*yield*/, db
                            .insertInto('article_translations')
                            .values({
                            article_id: articleId,
                            title_zh: (_a = translation.title_zh) !== null && _a !== void 0 ? _a : null,
                            summary_zh: (_b = translation.summary_zh) !== null && _b !== void 0 ? _b : null,
                            source_lang: (_c = translation.source_lang) !== null && _c !== void 0 ? _c : null,
                            created_at: now,
                            updated_at: now,
                        })
                            .onConflict(function (oc) {
                            var _a, _b, _c;
                            return oc.column('article_id').doUpdateSet({
                                title_zh: (_a = translation.title_zh) !== null && _a !== void 0 ? _a : null,
                                summary_zh: (_b = translation.summary_zh) !== null && _b !== void 0 ? _b : null,
                                source_lang: (_c = translation.source_lang) !== null && _c !== void 0 ? _c : null,
                                updated_at: now,
                            });
                        })
                            .execute()];
                case 2:
                    _d.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Get user articles with pagination
 * @param userId - User ID
 * @param options - Query options
 */
function getUserArticles(userId_1) {
    return __awaiter(this, arguments, void 0, function (userId, options) {
        var db, page, limit, offset, needsLocalDateFilter, userTimezone, _a, hasDateRange, shouldApplyDaysFilter, query, rssSourceIds, journalIds, keywordIds, hasSourceFilter, searchTerm_1, cutoffDate, startDate, _b, endDate, totalCountResult, total, articlesQuery, searchTerm_2, cutoffDate, startDate, _c, endDate, selectQuery, orderedQuery, articles, articlesWithSourceName, normalizedArticles;
        var _d, _e, _f;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_g) {
            switch (_g.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    page = (_d = options.page) !== null && _d !== void 0 ? _d : 1;
                    limit = (_e = options.limit) !== null && _e !== void 0 ? _e : 20;
                    offset = (page - 1) * limit;
                    needsLocalDateFilter = Boolean(options.createdAfter || options.createdBefore);
                    if (!needsLocalDateFilter) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, timezone_js_1.getUserTimezone)(userId)];
                case 1:
                    _a = _g.sent();
                    return [3 /*break*/, 3];
                case 2:
                    _a = undefined;
                    _g.label = 3;
                case 3:
                    userTimezone = _a;
                    hasDateRange = options.createdAfter || options.createdBefore;
                    shouldApplyDaysFilter = options.daysAgo !== undefined &&
                        !hasDateRange &&
                        !(options.skipDaysFilterForSearch && options.search && options.search.trim() !== '');
                    query = db
                        .selectFrom('articles')
                        .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                        .leftJoin('journals', 'journals.id', 'articles.journal_id')
                        .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                        .where(function (eb) { return eb.or([
                        eb.and([
                            eb('articles.rss_source_id', 'is not', null),
                            eb('rss_sources.user_id', '=', userId),
                        ]),
                        eb.and([
                            eb('articles.journal_id', 'is not', null),
                            eb('journals.user_id', '=', userId),
                        ]),
                        eb.and([
                            eb('articles.keyword_id', 'is not', null),
                            eb('keyword_subscriptions.user_id', '=', userId),
                        ]),
                    ]); });
                    rssSourceIds = buildIdList(options.rssSourceIds, options.rssSourceId);
                    journalIds = buildIdList(options.journalIds, options.journalId);
                    keywordIds = buildIdList(options.keywordIds, options.keywordId);
                    hasSourceFilter = Boolean((rssSourceIds && rssSourceIds.length > 0) ||
                        (journalIds && journalIds.length > 0) ||
                        (keywordIds && keywordIds.length > 0));
                    // 来源筛选：支持 RSS 源、期刊或关键词
                    if (hasSourceFilter) {
                        if (rssSourceIds && rssSourceIds.length > 0 && journalIds && journalIds.length > 0 && keywordIds && keywordIds.length > 0) {
                            query = query.where(function (eb) { return eb.or([
                                eb('articles.rss_source_id', 'in', rssSourceIds),
                                eb('articles.journal_id', 'in', journalIds),
                                eb('articles.keyword_id', 'in', keywordIds),
                            ]); });
                        }
                        else if (rssSourceIds && rssSourceIds.length > 0 && journalIds && journalIds.length > 0) {
                            query = query.where(function (eb) { return eb.or([
                                eb('articles.rss_source_id', 'in', rssSourceIds),
                                eb('articles.journal_id', 'in', journalIds),
                            ]); });
                        }
                        else if (rssSourceIds && rssSourceIds.length > 0 && keywordIds && keywordIds.length > 0) {
                            query = query.where(function (eb) { return eb.or([
                                eb('articles.rss_source_id', 'in', rssSourceIds),
                                eb('articles.keyword_id', 'in', keywordIds),
                            ]); });
                        }
                        else if (journalIds && journalIds.length > 0 && keywordIds && keywordIds.length > 0) {
                            query = query.where(function (eb) { return eb.or([
                                eb('articles.journal_id', 'in', journalIds),
                                eb('articles.keyword_id', 'in', keywordIds),
                            ]); });
                        }
                        else if (rssSourceIds && rssSourceIds.length > 0) {
                            query = query.where('articles.rss_source_id', 'in', rssSourceIds);
                        }
                        else if (journalIds && journalIds.length > 0) {
                            query = query.where('articles.journal_id', 'in', journalIds);
                        }
                        else if (keywordIds && keywordIds.length > 0) {
                            query = query.where('articles.keyword_id', 'in', keywordIds);
                        }
                    }
                    if (options.filterStatus !== undefined) {
                        query = query.where('articles.filter_status', '=', options.filterStatus);
                    }
                    if (options.processStatus !== undefined) {
                        query = query.where('articles.process_status', '=', options.processStatus);
                    }
                    if (options.isRead !== undefined) {
                        query = query.where('articles.is_read', '=', options.isRead ? 1 : 0);
                    }
                    // 评级筛选
                    if (options.ratingNull === true) {
                        query = query.where('articles.rating', 'is', null);
                    }
                    else if (options.rating !== undefined) {
                        query = query.where('articles.rating', '=', options.rating);
                    }
                    if (options.search !== undefined && options.search.trim() !== '') {
                        searchTerm_1 = "%".concat(options.search.trim(), "%");
                        query = query.where(function (eb) { return eb.or([
                            eb('articles.title', 'like', searchTerm_1),
                            eb('articles.summary', 'like', searchTerm_1),
                        ]); });
                    }
                    // 时间过滤：根据 shouldApplyDaysFilter 决定是否应用
                    if (shouldApplyDaysFilter) {
                        cutoffDate = new Date();
                        cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo);
                        query = query.where('articles.created_at', '>=', cutoffDate.toISOString());
                    }
                    // 日期范围过滤（优先级高于 daysAgo）
                    if (options.createdAfter) {
                        startDate = (0, timezone_js_1.buildUtcRangeFromLocalDate)(options.createdAfter, userTimezone)[0];
                        query = query.where('articles.created_at', '>=', startDate);
                    }
                    if (options.createdBefore) {
                        _b = (0, timezone_js_1.buildUtcRangeFromLocalDate)(options.createdBefore, userTimezone), endDate = _b[1];
                        query = query.where('articles.created_at', '<=', endDate);
                    }
                    return [4 /*yield*/, query
                            .select(function (eb) { return eb.fn.count('articles.id').as('count'); })
                            .executeTakeFirst()];
                case 4:
                    totalCountResult = _g.sent();
                    total = Number((_f = totalCountResult === null || totalCountResult === void 0 ? void 0 : totalCountResult.count) !== null && _f !== void 0 ? _f : 0);
                    articlesQuery = db
                        .selectFrom('articles')
                        .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                        .leftJoin('journals', 'journals.id', 'articles.journal_id')
                        .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                        .leftJoin('article_translations', 'article_translations.article_id', 'articles.id')
                        .where(function (eb) { return eb.or([
                        eb.and([
                            eb('articles.rss_source_id', 'is not', null),
                            eb('rss_sources.user_id', '=', userId),
                        ]),
                        eb.and([
                            eb('articles.journal_id', 'is not', null),
                            eb('journals.user_id', '=', userId),
                        ]),
                        eb.and([
                            eb('articles.keyword_id', 'is not', null),
                            eb('keyword_subscriptions.user_id', '=', userId),
                        ]),
                    ]); });
                    // Re-apply filters (same logic as above)
                    if (hasSourceFilter) {
                        if (rssSourceIds && rssSourceIds.length > 0 && journalIds && journalIds.length > 0 && keywordIds && keywordIds.length > 0) {
                            articlesQuery = articlesQuery.where(function (eb) { return eb.or([
                                eb('articles.rss_source_id', 'in', rssSourceIds),
                                eb('articles.journal_id', 'in', journalIds),
                                eb('articles.keyword_id', 'in', keywordIds),
                            ]); });
                        }
                        else if (rssSourceIds && rssSourceIds.length > 0 && journalIds && journalIds.length > 0) {
                            articlesQuery = articlesQuery.where(function (eb) { return eb.or([
                                eb('articles.rss_source_id', 'in', rssSourceIds),
                                eb('articles.journal_id', 'in', journalIds),
                            ]); });
                        }
                        else if (rssSourceIds && rssSourceIds.length > 0 && keywordIds && keywordIds.length > 0) {
                            articlesQuery = articlesQuery.where(function (eb) { return eb.or([
                                eb('articles.rss_source_id', 'in', rssSourceIds),
                                eb('articles.keyword_id', 'in', keywordIds),
                            ]); });
                        }
                        else if (journalIds && journalIds.length > 0 && keywordIds && keywordIds.length > 0) {
                            articlesQuery = articlesQuery.where(function (eb) { return eb.or([
                                eb('articles.journal_id', 'in', journalIds),
                                eb('articles.keyword_id', 'in', keywordIds),
                            ]); });
                        }
                        else if (rssSourceIds && rssSourceIds.length > 0) {
                            articlesQuery = articlesQuery.where('articles.rss_source_id', 'in', rssSourceIds);
                        }
                        else if (journalIds && journalIds.length > 0) {
                            articlesQuery = articlesQuery.where('articles.journal_id', 'in', journalIds);
                        }
                        else if (keywordIds && keywordIds.length > 0) {
                            articlesQuery = articlesQuery.where('articles.keyword_id', 'in', keywordIds);
                        }
                    }
                    if (options.filterStatus !== undefined) {
                        articlesQuery = articlesQuery.where('articles.filter_status', '=', options.filterStatus);
                    }
                    if (options.processStatus !== undefined) {
                        articlesQuery = articlesQuery.where('articles.process_status', '=', options.processStatus);
                    }
                    if (options.isRead !== undefined) {
                        articlesQuery = articlesQuery.where('articles.is_read', '=', options.isRead ? 1 : 0);
                    }
                    // 评级筛选
                    if (options.ratingNull === true) {
                        articlesQuery = articlesQuery.where('articles.rating', 'is', null);
                    }
                    else if (options.rating !== undefined) {
                        articlesQuery = articlesQuery.where('articles.rating', '=', options.rating);
                    }
                    if (options.search !== undefined && options.search.trim() !== '') {
                        searchTerm_2 = "%".concat(options.search.trim(), "%");
                        articlesQuery = articlesQuery.where(function (eb) { return eb.or([
                            eb('articles.title', 'like', searchTerm_2),
                            eb('articles.summary', 'like', searchTerm_2),
                        ]); });
                    }
                    // 时间过滤：使用相同的 shouldApplyDaysFilter 逻辑
                    if (shouldApplyDaysFilter) {
                        cutoffDate = new Date();
                        cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo);
                        articlesQuery = articlesQuery.where('articles.created_at', '>=', cutoffDate.toISOString());
                    }
                    // 日期范围过滤（优先级高于 daysAgo）
                    if (options.createdAfter) {
                        startDate = (0, timezone_js_1.buildUtcRangeFromLocalDate)(options.createdAfter, userTimezone)[0];
                        articlesQuery = articlesQuery.where('articles.created_at', '>=', startDate);
                    }
                    if (options.createdBefore) {
                        _c = (0, timezone_js_1.buildUtcRangeFromLocalDate)(options.createdBefore, userTimezone), endDate = _c[1];
                        articlesQuery = articlesQuery.where('articles.created_at', '<=', endDate);
                    }
                    selectQuery = articlesQuery.select([
                        'articles.id',
                        'articles.rss_source_id',
                        'articles.journal_id',
                        'articles.keyword_id',
                        'articles.title',
                        'articles.url',
                        'articles.summary',
                        'articles.content',
                        'articles.markdown_content',
                        'articles.filter_status',
                        'articles.filter_score',
                        'articles.filtered_at',
                        'articles.process_status',
                        'articles.processed_at',
                        'articles.published_at',
                        'articles.published_year',
                        'articles.published_issue',
                        'articles.published_volume',
                        'articles.error_message',
                        'articles.is_read',
                        'articles.source_origin',
                        'articles.rating',
                        'articles.created_at',
                        'articles.updated_at',
                        'rss_sources.name as rss_source_name',
                        'journals.name as journal_name',
                        'keyword_subscriptions.keyword as keyword_name',
                        'article_translations.summary_zh',
                    ]);
                    orderedQuery = options.randomOrder
                        ? selectQuery.orderBy((0, kysely_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["RANDOM()"], ["RANDOM()"]))))
                        : selectQuery.orderBy('articles.created_at', 'desc');
                    return [4 /*yield*/, orderedQuery
                            .limit(limit)
                            .offset(offset)
                            .execute()];
                case 5:
                    articles = _g.sent();
                    articlesWithSourceName = articles.map(function (article) { return (__assign(__assign({}, article), { source_name: article.keyword_name || article.journal_name || article.rss_source_name || 'Unknown' })); });
                    normalizedArticles = articlesWithSourceName.map(function (article) { return normalizeArticleDates(article); });
                    return [2 /*return*/, {
                            articles: normalizedArticles,
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
 * Batch update article filter status
 * @param updates - Update list
 */
function batchUpdateFilterStatus(updates) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now, _i, updates_1, update, isRead;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    _i = 0, updates_1 = updates;
                    _b.label = 1;
                case 1:
                    if (!(_i < updates_1.length)) return [3 /*break*/, 4];
                    update = updates_1[_i];
                    isRead = update.status === 'rejected' ? 1 : undefined;
                    return [4 /*yield*/, db
                            .updateTable('articles')
                            .set(__assign({ filter_status: update.status, filter_score: (_a = update.score) !== null && _a !== void 0 ? _a : null, filtered_at: now, updated_at: now }, (isRead !== undefined && { is_read: isRead })))
                            .where('id', '=', update.articleId)
                            .execute()];
                case 2:
                    _b.sent();
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4:
                    log.info({ count: updates.length }, 'Batch updated article filter status');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Update article process status
 * @param articleId - Article ID
 * @param status - Process status
 * @param errorMessage - Error message (if failed)
 */
function updateArticleProcessStatus(articleId, status, errorMessage) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    return [4 /*yield*/, db
                            .updateTable('articles')
                            .set(__assign({ process_status: status, processed_at: now, updated_at: now }, (errorMessage && { error_message: errorMessage })))
                            .where('id', '=', articleId)
                            .execute()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Delete article by ID
 * @param id - Article ID
 * @param userId - User ID (for permission check)
 */
function deleteArticle(id, userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .deleteFrom('articles')
                            .where('id', '=', id)
                            .where(function (eb) { return eb.or([
                            eb.and([
                                eb('articles.rss_source_id', 'is not', null),
                                eb('articles.rss_source_id', 'in', function (eb) {
                                    return eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.journal_id', 'is not', null),
                                eb('articles.journal_id', 'in', function (eb) {
                                    return eb.selectFrom('journals').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.keyword_id', 'is not', null),
                                eb('articles.keyword_id', 'in', function (eb) {
                                    return eb.selectFrom('keyword_subscriptions').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                        ]); })
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    if (result.numDeletedRows === 0n) {
                        throw new Error('Article not found');
                    }
                    log.info({ articleId: id, userId: userId }, 'Article deleted');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * 获取相关文章（优先缓存，不足时计算并写回）
 */
function getRelatedArticles(articleId_1, userId_1) {
    return __awaiter(this, arguments, void 0, function (articleId, userId, limit) {
        var response;
        if (limit === void 0) { limit = 5; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, search_js_1.search)({
                        mode: search_js_1.SearchMode.RELATED,
                        userId: userId,
                        articleId: articleId,
                        limit: limit,
                        normalizeScores: false,
                        useCache: true,
                    })];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response.results.map(function (r) {
                            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
                            return ({
                                id: r.articleId,
                                title: ((_a = r.metadata) === null || _a === void 0 ? void 0 : _a.title) || '',
                                url: ((_b = r.metadata) === null || _b === void 0 ? void 0 : _b.url) || '',
                                summary: (_d = (_c = r.metadata) === null || _c === void 0 ? void 0 : _c.summary) !== null && _d !== void 0 ? _d : null,
                                published_at: (_f = (_e = r.metadata) === null || _e === void 0 ? void 0 : _e.published_at) !== null && _f !== void 0 ? _f : null,
                                published_year: (_h = (_g = r.metadata) === null || _g === void 0 ? void 0 : _g.published_year) !== null && _h !== void 0 ? _h : null,
                                published_issue: (_k = (_j = r.metadata) === null || _j === void 0 ? void 0 : _j.published_issue) !== null && _k !== void 0 ? _k : null,
                                published_volume: (_m = (_l = r.metadata) === null || _l === void 0 ? void 0 : _l.published_volume) !== null && _m !== void 0 ? _m : null,
                                source_origin: ((_o = r.metadata) === null || _o === void 0 ? void 0 : _o.source_origin) === 'journal' ? 'journal' : 'rss',
                                rss_source_name: (_p = r.metadata) === null || _p === void 0 ? void 0 : _p.rss_source_name,
                                score: r.score,
                            });
                        })];
            }
        });
    });
}
/**
 * 重新计算并写入相关文章缓存（用于流水线）
 */
function refreshRelatedArticles(articleId_1, userId_1) {
    return __awaiter(this, arguments, void 0, function (articleId, userId, limit) {
        var response;
        if (limit === void 0) { limit = 5; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, search_js_1.search)({
                        mode: search_js_1.SearchMode.RELATED,
                        userId: userId,
                        articleId: articleId,
                        limit: limit,
                        normalizeScores: false,
                        useCache: false,
                        refreshCache: true,
                    })];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response.results.map(function (r) {
                            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
                            return ({
                                id: r.articleId,
                                title: ((_a = r.metadata) === null || _a === void 0 ? void 0 : _a.title) || '',
                                url: ((_b = r.metadata) === null || _b === void 0 ? void 0 : _b.url) || '',
                                summary: (_d = (_c = r.metadata) === null || _c === void 0 ? void 0 : _c.summary) !== null && _d !== void 0 ? _d : null,
                                published_at: (_f = (_e = r.metadata) === null || _e === void 0 ? void 0 : _e.published_at) !== null && _f !== void 0 ? _f : null,
                                published_year: (_h = (_g = r.metadata) === null || _g === void 0 ? void 0 : _g.published_year) !== null && _h !== void 0 ? _h : null,
                                published_issue: (_k = (_j = r.metadata) === null || _j === void 0 ? void 0 : _j.published_issue) !== null && _k !== void 0 ? _k : null,
                                published_volume: (_m = (_l = r.metadata) === null || _l === void 0 ? void 0 : _l.published_volume) !== null && _m !== void 0 ? _m : null,
                                source_origin: ((_o = r.metadata) === null || _o === void 0 ? void 0 : _o.source_origin) === 'journal' ? 'journal' : 'rss',
                                rss_source_name: (_p = r.metadata) === null || _p === void 0 ? void 0 : _p.rss_source_name,
                                score: r.score,
                            });
                        })];
            }
        });
    });
}
/**
 * 更新文章已读状态
 * @param articleId - Article ID
 * @param userId - User ID (for permission check)
 * @param isRead - Read status
 */
function updateArticleReadStatus(articleId, userId, isRead) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    return [4 /*yield*/, db
                            .updateTable('articles')
                            .set({
                            is_read: isRead ? 1 : 0,
                            updated_at: now,
                        })
                            .where('id', '=', articleId)
                            .where(function (eb) { return eb.or([
                            eb.and([
                                eb('articles.rss_source_id', 'is not', null),
                                eb('articles.rss_source_id', 'in', function (eb) {
                                    return eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.journal_id', 'is not', null),
                                eb('articles.journal_id', 'in', function (eb) {
                                    return eb.selectFrom('journals').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.keyword_id', 'is not', null),
                                eb('articles.keyword_id', 'in', function (eb) {
                                    return eb.selectFrom('keyword_subscriptions').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                        ]); })
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    if (result.numUpdatedRows === 0n) {
                        throw new Error('Article not found');
                    }
                    log.info({ articleId: articleId, userId: userId, isRead: isRead }, 'Article read status updated');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * 批量更新文章已读状态
 * @param userId - User ID
 * @param articleIds - Article IDs to update
 * @param isRead - Read status
 * @returns Number of updated articles
 */
function batchUpdateArticleReadStatus(userId, articleIds, isRead) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now, result, count;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (articleIds.length === 0)
                        return [2 /*return*/, 0];
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    return [4 /*yield*/, db
                            .updateTable('articles')
                            .set({
                            is_read: isRead ? 1 : 0,
                            updated_at: now,
                        })
                            .where('id', 'in', articleIds)
                            .where(function (eb) { return eb.or([
                            eb.and([
                                eb('articles.rss_source_id', 'is not', null),
                                eb('articles.rss_source_id', 'in', function (eb) {
                                    return eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.journal_id', 'is not', null),
                                eb('articles.journal_id', 'in', function (eb) {
                                    return eb.selectFrom('journals').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.keyword_id', 'is not', null),
                                eb('articles.keyword_id', 'in', function (eb) {
                                    return eb.selectFrom('keyword_subscriptions').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                        ]); })
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    count = Number(result.numUpdatedRows);
                    log.info({ count: count, userId: userId, isRead: isRead }, 'Batch updated article read status');
                    return [2 /*return*/, count];
            }
        });
    });
}
/**
 * 批量标记所有未读文章为已读
 * @param userId - User ID
 * @param options - Filter options (filterStatus, daysAgo, rssSourceId, journalId, etc.)
 * @returns Number of updated articles
 */
function markAllAsRead(userId_1) {
    return __awaiter(this, arguments, void 0, function (userId, options) {
        var db, now, needsLocalDateFilter, userTimezone, _a, rssSourceIds, journalIds, keywordIds, query, cutoffDate, startDate, _b, endDate, result, count;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    needsLocalDateFilter = Boolean(options.createdAfter || options.createdBefore);
                    if (!needsLocalDateFilter) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, timezone_js_1.getUserTimezone)(userId)];
                case 1:
                    _a = _c.sent();
                    return [3 /*break*/, 3];
                case 2:
                    _a = undefined;
                    _c.label = 3;
                case 3:
                    userTimezone = _a;
                    rssSourceIds = buildIdList(options.rssSourceIds, options.rssSourceId);
                    journalIds = buildIdList(options.journalIds, options.journalId);
                    keywordIds = buildIdList(options.keywordIds, options.keywordId);
                    query = db
                        .updateTable('articles')
                        .set({
                        is_read: 1,
                        updated_at: now,
                    })
                        .where(function (eb) { return eb.or([
                        eb.and([
                            eb('articles.rss_source_id', 'is not', null),
                            eb('articles.rss_source_id', 'in', function (eb) {
                                return eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId);
                            }),
                        ]),
                        eb.and([
                            eb('articles.journal_id', 'is not', null),
                            eb('articles.journal_id', 'in', function (eb) {
                                return eb.selectFrom('journals').select('id').where('user_id', '=', userId);
                            }),
                        ]),
                        eb.and([
                            eb('articles.keyword_id', 'is not', null),
                            eb('articles.keyword_id', 'in', function (eb) {
                                return eb.selectFrom('keyword_subscriptions').select('id').where('user_id', '=', userId);
                            }),
                        ]),
                    ]); })
                        .where('is_read', '=', 0);
                    if (options.filterStatus !== undefined) {
                        query = query.where('filter_status', '=', options.filterStatus);
                    }
                    if (rssSourceIds && rssSourceIds.length > 0 && journalIds && journalIds.length > 0 && keywordIds && keywordIds.length > 0) {
                        query = query.where(function (eb) { return eb.or([
                            eb('rss_source_id', 'in', rssSourceIds),
                            eb('journal_id', 'in', journalIds),
                            eb('keyword_id', 'in', keywordIds),
                        ]); });
                    }
                    else if (rssSourceIds && rssSourceIds.length > 0 && journalIds && journalIds.length > 0) {
                        query = query.where(function (eb) { return eb.or([
                            eb('rss_source_id', 'in', rssSourceIds),
                            eb('journal_id', 'in', journalIds),
                        ]); });
                    }
                    else if (rssSourceIds && rssSourceIds.length > 0 && keywordIds && keywordIds.length > 0) {
                        query = query.where(function (eb) { return eb.or([
                            eb('rss_source_id', 'in', rssSourceIds),
                            eb('keyword_id', 'in', keywordIds),
                        ]); });
                    }
                    else if (journalIds && journalIds.length > 0 && keywordIds && keywordIds.length > 0) {
                        query = query.where(function (eb) { return eb.or([
                            eb('journal_id', 'in', journalIds),
                            eb('keyword_id', 'in', keywordIds),
                        ]); });
                    }
                    else if (rssSourceIds && rssSourceIds.length > 0) {
                        query = query.where('rss_source_id', 'in', rssSourceIds);
                    }
                    else if (journalIds && journalIds.length > 0) {
                        query = query.where('journal_id', 'in', journalIds);
                    }
                    else if (keywordIds && keywordIds.length > 0) {
                        query = query.where('keyword_id', 'in', keywordIds);
                    }
                    if (options.processStatus !== undefined) {
                        query = query.where('process_status', '=', options.processStatus);
                    }
                    if (options.daysAgo !== undefined) {
                        cutoffDate = new Date();
                        cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo);
                        query = query.where('created_at', '>=', cutoffDate.toISOString());
                    }
                    if (options.createdAfter) {
                        startDate = (0, timezone_js_1.buildUtcRangeFromLocalDate)(options.createdAfter, userTimezone)[0];
                        query = query.where('created_at', '>=', startDate);
                    }
                    if (options.createdBefore) {
                        _b = (0, timezone_js_1.buildUtcRangeFromLocalDate)(options.createdBefore, userTimezone), endDate = _b[1];
                        query = query.where('created_at', '<=', endDate);
                    }
                    return [4 /*yield*/, query.executeTakeFirst()];
                case 4:
                    result = _c.sent();
                    count = Number(result.numUpdatedRows);
                    log.info({ count: count, userId: userId, options: options }, 'Marked all articles as read');
                    return [2 /*return*/, count];
            }
        });
    });
}
/**
 * 获取未读文章数量
 * @param userId - User ID
 * @param options - Filter options
 */
function getUnreadCount(userId_1) {
    return __awaiter(this, arguments, void 0, function (userId, options) {
        var db, query, cutoffDate, result;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    query = db
                        .selectFrom('articles')
                        .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                        .leftJoin('journals', 'journals.id', 'articles.journal_id')
                        .where(function (eb) { return eb.or([
                        eb.and([
                            eb('articles.rss_source_id', 'is not', null),
                            eb('rss_sources.user_id', '=', userId),
                        ]),
                        eb.and([
                            eb('articles.journal_id', 'is not', null),
                            eb('journals.user_id', '=', userId),
                        ]),
                    ]); })
                        .where('articles.is_read', '=', 0);
                    if (options.filterStatus !== undefined) {
                        query = query.where('articles.filter_status', '=', options.filterStatus);
                    }
                    if (options.daysAgo !== undefined) {
                        cutoffDate = new Date();
                        cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo);
                        query = query.where('articles.created_at', '>=', cutoffDate.toISOString());
                    }
                    return [4 /*yield*/, query
                            .select(function (eb) { return eb.fn.count('articles.id').as('count'); })
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    return [2 /*return*/, Number((result === null || result === void 0 ? void 0 : result.count) || 0)];
            }
        });
    });
}
/**
 * 获取合并后的来源列表（RSS 源、期刊和关键词订阅）
 * @param userId - User ID
 */
function getMergedSources(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var db, activeRssSources, rssSourcesWithArticles, rssSourcesMap, _i, activeRssSources_1, s, _a, rssSourcesWithArticles_1, s, rssSources, activeJournals, journalsWithArticles, journalsMap, _b, activeJournals_1, j, _c, journalsWithArticles_1, j, journals, activeKeywords, keywordsWithArticles, keywordsMap, _d, activeKeywords_1, k, _e, keywordsWithArticles_1, k, keywords, sourceMap, _f, rssSources_1, source, existing, _g, journals_1, journal, existing, _h, keywords_1, keyword, keywordName;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('rss_sources')
                            .select(['id', 'name'])
                            .where('user_id', '=', userId)
                            .where('status', '=', 'active')
                            .execute()];
                case 1:
                    activeRssSources = _j.sent();
                    return [4 /*yield*/, db
                            .selectFrom('rss_sources')
                            .innerJoin('articles', 'articles.rss_source_id', 'rss_sources.id')
                            .select(['rss_sources.id', 'rss_sources.name'])
                            .where('rss_sources.user_id', '=', userId)
                            .where('rss_sources.status', '!=', 'active')
                            .execute()];
                case 2:
                    rssSourcesWithArticles = _j.sent();
                    rssSourcesMap = new Map();
                    for (_i = 0, activeRssSources_1 = activeRssSources; _i < activeRssSources_1.length; _i++) {
                        s = activeRssSources_1[_i];
                        rssSourcesMap.set(s.id, s);
                    }
                    for (_a = 0, rssSourcesWithArticles_1 = rssSourcesWithArticles; _a < rssSourcesWithArticles_1.length; _a++) {
                        s = rssSourcesWithArticles_1[_a];
                        rssSourcesMap.set(s.id, s);
                    }
                    rssSources = Array.from(rssSourcesMap.values());
                    return [4 /*yield*/, db
                            .selectFrom('journals')
                            .select(['id', 'name'])
                            .where('user_id', '=', userId)
                            .where('status', '=', 'active')
                            .execute()];
                case 3:
                    activeJournals = _j.sent();
                    return [4 /*yield*/, db
                            .selectFrom('journals')
                            .innerJoin('articles', 'articles.journal_id', 'journals.id')
                            .select(['journals.id', 'journals.name'])
                            .where('journals.user_id', '=', userId)
                            .where('journals.status', '!=', 'active')
                            .execute()];
                case 4:
                    journalsWithArticles = _j.sent();
                    journalsMap = new Map();
                    for (_b = 0, activeJournals_1 = activeJournals; _b < activeJournals_1.length; _b++) {
                        j = activeJournals_1[_b];
                        journalsMap.set(j.id, j);
                    }
                    for (_c = 0, journalsWithArticles_1 = journalsWithArticles; _c < journalsWithArticles_1.length; _c++) {
                        j = journalsWithArticles_1[_c];
                        journalsMap.set(j.id, j);
                    }
                    journals = Array.from(journalsMap.values());
                    return [4 /*yield*/, db
                            .selectFrom('keyword_subscriptions')
                            .select(['id', 'keyword'])
                            .where('user_id', '=', userId)
                            .where('is_active', '=', 1)
                            .execute()];
                case 5:
                    activeKeywords = _j.sent();
                    return [4 /*yield*/, db
                            .selectFrom('keyword_subscriptions')
                            .innerJoin('articles', 'articles.keyword_id', 'keyword_subscriptions.id')
                            .select(['keyword_subscriptions.id', 'keyword_subscriptions.keyword'])
                            .where('keyword_subscriptions.user_id', '=', userId)
                            .where('keyword_subscriptions.is_active', '!=', 1)
                            .execute()];
                case 6:
                    keywordsWithArticles = _j.sent();
                    keywordsMap = new Map();
                    for (_d = 0, activeKeywords_1 = activeKeywords; _d < activeKeywords_1.length; _d++) {
                        k = activeKeywords_1[_d];
                        keywordsMap.set(k.id, { id: k.id, name: k.keyword });
                    }
                    for (_e = 0, keywordsWithArticles_1 = keywordsWithArticles; _e < keywordsWithArticles_1.length; _e++) {
                        k = keywordsWithArticles_1[_e];
                        keywordsMap.set(k.id, { id: k.id, name: k.keyword });
                    }
                    keywords = Array.from(keywordsMap.values());
                    sourceMap = new Map();
                    // 添加 RSS 源
                    for (_f = 0, rssSources_1 = rssSources; _f < rssSources_1.length; _f++) {
                        source = rssSources_1[_f];
                        existing = sourceMap.get(source.name);
                        if (existing) {
                            if (existing.type === 'rss') {
                                existing.rssIds = existing.rssIds || [];
                                existing.rssIds.push(source.id);
                            }
                            else {
                                // 已有期刊，需要转换为混合类型
                                existing.journalIds = existing.journalIds || [];
                                existing.rssIds = existing.rssIds || [];
                                existing.rssIds.push(source.id);
                                existing.type = 'mixed';
                                existing.id = "mixed:".concat(existing.journalIds[0]);
                            }
                        }
                        else {
                            sourceMap.set(source.name, {
                                id: "rss:".concat(source.id),
                                name: source.name,
                                type: 'rss',
                                rssIds: [source.id],
                            });
                        }
                    }
                    // 添加期刊
                    for (_g = 0, journals_1 = journals; _g < journals_1.length; _g++) {
                        journal = journals_1[_g];
                        existing = sourceMap.get(journal.name);
                        if (existing) {
                            if (existing.type === 'journal') {
                                existing.journalIds = existing.journalIds || [];
                                existing.journalIds.push(journal.id);
                            }
                            else {
                                // 已有 RSS，需要转换
                                existing.rssIds = existing.rssIds || [];
                                existing.journalIds = existing.journalIds || [];
                                existing.journalIds.push(journal.id);
                                existing.type = 'mixed'; // 混合类型
                                existing.id = "mixed:".concat(journal.id); // 更新 ID
                            }
                        }
                        else {
                            sourceMap.set(journal.name, {
                                id: "journal:".concat(journal.id),
                                name: journal.name,
                                type: 'journal',
                                journalIds: [journal.id],
                            });
                        }
                    }
                    // 添加关键词订阅
                    for (_h = 0, keywords_1 = keywords; _h < keywords_1.length; _h++) {
                        keyword = keywords_1[_h];
                        keywordName = "\u5173\u952E\u8BCD: ".concat(keyword.name);
                        // 关键词订阅不与其他来源合并（名称是唯一的）
                        sourceMap.set(keywordName, {
                            id: "keyword:".concat(keyword.id),
                            name: keywordName,
                            type: 'keyword',
                            keywordIds: [keyword.id],
                        });
                    }
                    // 按名称排序
                    return [2 /*return*/, Array.from(sourceMap.values()).sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-CN'); })];
            }
        });
    });
}
/**
 * 更新文章评级
 * @param articleId - Article ID
 * @param userId - User ID (for permission check)
 * @param rating - Rating value (1-5) or null to clear
 */
function updateArticleRating(articleId, userId, rating) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    // 验证评级值
                    if (rating !== null && (rating < 1 || rating > 5)) {
                        throw new Error('Rating must be between 1 and 5');
                    }
                    return [4 /*yield*/, db
                            .updateTable('articles')
                            .set(__assign(__assign({ rating: rating }, (rating !== null && { is_read: 1 })), { updated_at: now }))
                            .where('id', '=', articleId)
                            .where(function (eb) { return eb.or([
                            eb.and([
                                eb('articles.rss_source_id', 'is not', null),
                                eb('articles.rss_source_id', 'in', function (eb) {
                                    return eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.journal_id', 'is not', null),
                                eb('articles.journal_id', 'in', function (eb) {
                                    return eb.selectFrom('journals').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.keyword_id', 'is not', null),
                                eb('articles.keyword_id', 'in', function (eb) {
                                    return eb.selectFrom('keyword_subscriptions').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                        ]); })
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    if (result.numUpdatedRows === 0n) {
                        throw new Error('Article not found');
                    }
                    log.info({ articleId: articleId, userId: userId, rating: rating }, 'Article rating updated');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Update article AI summary
 * @param articleId - Article ID
 * @param userId - User ID (for permission check)
 * @param aiSummary - AI summary text
 */
function updateArticleAiSummary(articleId, userId, aiSummary) {
    return __awaiter(this, void 0, void 0, function () {
        var db, now, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    now = new Date().toISOString();
                    return [4 /*yield*/, db
                            .updateTable('articles')
                            .set({
                            ai_summary: aiSummary,
                            updated_at: now,
                        })
                            .where('id', '=', articleId)
                            .where(function (eb) { return eb.or([
                            eb.and([
                                eb('articles.rss_source_id', 'is not', null),
                                eb('articles.rss_source_id', 'in', function (eb) {
                                    return eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.journal_id', 'is not', null),
                                eb('articles.journal_id', 'in', function (eb) {
                                    return eb.selectFrom('journals').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                            eb.and([
                                eb('articles.keyword_id', 'is not', null),
                                eb('articles.keyword_id', 'in', function (eb) {
                                    return eb.selectFrom('keyword_subscriptions').select('id').where('user_id', '=', userId);
                                }),
                            ]),
                        ]); })
                            .executeTakeFirst()];
                case 1:
                    result = _a.sent();
                    if (result.numUpdatedRows === 0n) {
                        throw new Error('Article not found');
                    }
                    log.info({ articleId: articleId, userId: userId, summaryLength: aiSummary.length }, 'Article AI summary updated');
                    return [2 /*return*/];
            }
        });
    });
}
var templateObject_1;
