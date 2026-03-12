"use strict";
/**
 * Vector Search Module
 *
 * Exports the unified search service interface.
 * All search operations go through search-service.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchMode = exports.search = void 0;
var search_service_js_1 = require("./search-service.js");
Object.defineProperty(exports, "search", { enumerable: true, get: function () { return search_service_js_1.search; } });
Object.defineProperty(exports, "SearchMode", { enumerable: true, get: function () { return search_service_js_1.SearchMode; } });
