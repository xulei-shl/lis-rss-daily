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
exports.buildVectorId = buildVectorId;
exports.upsert = upsert;
exports.query = query;
exports.remove = remove;
var logger_js_1 = require("../logger.js");
var chroma_client_js_1 = require("./chroma-client.js");
var chromadb_1 = require("chromadb");
var log = logger_js_1.logger.child({ module: 'vector-store' });
function buildVectorId(articleId, userId) {
    return "".concat(userId, ":").concat(articleId);
}
function upsert(userId, ids, embeddings, metadatas, documents) {
    return __awaiter(this, void 0, void 0, function () {
        var collection;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (ids.length === 0)
                        return [2 /*return*/];
                    return [4 /*yield*/, (0, chroma_client_js_1.getCollection)(userId)];
                case 1:
                    collection = (_a.sent()).collection;
                    return [4 /*yield*/, collection.upsert({
                            ids: ids,
                            embeddings: embeddings,
                            metadatas: metadatas,
                            documents: documents,
                        })];
                case 2:
                    _a.sent();
                    log.debug({ count: ids.length }, 'Chroma upsert done');
                    return [2 /*return*/];
            }
        });
    });
}
function query(userId, embedding, topK, filter) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, collection, settings, result, ids, distances, metadatas, documents, hits, i, distance, score, metadata, articleId;
        var _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, (0, chroma_client_js_1.getCollection)(userId)];
                case 1:
                    _a = _f.sent(), collection = _a.collection, settings = _a.settings;
                    return [4 /*yield*/, collection.query({
                            queryEmbeddings: [embedding],
                            nResults: topK,
                            where: filter,
                            include: [chromadb_1.IncludeEnum.Distances, chromadb_1.IncludeEnum.Metadatas, chromadb_1.IncludeEnum.Documents],
                        })];
                case 2:
                    result = _f.sent();
                    ids = ((_b = result.ids) === null || _b === void 0 ? void 0 : _b[0]) || [];
                    distances = ((_c = result.distances) === null || _c === void 0 ? void 0 : _c[0]) || [];
                    metadatas = ((_d = result.metadatas) === null || _d === void 0 ? void 0 : _d[0]) || [];
                    documents = ((_e = result.documents) === null || _e === void 0 ? void 0 : _e[0]) || [];
                    hits = [];
                    for (i = 0; i < ids.length; i++) {
                        distance = typeof distances[i] === 'number' ? distances[i] : 1;
                        score = settings.distanceMetric === 'ip' ? distance : 1 - distance;
                        metadata = (metadatas[i] || {});
                        articleId = Number(metadata.article_id || 0);
                        hits.push({
                            id: String(ids[i]),
                            articleId: articleId,
                            score: score,
                            document: documents[i] || '',
                            metadata: metadata,
                        });
                    }
                    return [2 /*return*/, hits];
            }
        });
    });
}
function remove(userId, ids) {
    return __awaiter(this, void 0, void 0, function () {
        var collection;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (ids.length === 0)
                        return [2 /*return*/];
                    return [4 /*yield*/, (0, chroma_client_js_1.getCollection)(userId)];
                case 1:
                    collection = (_a.sent()).collection;
                    return [4 /*yield*/, collection.delete({ ids: ids })];
                case 2:
                    _a.sent();
                    log.debug({ count: ids.length }, 'Chroma delete done');
                    return [2 /*return*/];
            }
        });
    });
}
