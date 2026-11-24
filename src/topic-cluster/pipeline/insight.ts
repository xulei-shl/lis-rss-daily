/**
 * 步骤 8：跨主题洞察报告（综述 + 研究空白二次聚类）。
 *
 * 这一步不跟随每日流水线，只在周综述之后运行一次：缓存键为节点内容哈希，
 * 没有综述/空白变化时不产生 LLM 调用。
 */

import { runInsightReports, type InsightRunResult } from '../service/insight-runner.js';

export type InsightStepResult = InsightRunResult;

export async function runInsightStep(
  setVersion: number,
  options: { limit?: number; force?: boolean } = {}
): Promise<InsightStepResult> {
  return runInsightReports(setVersion, options);
}
