"use strict";
/**
 * 系统提示词变量定义
 *
 * 这是系统提示词变量的单一数据源（Single Source of Truth）。
 *
 * - 后端：用于默认模板初始化和运行时验证
 * - 前端：通过 API 获取，用于 UI 提示和变量说明
 *
 * 新增变量时：
 * 1. 在对应类型的 variables 中添加变量定义
 * 2. 在 filter.ts 或 agent.ts 中传入变量值
 * 3. 前端会自动显示新变量
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_TYPES = exports.PROMPT_VARIABLES = void 0;
exports.getVariableNames = getVariableNames;
exports.getVariableDefinitions = getVariableDefinitions;
exports.variablesToJSON = variablesToJSON;
exports.validateRequiredVariables = validateRequiredVariables;
/**
 * 按类型分组的变量定义
 */
exports.PROMPT_VARIABLES = {
    /**
     * filter 类型变量 - 文章过滤
     */
    filter: {
        TOPIC_DOMAINS: {
            description: '主题领域列表',
            source: '从 topic_domains 和 topic_keywords 表动态构建',
            required: true,
        },
        ARTICLE_TITLE: {
            description: '文章标题',
            source: 'articles.title',
            required: true,
        },
        ARTICLE_URL: {
            description: '文章链接',
            source: 'articles.url',
            required: false,
        },
        ARTICLE_CONTENT: {
            description: '正文内容（截取前 2000 字符）',
            source: 'articles.markdown_content || articles.content',
            required: false,
        },
        SOURCE_TYPE: {
            description: 'RSS 源类型（journal/blog/news）',
            source: 'rss_sources.source_type（通过 articles.rss_source_id 关联）',
            required: false,
        },
    },
    /**
     * summary 类型变量 - 文章摘要
     */
    summary: {
        ARTICLE_TITLE: {
            description: '文章标题',
            source: 'articles.title',
            required: true,
        },
        ARTICLE_CONTENT: {
            description: '正文内容（截取前 3000 字符）',
            source: 'articles.markdown_content || articles.summary',
            required: true,
        },
    },
    /**
     * keywords 类型变量 - 关键词提取
     */
    keywords: {
        ARTICLE_TITLE: {
            description: '文章标题',
            source: 'articles.title',
            required: true,
        },
        ARTICLE_CONTENT: {
            description: '正文内容（截取前 1200 字符）',
            source: 'articles.markdown_content',
            required: true,
        },
        ARTICLE_URL: {
            description: '文章链接',
            source: 'articles.url',
            required: false,
        },
    },
    /**
     * translation 类型变量 - 中英翻译
     */
    translation: {
        ARTICLE_TITLE: {
            description: '文章标题',
            source: 'articles.title',
            required: false,
        },
        ARTICLE_CONTENT: {
            description: '正文内容（截取前 3000 字符）',
            source: 'articles.markdown_content || articles.content',
            required: false,
        },
    },
    /**
     * analysis 类型变量 - 文章分析（预留，暂未实现）
     */
    analysis: {
        ARTICLE_TITLE: {
            description: '文章标题',
            source: '预留',
            required: true,
        },
        ARTICLE_SOURCE: {
            description: '文章来源',
            source: '预留',
            required: false,
        },
        ARTICLE_AUTHOR: {
            description: '文章作者',
            source: '预留',
            required: false,
        },
        PUBLISHED_DATE: {
            description: '发布日期',
            source: '预留',
            required: false,
        },
        ARTICLE_CONTENT: {
            description: '正文内容',
            source: '预留',
            required: true,
        },
    },
    /**
     * daily_summary 类型变量 - 当日总结
     */
    daily_summary: {
        ARTICLES_LIST: {
            description: '文章列表（标题、摘要、来源）',
            source: '从 articles 表动态构建，按源类型优先级排序',
            required: true,
        },
        DATE_RANGE: {
            description: '日期范围',
            source: 'YYYY-MM-DD 格式',
            required: true,
        },
        SUMMARY_LENGTH: {
            description: '期望的摘要长度',
            source: '默认 800-1000 字',
            required: false,
        },
    },
};
/**
 * 获取指定类型的变量列表（变量名数组）
 */
function getVariableNames(type) {
    return Object.keys(exports.PROMPT_VARIABLES[type] || {});
}
/**
 * 获取指定类型的变量定义（用于前端展示）
 */
function getVariableDefinitions(type) {
    return exports.PROMPT_VARIABLES[type] || {};
}
/**
 * 将变量定义转换为 JSON 字符串格式（用于数据库存储）
 */
function variablesToJSON(type) {
    var vars = exports.PROMPT_VARIABLES[type] || {};
    var result = {};
    for (var _i = 0, _a = Object.entries(vars); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], info = _b[1];
        result[key] = info.description;
    }
    return JSON.stringify(result);
}
/**
 * 验证运行时传入的变量是否包含所有必需变量
 */
function validateRequiredVariables(type, providedVars) {
    var vars = exports.PROMPT_VARIABLES[type] || {};
    var missing = [];
    for (var _i = 0, _a = Object.entries(vars); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], info = _b[1];
        if (info.required && providedVars[key] === undefined) {
            missing.push(key);
        }
    }
    return {
        valid: missing.length === 0,
        missing: missing,
    };
}
/**
 * 任务类型常量（用于 LLM 配置验证）
 * 从 config/types.yaml 动态加载
 */
var types_config_js_1 = require("./types-config.js");
var _taskTypes = (0, types_config_js_1.getTaskTypeCodes)();
exports.TASK_TYPES = _taskTypes;
