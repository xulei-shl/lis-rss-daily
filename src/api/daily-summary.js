"use strict";
/**
 * 当日总结服务
 *
 * 负责查询当日通过的文章、按源类型排序、调用 LLM 生成总结、管理历史记录
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
exports.getDailyPassedArticles = getDailyPassedArticles;
exports.generateDailySummary = generateDailySummary;
exports.saveDailySummary = saveDailySummary;
exports.getDailySummaryByDate = getDailySummaryByDate;
exports.getDailySummaryHistory = getDailySummaryHistory;
exports.getTodaySummary = getTodaySummary;
exports.generateSearchSummary = generateSearchSummary;
exports.getAllJournalArticles = getAllJournalArticles;
exports.generateJournalAllSummary = generateJournalAllSummary;
var db_js_1 = require("../db.js");
var logger_js_1 = require("../logger.js");
var llm_js_1 = require("../llm.js");
var system_prompts_js_1 = require("./system-prompts.js");
var source_types_js_1 = require("../constants/source-types.js");
var timezone_js_1 = require("./timezone.js");
var index_js_1 = require("../telegram/index.js");
var index_js_2 = require("../wechat/index.js");
var log = logger_js_1.logger.child({ module: 'daily-summary-service' });
/**
 * 获取当日通过的文章，按源类型排序
 * @param type - 总结类型，用于筛选文章来源
 *
 * 数量限制：
 * - journal: 50篇
 * - blog_news: 30篇
 * - all: 60篇（优先40篇期刊，不足或剩余部分由博客/资讯补足）
 */
function getDailyPassedArticles(userId, dateStr, type) {
    return __awaiter(this, void 0, void 0, function () {
        var db, timezone, _a, startDate, endDate, JOURNAL_LIMIT, BLOG_NEWS_LIMIT, ALL_TOTAL_LIMIT, ALL_JOURNAL_PRIORITY, buildBaseQuery, executeQuery, result, query, query, journalQuery, journalArticles, remainingCount, blogNewsArticles, blogNewsQuery;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, (0, timezone_js_1.getUserTimezone)(userId)];
                case 1:
                    timezone = _b.sent();
                    _a = (0, timezone_js_1.buildUtcRangeFromLocalDate)(dateStr, timezone), startDate = _a[0], endDate = _a[1];
                    log.info({ userId: userId, date: dateStr, timezone: timezone, startDate: startDate, endDate: endDate, type: type }, 'Daily article query date range');
                    JOURNAL_LIMIT = 50;
                    BLOG_NEWS_LIMIT = 30;
                    ALL_TOTAL_LIMIT = 60;
                    ALL_JOURNAL_PRIORITY = 40;
                    buildBaseQuery = function () {
                        return db
                            .selectFrom('articles')
                            .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                            .leftJoin('journals', 'journals.id', 'articles.journal_id')
                            .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                            .where('articles.filter_status', '=', 'passed')
                            .where(function (eb) { return eb.or([
                            eb('rss_sources.user_id', '=', userId),
                            eb('journals.user_id', '=', userId),
                            eb('keyword_subscriptions.user_id', '=', userId),
                        ]); })
                            .where('articles.created_at', '>=', startDate)
                            .where('articles.created_at', '<=', endDate);
                    };
                    executeQuery = function (query, limit) { return __awaiter(_this, void 0, void 0, function () {
                        var articles;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0: return [4 /*yield*/, query
                                        .select(function (eb) { return [
                                        'articles.id',
                                        'articles.title',
                                        'articles.url',
                                        'articles.summary',
                                        'articles.markdown_content',
                                        'articles.published_at',
                                        'articles.source_origin',
                                        eb.fn.coalesce('rss_sources.name', 'journals.name', 'keyword_subscriptions.keyword').as('source_name'),
                                        eb.fn.coalesce('rss_sources.source_type', eb.val('journal')).as('source_type'),
                                    ]; })
                                        .orderBy('articles.created_at', 'desc')
                                        .limit(limit)
                                        .execute()];
                                case 1:
                                    articles = _a.sent();
                                    return [2 /*return*/, articles.map(function (row) {
                                            // 如果是关键词文章，修改 source_name 为 "关键词: xxx"
                                            var sourceName = row.source_name || '未知来源';
                                            if (row.source_origin === 'keyword') {
                                                sourceName = "\u5173\u952E\u8BCD: ".concat(row.source_name);
                                            }
                                            return {
                                                id: row.id,
                                                title: row.title,
                                                url: row.url,
                                                summary: row.summary,
                                                markdown_content: row.markdown_content,
                                                source_name: sourceName,
                                                source_type: row.source_type || 'blog',
                                                published_at: row.published_at,
                                            };
                                        })];
                            }
                        });
                    }); };
                    result = [];
                    if (!(type === 'journal')) return [3 /*break*/, 3];
                    query = buildBaseQuery().where(function (eb) { return eb.or([
                        eb('articles.source_origin', '=', 'journal'),
                        eb('articles.source_origin', '=', 'keyword'),
                        eb.and([
                            eb('articles.source_origin', '=', 'rss'),
                            eb('rss_sources.source_type', '=', 'journal'),
                        ]),
                    ]); });
                    return [4 /*yield*/, executeQuery(query, JOURNAL_LIMIT)];
                case 2:
                    result = _b.sent();
                    return [3 /*break*/, 9];
                case 3:
                    if (!(type === 'blog_news')) return [3 /*break*/, 5];
                    query = buildBaseQuery()
                        .where('articles.source_origin', '=', 'rss')
                        .where('rss_sources.source_type', 'in', ['blog', 'news']);
                    return [4 /*yield*/, executeQuery(query, BLOG_NEWS_LIMIT)];
                case 4:
                    result = _b.sent();
                    return [3 /*break*/, 9];
                case 5:
                    journalQuery = buildBaseQuery().where(function (eb) { return eb.or([
                        eb('articles.source_origin', '=', 'journal'),
                        eb('articles.source_origin', '=', 'keyword'),
                        eb.and([
                            eb('articles.source_origin', '=', 'rss'),
                            eb('rss_sources.source_type', '=', 'journal'),
                        ]),
                    ]); });
                    return [4 /*yield*/, executeQuery(journalQuery, ALL_JOURNAL_PRIORITY)];
                case 6:
                    journalArticles = _b.sent();
                    remainingCount = ALL_TOTAL_LIMIT - journalArticles.length;
                    blogNewsArticles = [];
                    if (!(remainingCount > 0)) return [3 /*break*/, 8];
                    blogNewsQuery = buildBaseQuery()
                        .where('articles.source_origin', '=', 'rss')
                        .where('rss_sources.source_type', 'in', ['blog', 'news']);
                    return [4 /*yield*/, executeQuery(blogNewsQuery, remainingCount)];
                case 7:
                    blogNewsArticles = _b.sent();
                    _b.label = 8;
                case 8:
                    result = __spreadArray(__spreadArray([], journalArticles, true), blogNewsArticles, true);
                    _b.label = 9;
                case 9:
                    // 按源类型优先级排序（保持一致性）
                    result.sort(function (a, b) {
                        var _a, _b;
                        var priorityA = (_a = source_types_js_1.SOURCE_TYPE_PRIORITY[a.source_type]) !== null && _a !== void 0 ? _a : 999;
                        var priorityB = (_b = source_types_js_1.SOURCE_TYPE_PRIORITY[b.source_type]) !== null && _b !== void 0 ? _b : 999;
                        return priorityA - priorityB;
                    });
                    log.info({ userId: userId, date: dateStr, count: result.length, type: type }, 'Fetched daily articles for summary');
                    return [2 /*return*/, result];
            }
        });
    });
}
/**
 * 构建文章列表文本（用于 LLM 输入）
 */
function buildArticlesListText(articlesByType) {
    var text = '';
    var addSection = function (title, articles) {
        if (articles.length === 0)
            return;
        text += "\n## ".concat(title, "\n");
        articles.forEach(function (article, index) {
            var content = article.markdown_content || article.summary || '';
            var preview = content.length > 300 ? content.substring(0, 300) + '...' : content;
            text += "".concat(index + 1, ". **").concat(article.title, "**\n");
            text += "   \u6765\u6E90\uFF1A".concat(article.source_name, "\n");
            text += "   \u9884\u89C8\uFF1A".concat(preview, "\n\n");
        });
    };
    addSection('期刊精选', articlesByType.journal);
    addSection('博客推荐', articlesByType.blog);
    addSection('资讯动态', articlesByType.news);
    return text;
}
/**
 * 生成当日总结
 */
function generateDailySummary(input) {
    return __awaiter(this, void 0, void 0, function () {
        var userId, date, _a, type, today, _b, articles, articlesByType, articlesText, typePrompt, promptTemplate, llm, summary, result;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    userId = input.userId, date = input.date, _a = input.type, type = _a === void 0 ? 'all' : _a;
                    _b = date;
                    if (_b) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, timezone_js_1.getUserLocalDate)(userId)];
                case 1:
                    _b = (_c.sent());
                    _c.label = 2;
                case 2:
                    today = _b;
                    return [4 /*yield*/, getDailyPassedArticles(userId, today, type)];
                case 3:
                    articles = _c.sent();
                    if (articles.length === 0) {
                        return [2 /*return*/, {
                                date: today,
                                type: type,
                                totalArticles: 0,
                                articlesByType: { journal: [], blog: [], news: [] },
                                summary: '当日暂无通过的文章。',
                                generatedAt: new Date().toISOString(),
                            }];
                    }
                    articlesByType = {
                        journal: articles.filter(function (a) { return a.source_type === 'journal'; }),
                        blog: articles.filter(function (a) { return a.source_type === 'blog'; }),
                        news: articles.filter(function (a) { return a.source_type === 'news'; }),
                    };
                    articlesText = buildArticlesListText(articlesByType);
                    typePrompt = type === 'journal'
                        ? '这是一份期刊类文章总结，请重点关注学术研究和专业领域的内容。'
                        : type === 'blog_news'
                            ? '这是一份博客和资讯类文章总结，请重点关注技术动态和行业资讯。'
                            : '请综合分析期刊、博客和资讯的内容。';
                    return [4 /*yield*/, (0, system_prompts_js_1.resolveSystemPrompt)(userId, 'daily_summary', "\u4F60\u662F\u4E13\u4E1A\u7684\u5185\u5BB9\u603B\u7ED3\u52A9\u624B\u3002\u8BF7\u6839\u636E\u4EE5\u4E0B\u6587\u7AE0\u5217\u8868\u751F\u6210\u5F53\u65E5\u603B\u7ED3\u3002\n\n## \u6587\u7AE0\u5217\u8868\n".concat(articlesText, "\n\n## \u8F93\u51FA\u8981\u6C42\n1. \u751F\u6210 800-1000 \u5B57\u7684\u4E2D\u6587\u603B\u7ED3\n2. \u6309\u4E3B\u9898\u9886\u57DF\u5F52\u7EB3\u6587\u7AE0\u5185\u5BB9\n3. ").concat(typePrompt, "\n4. \u4F7F\u7528\u6E05\u6670\u7684\u5C42\u6B21\u7ED3\u6784\uFF08Markdown \u683C\u5F0F\uFF09"), {
                            ARTICLES_LIST: articlesText,
                            DATE_RANGE: today,
                        })];
                case 4:
                    promptTemplate = _c.sent();
                    return [4 /*yield*/, (0, llm_js_1.getUserLLMProvider)(userId, 'daily_summary')];
                case 5:
                    llm = _c.sent();
                    return [4 /*yield*/, llm.chat([
                            { role: 'system', content: promptTemplate },
                            { role: 'user', content: "\u8BF7\u751F\u6210 ".concat(today, " \u7684\u5F53\u65E5\u603B\u7ED3\u3002") },
                        ], {
                            temperature: 0.3,
                            label: 'daily_summary',
                        })];
                case 6:
                    summary = _c.sent();
                    log.info({ userId: userId, date: today, articleCount: articles.length, type: type }, 'Daily summary generated');
                    result = {
                        date: today,
                        type: type,
                        totalArticles: articles.length,
                        articlesByType: articlesByType,
                        summary: summary,
                        generatedAt: new Date().toISOString(),
                    };
                    // 只在类型是 journal/blog_news/all 时才推送到 Telegram（search 和 journal_all 不推送到 Telegram
                    if (result.type === 'journal' || result.type === 'blog_news' || result.type === 'all') {
                        (0, index_js_1.getTelegramNotifier)().sendDailySummary(userId, {
                            date: result.date,
                            type: result.type,
                            totalArticles: result.totalArticles,
                            summary: result.summary,
                            articlesByType: {
                                journal: result.articlesByType.journal.length,
                                blog: result.articlesByType.blog.length,
                                news: result.articlesByType.news.length,
                            },
                        }).catch(function (err) {
                            log.warn({ error: err }, 'Failed to send daily summary to Telegram');
                        });
                    }
                    // 推送到企业微信（异步，不阻塞主流程）
                    (0, index_js_2.getWeChatNotifier)().sendDailySummary(userId, {
                        date: result.date,
                        type: result.type,
                        totalArticles: result.totalArticles,
                        summary: result.summary,
                        articlesByType: {
                            journal: result.articlesByType.journal.length,
                            blog: result.articlesByType.blog.length,
                            news: result.articlesByType.news.length,
                        },
                    }).catch(function (err) {
                        log.warn({ error: err }, 'Failed to send daily summary to WeChat');
                    });
                    return [2 /*return*/, result];
            }
        });
    });
}
/**
 * 保存总结到数据库
 */
function saveDailySummary(input) {
    return __awaiter(this, void 0, void 0, function () {
        var db, userId, date, type, articleCount, summaryContent, articlesData, articlesJson;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    userId = input.userId, date = input.date, type = input.type, articleCount = input.articleCount, summaryContent = input.summaryContent, articlesData = input.articlesData;
                    articlesJson = JSON.stringify(articlesData);
                    // 使用 INSERT OR REPLACE 处理重复（同一天同一用户同一类型）
                    return [4 /*yield*/, db
                            .insertInto('daily_summaries')
                            .values({
                            user_id: userId,
                            summary_date: date,
                            summary_type: type,
                            article_count: articleCount,
                            summary_content: summaryContent,
                            articles_data: articlesJson,
                        })
                            .onConflict(function (oc) {
                            return oc.columns(['user_id', 'summary_date', 'summary_type']).doUpdateSet({
                                article_count: articleCount,
                                summary_content: summaryContent,
                                articles_data: articlesJson,
                            });
                        })
                            .execute()];
                case 1:
                    // 使用 INSERT OR REPLACE 处理重复（同一天同一用户同一类型）
                    _a.sent();
                    log.info({ userId: userId, date: date, type: type, articleCount: articleCount }, 'Daily summary saved');
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * 获取指定日期的总结
 * @param type - 可选，指定总结类型
 */
function getDailySummaryByDate(userId, date, type) {
    return __awaiter(this, void 0, void 0, function () {
        var db, query;
        return __generator(this, function (_a) {
            db = (0, db_js_1.getDb)();
            query = db
                .selectFrom('daily_summaries')
                .where('user_id', '=', userId)
                .where('summary_date', '=', date);
            if (type) {
                query = query.where('summary_type', '=', type);
            }
            return [2 /*return*/, query.selectAll().executeTakeFirst()];
        });
    });
}
/**
 * 获取历史总结列表
 * @param type - 可选，筛选指定类型
 */
function getDailySummaryHistory(userId_1) {
    return __awaiter(this, arguments, void 0, function (userId, limit, type) {
        var db, query, results;
        if (limit === void 0) { limit = 30; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    query = db
                        .selectFrom('daily_summaries')
                        .where('user_id', '=', userId);
                    if (type) {
                        query = query.where('summary_type', '=', type);
                    }
                    return [4 /*yield*/, query
                            .selectAll()
                            .orderBy('summary_date', 'desc')
                            .limit(limit)
                            .execute()];
                case 1:
                    results = _a.sent();
                    return [2 /*return*/, results.map(function (row) { return ({
                            id: row.id,
                            summary_date: row.summary_date,
                            summary_type: row.summary_type,
                            article_count: row.article_count,
                            summary_content: row.summary_content,
                            created_at: row.created_at,
                        }); })];
            }
        });
    });
}
/**
 * 获取今日总结（如果存在）
 * @param type - 可选，指定总结类型
 */
function getTodaySummary(userId, type) {
    return __awaiter(this, void 0, void 0, function () {
        var today;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, timezone_js_1.getUserLocalDate)(userId)];
                case 1:
                    today = _a.sent();
                    return [2 /*return*/, getDailySummaryByDate(userId, today, type)];
            }
        });
    });
}
/**
 * 根据文章 ID 列表生成搜索总结
 * @param userId - 用户 ID
 * @param articleIds - 文章 ID 列表
 */
function generateSearchSummary(userId, articleIds) {
    return __awaiter(this, void 0, void 0, function () {
        var db, articles, today_1, summaryArticles, articlesByType, articlesText, today, promptTemplate, llm, summary;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, db
                            .selectFrom('articles')
                            .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                            .leftJoin('journals', 'journals.id', 'articles.journal_id')
                            .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                            .where('articles.id', 'in', articleIds)
                            .where(function (eb) { return eb.or([
                            eb('rss_sources.user_id', '=', userId),
                            eb('journals.user_id', '=', userId),
                            eb('keyword_subscriptions.user_id', '=', userId),
                        ]); })
                            .select(function (eb) { return [
                            'articles.id',
                            'articles.title',
                            'articles.url',
                            'articles.summary',
                            'articles.markdown_content',
                            'articles.published_at',
                            'articles.source_origin',
                            eb.fn.coalesce('rss_sources.name', 'journals.name', 'keyword_subscriptions.keyword').as('source_name'),
                            eb.fn.coalesce('rss_sources.source_type', eb.val('journal')).as('source_type'),
                        ]; })
                            .execute()];
                case 1:
                    articles = _a.sent();
                    if (!(articles.length === 0)) return [3 /*break*/, 3];
                    return [4 /*yield*/, (0, timezone_js_1.getUserLocalDate)(userId)];
                case 2:
                    today_1 = _a.sent();
                    return [2 /*return*/, {
                            date: today_1,
                            type: 'search',
                            totalArticles: 0,
                            articlesByType: { journal: [], blog: [], news: [] },
                            summary: '未找到选中的文章。',
                            generatedAt: new Date().toISOString(),
                        }];
                case 3:
                    summaryArticles = articles.map(function (row) {
                        var sourceName = row.source_name || '未知来源';
                        if (row.source_origin === 'keyword') {
                            sourceName = "\u5173\u952E\u8BCD: ".concat(row.source_name);
                        }
                        return {
                            id: row.id,
                            title: row.title,
                            url: row.url,
                            summary: row.summary,
                            markdown_content: row.markdown_content,
                            source_name: sourceName,
                            source_type: row.source_type || 'blog',
                            published_at: row.published_at,
                        };
                    });
                    articlesByType = {
                        journal: summaryArticles.filter(function (a) { return a.source_type === 'journal'; }),
                        blog: summaryArticles.filter(function (a) { return a.source_type === 'blog'; }),
                        news: summaryArticles.filter(function (a) { return a.source_type === 'news'; }),
                    };
                    articlesText = buildArticlesListText(articlesByType);
                    return [4 /*yield*/, (0, timezone_js_1.getUserLocalDate)(userId)];
                case 4:
                    today = _a.sent();
                    return [4 /*yield*/, (0, system_prompts_js_1.resolveSystemPrompt)(userId, 'daily_summary', "\u4F60\u662F\u4E13\u4E1A\u7684\u5185\u5BB9\u603B\u7ED3\u52A9\u624B\u3002\u8BF7\u6839\u636E\u4EE5\u4E0B\u6587\u7AE0\u5217\u8868\u751F\u6210\u603B\u7ED3\u3002\n\n## \u6587\u7AE0\u5217\u8868\n".concat(articlesText, "\n\n## \u8F93\u51FA\u8981\u6C42\n1. \u751F\u6210 500-800 \u5B57\u7684\u4E2D\u6587\u603B\u7ED3\n2. \u6309\u4E3B\u9898\u9886\u57DF\u5F52\u7EB3\u6587\u7AE0\u5185\u5BB9\n3. \u4F7F\u7528\u6E05\u6670\u7684\u5C42\u6B21\u7ED3\u6784\uFF08Markdown \u683C\u5F0F\uFF09"), {
                            ARTICLES_LIST: articlesText,
                            DATE_RANGE: today,
                        })];
                case 5:
                    promptTemplate = _a.sent();
                    return [4 /*yield*/, (0, llm_js_1.getUserLLMProvider)(userId, 'daily_summary')];
                case 6:
                    llm = _a.sent();
                    return [4 /*yield*/, llm.chat([
                            { role: 'system', content: promptTemplate },
                            { role: 'user', content: '请生成这些文章的总结。' },
                        ], {
                            temperature: 0.3,
                            label: 'search_summary',
                        })];
                case 7:
                    summary = _a.sent();
                    log.info({ userId: userId, articleCount: articles.length }, 'Search summary generated');
                    // 保存到数据库（使用当前日期作为 summary_date）
                    return [4 /*yield*/, saveDailySummary({
                            userId: userId,
                            date: today,
                            type: 'search',
                            articleCount: articles.length,
                            summaryContent: summary,
                            articlesData: articlesByType,
                        })];
                case 8:
                    // 保存到数据库（使用当前日期作为 summary_date）
                    _a.sent();
                    return [2 /*return*/, {
                            date: today,
                            type: 'search',
                            totalArticles: articles.length,
                            articlesByType: articlesByType,
                            summary: summary,
                            generatedAt: new Date().toISOString(),
                        }];
            }
        });
    });
}
// ============================================================================
// 企业微信 - 全部期刊总结功能
// ============================================================================
/**
 * 获取所有期刊文章（不筛选 filter_status，包含未通过的）
 * 只获取期刊类文章（source_origin 为 'journal' 或 'keyword'，或 RSS 源类型为 'journal'）
 */
function getAllJournalArticles(userId, dateStr) {
    return __awaiter(this, void 0, void 0, function () {
        var db, timezone, _a, startDate, endDate, JOURNAL_ALL_LIMIT, query, articles, result;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    db = (0, db_js_1.getDb)();
                    return [4 /*yield*/, (0, timezone_js_1.getUserTimezone)(userId)];
                case 1:
                    timezone = _b.sent();
                    _a = (0, timezone_js_1.buildUtcRangeFromLocalDate)(dateStr, timezone), startDate = _a[0], endDate = _a[1];
                    log.info({ userId: userId, date: dateStr, timezone: timezone, startDate: startDate, endDate: endDate }, 'All journal articles query date range');
                    JOURNAL_ALL_LIMIT = 50;
                    query = db
                        .selectFrom('articles')
                        .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
                        .leftJoin('journals', 'journals.id', 'articles.journal_id')
                        .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
                        .where(function (eb) { return eb.or([
                        eb('rss_sources.user_id', '=', userId),
                        eb('journals.user_id', '=', userId),
                        eb('keyword_subscriptions.user_id', '=', userId),
                    ]); })
                        .where('articles.created_at', '>=', startDate)
                        .where('articles.created_at', '<=', endDate)
                        // 只获取期刊类文章
                        .where(function (eb) { return eb.or([
                        eb('articles.source_origin', '=', 'journal'),
                        eb('articles.source_origin', '=', 'keyword'),
                        eb.and([
                            eb('articles.source_origin', '=', 'rss'),
                            eb('rss_sources.source_type', '=', 'journal'),
                        ]),
                    ]); });
                    return [4 /*yield*/, query
                            .select(function (eb) { return [
                            'articles.id',
                            'articles.title',
                            'articles.url',
                            'articles.summary',
                            'articles.markdown_content',
                            'articles.published_at',
                            'articles.source_origin',
                            eb.fn.coalesce('rss_sources.name', 'journals.name', 'keyword_subscriptions.keyword').as('source_name'),
                            eb.fn.coalesce('rss_sources.source_type', eb.val('journal')).as('source_type'),
                        ]; })
                            .orderBy('articles.created_at', 'desc')
                            .limit(JOURNAL_ALL_LIMIT)
                            .execute()];
                case 2:
                    articles = _b.sent();
                    result = articles.map(function (row) {
                        var sourceName = row.source_name || '未知来源';
                        if (row.source_origin === 'keyword') {
                            sourceName = "\u5173\u952E\u8BCD: ".concat(row.source_name);
                        }
                        return {
                            id: row.id,
                            title: row.title,
                            url: row.url,
                            summary: row.summary,
                            markdown_content: row.markdown_content,
                            source_name: sourceName,
                            source_type: row.source_type || 'journal',
                            published_at: row.published_at,
                        };
                    });
                    // 按源类型优先级排序（保持一致性）
                    result.sort(function (a, b) {
                        var _a, _b;
                        var priorityA = (_a = source_types_js_1.SOURCE_TYPE_PRIORITY[a.source_type]) !== null && _a !== void 0 ? _a : 999;
                        var priorityB = (_b = source_types_js_1.SOURCE_TYPE_PRIORITY[b.source_type]) !== null && _b !== void 0 ? _b : 999;
                        return priorityA - priorityB;
                    });
                    log.info({ userId: userId, date: dateStr, count: result.length }, 'Fetched all journal articles for summary');
                    return [2 /*return*/, result];
            }
        });
    });
}
/**
 * 生成全部期刊总结（包含未通过的文章）
 * 完全复用现有逻辑，仅文章来源不同
 */
function generateJournalAllSummary(input) {
    return __awaiter(this, void 0, void 0, function () {
        var userId, date, today, _a, articles, articlesByType, articlesText, promptTemplate, llm, summary, result;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    userId = input.userId, date = input.date;
                    _a = date;
                    if (_a) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, timezone_js_1.getUserLocalDate)(userId)];
                case 1:
                    _a = (_b.sent());
                    _b.label = 2;
                case 2:
                    today = _a;
                    return [4 /*yield*/, getAllJournalArticles(userId, today)];
                case 3:
                    articles = _b.sent();
                    if (articles.length === 0) {
                        return [2 /*return*/, {
                                date: today,
                                type: 'journal_all',
                                totalArticles: 0,
                                articlesByType: { journal: [], blog: [], news: [] },
                                summary: '当日暂无期刊文章。',
                                generatedAt: new Date().toISOString(),
                            }];
                    }
                    articlesByType = {
                        journal: articles.filter(function (a) { return a.source_type === 'journal' || a.source_type === 'blog' || a.source_type === 'news'; }),
                        blog: [],
                        news: [],
                    };
                    articlesText = buildArticlesListText(articlesByType);
                    return [4 /*yield*/, (0, system_prompts_js_1.resolveSystemPrompt)(userId, 'daily_summary', "\u4F60\u662F\u4E13\u4E1A\u7684\u5185\u5BB9\u603B\u7ED3\u52A9\u624B\u3002\u8BF7\u6839\u636E\u4EE5\u4E0B\u6587\u7AE0\u5217\u8868\u751F\u6210\u5F53\u65E5\u603B\u7ED3\u3002\n\n## \u6587\u7AE0\u5217\u8868\n".concat(articlesText, "\n\n## \u8F93\u51FA\u8981\u6C42\n1. \u751F\u6210 800-1000 \u5B57\u7684\u4E2D\u6587\u603B\u7ED3\n2. \u6309\u4E3B\u9898\u9886\u57DF\u5F52\u7EB3\u6587\u7AE0\u5185\u5BB9\n3. \u8FD9\u662F\u4E00\u4EFD\u671F\u520A\u7C7B\u6587\u7AE0\u603B\u7ED3\uFF0C\u8BF7\u91CD\u70B9\u5173\u6CE8\u5B66\u672F\u7814\u7A76\u548C\u4E13\u4E1A\u9886\u57DF\u7684\u5185\u5BB9\u3002\n4. \u4F7F\u7528\u6E05\u6670\u7684\u5C42\u6B21\u7ED3\u6784\uFF08Markdown \u683C\u5F0F\uFF09"), {
                            ARTICLES_LIST: articlesText,
                            DATE_RANGE: today,
                        })];
                case 4:
                    promptTemplate = _b.sent();
                    return [4 /*yield*/, (0, llm_js_1.getUserLLMProvider)(userId, 'daily_summary')];
                case 5:
                    llm = _b.sent();
                    return [4 /*yield*/, llm.chat([
                            { role: 'system', content: promptTemplate },
                            { role: 'user', content: "\u8BF7\u751F\u6210 ".concat(today, " \u7684\u671F\u520A\u6587\u7AE0\u603B\u7ED3\u3002") },
                        ], {
                            temperature: 0.3,
                            label: 'daily_summary',
                        })];
                case 6:
                    summary = _b.sent();
                    log.info({ userId: userId, date: today, articleCount: articles.length, type: 'journal_all' }, 'Journal all summary generated');
                    // 保存到数据库（使用 journal_all 类型）
                    return [4 /*yield*/, saveDailySummary({
                            userId: userId,
                            date: today,
                            type: 'journal_all',
                            articleCount: articles.length,
                            summaryContent: summary,
                            articlesData: articlesByType,
                        })];
                case 7:
                    // 保存到数据库（使用 journal_all 类型）
                    _b.sent();
                    result = {
                        date: today,
                        type: 'journal_all',
                        totalArticles: articles.length,
                        articlesByType: articlesByType,
                        summary: summary,
                        generatedAt: new Date().toISOString(),
                    };
                    // 推送到企业微信（异步，不阻塞主流程）
                    (0, index_js_2.getWeChatNotifier)().sendJournalAllSummary(userId, {
                        date: result.date,
                        totalArticles: result.totalArticles,
                        summary: result.summary,
                        articles: articles,
                    }).catch(function (err) {
                        log.warn({ error: err }, 'Failed to send journal all summary to WeChat');
                    });
                    // 推送到 Telegram（异步，不阻塞主流程）
                    (0, index_js_1.getTelegramNotifier)().sendJournalAllSummary(userId, {
                        date: result.date,
                        type: result.type,
                        totalArticles: result.totalArticles,
                        summary: result.summary,
                        articlesByType: {
                            journal: result.articlesByType.journal.length,
                            blog: 0,
                            news: 0,
                        },
                    }).catch(function (err) {
                        log.warn({ error: err }, 'Failed to send journal all summary to Telegram');
                    });
                    return [2 /*return*/, result];
            }
        });
    });
}
