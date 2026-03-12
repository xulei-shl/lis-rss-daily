import { initRSSScheduler } from '../src/rss-scheduler.js';

async function test() {
  const scheduler = initRSSScheduler();
  
  // 获取配置信息
  const status = scheduler.getStatus();
  console.log('Scheduler config:', {
    enabled: status.config.enabled,
    schedule: status.config.schedule,
    maxConcurrent: status.config.maxConcurrent,
    forceOnSchedule: status.config.forceOnSchedule
  });
  
  // 手动触发一次
  console.log('\nTriggering manual fetch...');
  const results = await scheduler.fetchAllNow();
  
  console.log('\nResults:');
  console.log(`Total: ${results.length}`);
  console.log(`Success: ${results.filter(r => r.success).length}`);
  console.log(`Failed: ${results.filter(r => !r.success).length}`);
  console.log(`Articles: ${results.reduce((sum, r) => sum + r.articlesCount, 0)}`);
  console.log(`New Articles: ${results.reduce((sum, r) => sum + r.newArticlesCount, 0)}`);
  
  process.exit(0);
}

test().catch(console.error);
