/**
 * Rate Limiter Smoke Test
 *
 * Simple test to verify the rate limiter is working correctly.
 */

import {
  RateLimiter,
  type RateLimiterConfig,
  type RateLimiterStats,
} from '../src/utils/rate-limiter.js';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testBasicRateLimiting(): Promise<boolean> {
  console.log('\n=== Test 1: Basic Rate Limiting ===');

  const config: RateLimiterConfig = {
    requestsPerMinute: 12, // 12 requests per minute = 1 per 5 seconds
    burstCapacity: 2,
    queueTimeout: 15000, // 15 second timeout
  };

  const limiter = new RateLimiter(config);

  const startTime = Date.now();

  // First request should succeed immediately
  await limiter.waitForToken('test-1');
  console.log(`✓ Request 1 completed at ${Date.now() - startTime}ms`);

  // Second request should succeed immediately (burst capacity)
  await limiter.waitForToken('test-2');
  console.log(`✓ Request 2 completed at ${Date.now() - startTime}ms`);

  // Third request should wait for token refill (~5 seconds)
  await limiter.waitForToken('test-3');
  const elapsed = Date.now() - startTime;
  console.log(`✓ Request 3 completed at ${elapsed}ms (should be ~5s)`);

  // Verify timing - should be approximately 5 seconds for third request
  if (elapsed < 4500 || elapsed > 7000) {
    console.log(`✗ Timing verification failed: expected ~5000ms, got ${elapsed}ms`);
    return false;
  }

  // Check stats
  const stats = limiter.getStats();
  console.log('Stats:', stats);

  if (stats.totalRequests !== 3) {
    console.log(`✗ Stats verification failed: expected 3 requests, got ${stats.totalRequests}`);
    return false;
  }

  console.log('✓ Test 1 passed\n');
  return true;
}

async function testQueueTimeout(): Promise<boolean> {
  console.log('=== Test 2: Queue Timeout ===');

  const config: RateLimiterConfig = {
    requestsPerMinute: 6, // 1 per 10 seconds
    burstCapacity: 1,
    queueTimeout: 3000, // 3 second timeout
  };

  const limiter = new RateLimiter(config);

  // Use up the burst capacity
  await limiter.waitForToken('test-1');

  // Try to get another token - should timeout
  const startTime = Date.now();
  try {
    await limiter.waitForToken('test-2');
    console.log('✗ Request should have timed out');
    return false;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.log(`✓ Request timed out as expected after ${elapsed}ms`);
  }

  // Check stats
  const stats = limiter.getStats();
  if (stats.rejectedRequests !== 1) {
    console.log(`✗ Stats verification failed: expected 1 rejection, got ${stats.rejectedRequests}`);
    return false;
  }

  console.log('✓ Test 2 passed\n');
  return true;
}

async function testConcurrentRequests(): Promise<boolean> {
  console.log('=== Test 3: Concurrent Requests ===');

  const config: RateLimiterConfig = {
    requestsPerMinute: 60, // 1 per second
    burstCapacity: 2,
    queueTimeout: 10000,
  };

  const limiter = new RateLimiter(config);

  const startTime = Date.now();

  // Launch 5 concurrent requests
  const promises = Array.from({ length: 5 }, (_, i) =>
    limiter.waitForToken(`concurrent-${i}`).then(() => {
      const elapsed = Date.now() - startTime;
      console.log(`  Request ${i} completed at ${elapsed}ms`);
      return elapsed;
    })
  );

  const results = await Promise.all(promises);

  // First 2 should complete immediately (burst capacity)
  // Remaining 3 should complete at approximately 1s intervals
  if (results[0] > 500 || results[1] > 500) {
    console.log('✗ First 2 requests should complete immediately');
    return false;
  }

  // Check timing pattern
  if (results[2] < 800 || results[2] > 1500) {
    console.log(`✗ Request 2 timing off: expected ~1000ms, got ${results[2]}ms`);
    return false;
  }

  console.log('✓ Test 3 passed\n');
  return true;
}

async function main(): Promise<void> {
  console.log('Rate Limiter Smoke Test\n');

  const tests = [
    testBasicRateLimiting(),
    testQueueTimeout(),
    testConcurrentRequests(),
  ];

  const results = await Promise.all(tests);

  const passed = results.filter((r) => r).length;
  const total = results.length;

  console.log(`\n=== Results: ${passed}/${total} tests passed ===`);

  if (passed === total) {
    console.log('✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('✗ Some tests failed');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test error:', error);
  process.exit(1);
});
