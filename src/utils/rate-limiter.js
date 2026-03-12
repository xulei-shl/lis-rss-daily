"use strict";
/**
 * LLM API Rate Limiter
 *
 * Implements token bucket algorithm for rate limiting LLM API calls.
 * Prevents hitting API frequency limits while allowing burst traffic.
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
exports.RateLimiter = void 0;
exports.getGlobalRateLimiter = getGlobalRateLimiter;
exports.initGlobalRateLimiter = initGlobalRateLimiter;
exports.resetGlobalRateLimiter = resetGlobalRateLimiter;
var logger_js_1 = require("../logger.js");
var log = logger_js_1.logger.child({ module: 'rate-limiter' });
/* ── Token Bucket Implementation ── */
/**
 * Token Bucket for rate limiting
 *
 * Tokens are added at a constant rate (requestsPerMinute / 60 per second).
 * Each request consumes one token. If no tokens available, request waits.
 */
var TokenBucket = /** @class */ (function () {
    function TokenBucket(refillRatePerMinute, maxTokens) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens; // Start with full bucket
        this.lastRefill = Date.now();
        // Convert rate from per-minute to per-millisecond
        this.refillRate = refillRatePerMinute / 60 / 1000;
    }
    /**
     * Try to consume a token. Returns true if successful.
     * Refills tokens based on elapsed time before checking.
     */
    TokenBucket.prototype.tryConsume = function () {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    };
    /**
     * Get the current number of available tokens
     */
    TokenBucket.prototype.getAvailableTokens = function () {
        this.refill();
        return this.tokens;
    };
    /**
     * Refill tokens based on elapsed time
     */
    TokenBucket.prototype.refill = function () {
        var now = Date.now();
        var elapsed = now - this.lastRefill;
        if (elapsed > 0) {
            var tokensToAdd = elapsed * this.refillRate;
            this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
            this.lastRefill = now;
        }
    };
    /**
     * Get estimated wait time until next token is available
     * Returns 0 if tokens are available now
     */
    TokenBucket.prototype.getWaitTime = function () {
        this.refill();
        if (this.tokens >= 1) {
            return 0;
        }
        // Calculate time needed for one token
        var tokensNeeded = 1 - this.tokens;
        return Math.ceil(tokensNeeded / this.refillRate);
    };
    return TokenBucket;
}());
/**
 * Rate Limiter with queue support
 *
 * Manages API request rate using token bucket algorithm.
 * Requests that exceed the rate are queued and processed when tokens become available.
 */
var RateLimiter = /** @class */ (function () {
    function RateLimiter(config) {
        this.queue = [];
        this.processing = false;
        // Statistics
        this.stats = {
            totalRequests: 0,
            rejectedRequests: 0,
            totalWaitTime: 0,
            completedRequests: 0,
        };
        this.bucket = new TokenBucket(config.requestsPerMinute, config.burstCapacity);
        this.queueTimeout = config.queueTimeout;
        log.info({
            requestsPerMinute: config.requestsPerMinute,
            burstCapacity: config.burstCapacity,
            queueTimeout: config.queueTimeout,
        }, 'Rate limiter initialized');
    }
    /**
     * Wait for a token to become available
     * Resolves when a token is acquired, rejects if timeout is reached
     */
    RateLimiter.prototype.waitForToken = function (label) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                this.stats.totalRequests++;
                // Try to consume immediately
                if (this.bucket.tryConsume()) {
                    log.debug({ label: label }, 'Token available immediately');
                    return [2 /*return*/];
                }
                // Need to wait - add to queue
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timestamp = Date.now();
                        var timeout = setTimeout(function () {
                            // Remove from queue
                            var index = _this.queue.findIndex(function (req) { return req.resolve === resolve; });
                            if (index !== -1) {
                                _this.queue.splice(index, 1);
                                _this.stats.rejectedRequests++;
                                log.warn({ label: label, waitTime: Date.now() - timestamp }, 'Rate limit queue timeout');
                                reject(new Error("Rate limit queue timeout after ".concat(_this.queueTimeout, "ms")));
                            }
                        }, _this.queueTimeout);
                        _this.queue.push({ resolve: resolve, reject: reject, timestamp: timestamp, timeout: timeout });
                        log.debug({
                            label: label,
                            queuePosition: _this.queue.length,
                            estimatedWaitTime: _this.bucket.getWaitTime(),
                        }, 'Request queued for rate limiting');
                        // Start processing queue if not already running
                        _this.processQueue();
                    })];
            });
        });
    };
    /**
     * Process the queue, giving tokens to waiting requests
     */
    RateLimiter.prototype.processQueue = function () {
        var _this = this;
        if (this.processing || this.queue.length === 0) {
            return;
        }
        this.processing = true;
        var processNext = function () { return __awaiter(_this, void 0, void 0, function () {
            var waitTime, request, actualWaitTime;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(this.queue.length > 0)) return [3 /*break*/, 3];
                        waitTime = this.bucket.getWaitTime();
                        if (!(waitTime > 0)) return [3 /*break*/, 2];
                        return [4 /*yield*/, sleep(waitTime)];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2:
                        // Try to consume token
                        if (!this.bucket.tryConsume()) {
                            // Still no token, continue waiting
                            return [3 /*break*/, 0];
                        }
                        request = this.queue.shift();
                        if (!request) {
                            return [3 /*break*/, 3];
                        }
                        // Clear timeout
                        clearTimeout(request.timeout);
                        actualWaitTime = Date.now() - request.timestamp;
                        this.stats.totalWaitTime += actualWaitTime;
                        this.stats.completedRequests++;
                        // Resolve the request
                        request.resolve();
                        log.debug({
                            label: request.resolve.name || 'unknown',
                            waitTime: actualWaitTime,
                            remainingQueue: this.queue.length,
                        }, 'Rate limit token acquired');
                        return [3 /*break*/, 0];
                    case 3:
                        this.processing = false;
                        return [2 /*return*/];
                }
            });
        }); };
        processNext().catch(function (error) {
            log.error({ error: error }, 'Error processing rate limit queue');
            _this.processing = false;
        });
    };
    /**
     * Get current statistics
     */
    RateLimiter.prototype.getStats = function () {
        return {
            availableTokens: this.bucket.getAvailableTokens(),
            queueLength: this.queue.length,
            totalRequests: this.stats.totalRequests,
            rejectedRequests: this.stats.rejectedRequests,
            avgWaitTimeMs: this.stats.completedRequests > 0
                ? this.stats.totalWaitTime / this.stats.completedRequests
                : 0,
        };
    };
    return RateLimiter;
}());
exports.RateLimiter = RateLimiter;
/* ── Global Rate Limiter Instance ── */
var globalRateLimiter = null;
/**
 * Get or create the global rate limiter instance
 */
function getGlobalRateLimiter() {
    return globalRateLimiter;
}
/**
 * Initialize the global rate limiter with configuration
 */
function initGlobalRateLimiter(config) {
    if (globalRateLimiter) {
        log.warn('Global rate limiter already initialized, returning existing instance');
        return globalRateLimiter;
    }
    globalRateLimiter = new RateLimiter(config);
    return globalRateLimiter;
}
/**
 * Reset the global rate limiter (mainly for testing)
 */
function resetGlobalRateLimiter() {
    globalRateLimiter = null;
}
/* ── Utility Functions ── */
/**
 * Sleep for a specified duration
 */
function sleep(ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
}
