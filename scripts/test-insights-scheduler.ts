import assert from 'node:assert/strict';
import { initInsightsScheduler } from '../src/insights-scheduler.js';

async function main() {
  const scheduler = initInsightsScheduler() as any;
  const lastSuccessAt = new Date('2026-04-16T23:16:30.760Z');

  const beforeBoundary = scheduler.getScheduledReportIntervalCheck(
    lastSuccessAt,
    new Date('2026-04-25T23:15:00.000Z')
  );
  assert.equal(beforeBoundary.shouldRun, false, '第 9 天不应触发');
  assert.equal(beforeBoundary.lastSuccessLocalDate, '2026-04-17');
  assert.equal(beforeBoundary.currentLocalDate, '2026-04-26');
  assert.equal(beforeBoundary.elapsedDays, 9);

  const exactBusinessDay = scheduler.getScheduledReportIntervalCheck(
    lastSuccessAt,
    new Date('2026-04-26T23:15:00.000Z')
  );
  assert.equal(exactBusinessDay.shouldRun, true, '第 10 天早上 7:15 应触发');
  assert.equal(exactBusinessDay.lastSuccessLocalDate, '2026-04-17');
  assert.equal(exactBusinessDay.currentLocalDate, '2026-04-27');
  assert.equal(exactBusinessDay.elapsedDays, 10);

  scheduler.isRunning = true;
  scheduler.lastSuccessfulScheduledRunAt = lastSuccessAt;

  const status = scheduler.getStatus();
  assert.equal(status.schedulerTimezone, 'Asia/Shanghai');
  assert.equal(status.nextEligibleLocalDate, '2026-04-27');

  console.log('insights scheduler regression checks passed');
}

main().catch((error) => {
  console.error('insights scheduler regression checks failed');
  console.error(error);
  process.exit(1);
});
