"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVectorText = buildVectorText;
function buildVectorText(input) {
    var _a, _b, _c;
    var parts = [];
    // 优先使用翻译标题，否则用原标题
    var title = (((_a = input.title_zh) === null || _a === void 0 ? void 0 : _a.trim()) || ((_b = input.title) === null || _b === void 0 ? void 0 : _b.trim()) || '');
    if (title) {
        parts.push("TITLE: ".concat(title));
    }
    // 优先使用翻译摘要，否则用原文内容
    var summary = ((_c = input.summary_zh) === null || _c === void 0 ? void 0 : _c.trim()) || '';
    if (summary) {
        parts.push("SUMMARY: ".concat(summary));
    }
    var content = (input.markdown_content || input.content || '').trim();
    if (content) {
        parts.push("CONTENT: ".concat(content));
    }
    return parts.join('\n');
}
