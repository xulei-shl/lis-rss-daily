/**
 * LLM API Rate Limiter
 *
 * Implements token bucket algorithm for rate limiting LLM API calls.
 * Prevents hitting API frequency limits while allowing burst traffic.
 */

import { logger } from '../logger.js';

const log = logger.child({ module: 'rate-limiter' });

/* ── Public Types ── */

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Maximum requests per minute */
  requestsPerMinute: number;
  /** Maximum number of tokens in the bucket (burst capacity) */
  burstCapacity: number;
  /** Maximum wait time in queue (ms) before timing out */
  queueTimeout: number;
}

/**
 * Rate limiter statistics
 */
export interface RateLimiterStats {
  /** Current number of available tokens */
  availableTokens: number;
  /** Current number of waiting requests */
  queueLength: number;
  /** Total requests processed */
  totalRequests: number;
  /** Total requests rejected due to timeout */
  rejectedRequests: number;
  /** Average wait time in milliseconds */
  avgWaitTimeMs: number;
}

/* ── Token Bucket Implementation ── */

/**
 * Token Bucket for rate limiting
 *
 * Tokens are added at a constant rate (requestsPerMinute / 60 per second).
 * Each request consumes one token. If no tokens available, request waits.
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(refillRatePerMinute: number, maxTokens: number) {
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
  tryConsume(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Get the current number of available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed > 0) {
      const tokensToAdd = elapsed * this.refillRate;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Get estimated wait time until next token is available
   * Returns 0 if tokens are available now
   */
  getWaitTime(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    // Calculate time needed for one token
    const tokensNeeded = 1 - this.tokens;
    return Math.ceil(tokensNeeded / this.refillRate);
  }
}

/* ── Rate Limiter Implementation ── */

/**
 * Queued request waiting for a token
 */
interface QueuedRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

/**
 * Rate Limiter with queue support
 *
 * Manages API request rate using token bucket algorithm.
 * Requests that exceed the rate are queued and processed when tokens become available.
 */
export class RateLimiter {
  private bucket: TokenBucket;
  private queue: QueuedRequest[] = [];
  private processing = false;
  private readonly queueTimeout: number;

  // Statistics
  private stats = {
    totalRequests: 0,
    rejectedRequests: 0,
    totalWaitTime: 0,
    completedRequests: 0,
  };

  constructor(config: RateLimiterConfig) {
    this.bucket = new TokenBucket(config.requestsPerMinute, config.burstCapacity);
    this.queueTimeout = config.queueTimeout;

    log.info(
      {
        requestsPerMinute: config.requestsPerMinute,
        burstCapacity: config.burstCapacity,
        queueTimeout: config.queueTimeout,
      },
      'Rate limiter initialized'
    );
  }

  /**
   * Wait for a token to become available
   * Resolves when a token is acquired, rejects if timeout is reached
   */
  async waitForToken(label?: string): Promise<void> {
    this.stats.totalRequests++;

    // Try to consume immediately
    if (this.bucket.tryConsume()) {
      log.debug({ label }, 'Token available immediately');
      return;
    }

    // Need to wait - add to queue
    return new Promise<void>((resolve, reject) => {
      const timestamp = Date.now();
      const timeout = setTimeout(() => {
        // Remove from queue
        const index = this.queue.findIndex((req) => req.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
          this.stats.rejectedRequests++;
          log.warn({ label, waitTime: Date.now() - timestamp }, 'Rate limit queue timeout');
          reject(new Error(`Rate limit queue timeout after ${this.queueTimeout}ms`));
        }
      }, this.queueTimeout);

      this.queue.push({ resolve, reject, timestamp, timeout });

      log.debug(
        {
          label,
          queuePosition: this.queue.length,
          estimatedWaitTime: this.bucket.getWaitTime(),
        },
        'Request queued for rate limiting'
      );

      // Start processing queue if not already running
      this.processQueue();
    });
  }

  /**
   * Process the queue, giving tokens to waiting requests
   */
  private processQueue(): void {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    const processNext = async () => {
      while (this.queue.length > 0) {
        // Wait for token availability
        let waitTime = this.bucket.getWaitTime();
        if (waitTime > 0) {
          await sleep(waitTime);
        }

        // Try to consume token
        if (!this.bucket.tryConsume()) {
          // Still no token, continue waiting
          continue;
        }

        // Get next request from queue
        const request = this.queue.shift();
        if (!request) {
          break;
        }

        // Clear timeout
        clearTimeout(request.timeout);

        // Calculate wait time
        const actualWaitTime = Date.now() - request.timestamp;
        this.stats.totalWaitTime += actualWaitTime;
        this.stats.completedRequests++;

        // Resolve the request
        request.resolve();

        log.debug(
          {
            label: request.resolve.name || 'unknown',
            waitTime: actualWaitTime,
            remainingQueue: this.queue.length,
          },
          'Rate limit token acquired'
        );
      }

      this.processing = false;
    };

    processNext().catch((error) => {
      log.error({ error }, 'Error processing rate limit queue');
      this.processing = false;
    });
  }

  /**
   * Get current statistics
   */
  getStats(): RateLimiterStats {
    return {
      availableTokens: this.bucket.getAvailableTokens(),
      queueLength: this.queue.length,
      totalRequests: this.stats.totalRequests,
      rejectedRequests: this.stats.rejectedRequests,
      avgWaitTimeMs:
        this.stats.completedRequests > 0
          ? this.stats.totalWaitTime / this.stats.completedRequests
          : 0,
    };
  }
}

/* ── Global Rate Limiter Instance ── */

let globalRateLimiter: RateLimiter | null = null;

/**
 * Get or create the global rate limiter instance
 */
export function getGlobalRateLimiter(): RateLimiter | null {
  return globalRateLimiter;
}

/**
 * Initialize the global rate limiter with configuration
 */
export function initGlobalRateLimiter(config: RateLimiterConfig): RateLimiter {
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
export function resetGlobalRateLimiter(): void {
  globalRateLimiter = null;
}

/* ── Utility Functions ── */

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
