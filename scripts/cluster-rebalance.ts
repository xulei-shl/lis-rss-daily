/**
 * 周期归属再平衡 · 手动触发。
 *
 * 适用场景：运维希望**不发版、不等每日 08:30**，立即按当前主题质心重新评估
 * 全库已归属文章的归属（迁移主归属、追加次归属、淘汰弱链接），并把受影响的
 * 主题标脏，等待下一次周分析重算综述与洞察。
 *
 * 与另外两个脚本的分工：
 *   - cluster:fresh-rebuild —— 清空重聚类，主题身份全部重建（重操作）；
 *   - cluster:insight-rebuild —— 不改变归属，只重跑洞察层；
 *   - cluster:rebalance（本脚本）—— 不改变主题定义与名称，只动态纠正成员归属。
 *
 * 特性：
 *   - 纯向量计算，零 LLM 调用、零 Token；
 *   - 迟滞微调：主归属迁移与次归属替换都要领先现有归属 margin，避免周周抖动；
 *   - --dry-run 用内存中的实时质心估算，不写库；
 *   - 执行成功后写一条 trigger=manual 的执行日志，/clusters 与主题详情页立刻可见。
 *
 * 运行方式：
 *   pnpm run cluster:rebalance -- --dry-run
 *   pnpm run cluster:rebalance -- --yes
 *   pnpm run cluster:rebalance -- --yes --margin 0.05
 */

import 'dotenv/config';

import { closeDb } from '../src/db.js';
import { CLUSTER_CONFIG } from '../src/topic-cluster/config.js';
import { runAssignmentRebalance } from '../src/topic-cluster/pipeline/rebalance.js';
import {
  beginClusterRun,
  countLinksByTopic,
  diffTopicLinkCounts,
  finishClusterRun,
} from '../src/topic-cluster/repo/run-logs.js';
import { getActiveSet } from '../src/topic-cluster/repo/sets.js';
import { listTopicsByVersion } from '../src/topic-cluster/repo/topics.js';
import { refreshCentroidsForVersion } from '../src/topic-cluster/service/centroid.js';
import { rebuildTopicMetrics } from '../src/topic-cluster/service/metrics-builder.js';
import { rebuildTopicThreads } from '../src/topic-cluster/service/thread-builder.js';
import { countFacetSourceArticles } from '../src/topic-cluster/source.js';

interface CliOptions {
  dryRun: boolean;
  yes: boolean;
  derive: boolean;
  margin: number | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    yes: false,
    derive: true,
    margin: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--no-derive') options.derive = false;
    else if (arg === '--margin') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0 || value > 0.5) {
        console.error('--margin 需要 0~0.5 之间的数值（默认取 CLUSTER_REBALANCE_MARGIN）');
        process.exit(1);
      }
      options.margin = value;
    } else {
      console.error(`未知参数：${arg}（用 --help 查看用法）`);
      process.exit(1);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`周期归属再平衡（手动触发）

用法：
  pnpm run cluster:rebalance -- --dry-run
  pnpm run cluster:rebalance -- --yes [--margin 0.03] [--no-derive]

选项：
  --dry-run       预检模式：用实时质心估算本轮会调整多少文章，不写库、不写日志
  --yes, -y       确认执行（修改归属链接与脏标记，除 --dry-run 外必须提供）
  --margin N      覆盖迟滞带宽度（默认 CLUSTER_REBALANCE_MARGIN=0.03）
  --no-derive     只改归属，不重建受影响主题的脉络与周期指标
  -h, --help      显示本帮助

说明：
  - 零 LLM 调用：只做余弦相似度计算与链接维护；
  - 不改主题定义/名称，不新增或删除主题；
  - 执行后会为受影响主题打上 is_dirty/review_dirty，下一次周分析自动重算洞察；
  - 成功后写入 trigger=manual 的执行日志，/clusters 顶部与主题详情页立即可见。
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (!active) {
    console.error('当前没有 active 主题集合版本，请先执行 cluster:init 或 cluster:fresh-rebuild。');
    process.exitCode = 1;
    return;
  }

  const topics = await listTopicsByVersion(active.version);
  const pendingFacets = await countFacetSourceArticles(CLUSTER_CONFIG.userId);
  const margin = options.margin ?? CLUSTER_CONFIG.rebalanceMargin;

  console.log('════════════════════════════════════════════════════════════');
  console.log('        LIS-RSS-Daily · 周期归属再平衡（手动触发）          ');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`活动版本：v${active.version}`);
  console.log(`主题数量：${topics.length} 个`);
  console.log(`归入阈值：θ_route=${CLUSTER_CONFIG.simThreshold}，迟滞带=${margin}`);
  console.log(`待抽切面：${pendingFacets} 篇（缺切面的文章本轮会被跳过，不会误删其归属）`);

  if (options.dryRun) {
    console.log('\n[DRY RUN 预检模式] 用实时质心估算，不写库...');
    const preview = await runAssignmentRebalance({
      userId: CLUSTER_CONFIG.userId,
      setVersion: active.version,
      margin,
      dryRun: true,
    });
    printResult(preview);
    console.log('\n预检完成，未修改数据库。正式执行请附带 --yes。');
    return;
  }

  if (!options.yes) {
    console.error('\n❌ 该操作会修改文章的主题归属并重置受影响主题的洞察待更新标记。');
    console.error('   若确认执行，请显式附带 --yes：');
    console.error('   pnpm run cluster:rebalance -- --yes\n');
    process.exitCode = 2;
    return;
  }

  const startedAt = Date.now();
  const runId = await beginClusterRun({
    userId: CLUSTER_CONFIG.userId,
    setVersion: active.version,
    trigger: 'manual',
  });

  try {
    console.log('\n[步骤 1/3] 按当前主归属成员刷新全部主题质心...');
    const centroids = await refreshCentroidsForVersion(active.version);
    console.log(`  ✓ 已刷新 ${centroids.refreshed} 个主题质心`);

    console.log('\n[步骤 2/3] 重新评估全部已归属文章...');
    const before = await countLinksByTopic(active.version);
    const result = await runAssignmentRebalance({
      userId: CLUSTER_CONFIG.userId,
      setVersion: active.version,
      margin,
    });
    printResult(result);

    if (options.derive && result.affectedTopicIds.length > 0) {
      console.log(`\n[步骤 3/3] 重建受影响主题的脉络与周期指标（${result.affectedTopicIds.length} 个）...`);
      let failed = 0;
      for (const topicId of result.affectedTopicIds) {
        try {
          await rebuildTopicThreads(topicId);
          await rebuildTopicMetrics(topicId);
        } catch (error) {
          failed += 1;
          console.error(`  ✗ #${topicId} 派生失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      console.log(failed > 0 ? `  ⚠ ${failed} 个主题派生失败（脏标记保留，下轮自动补算）` : '  ✓ 派生完成');
      if (failed > 0) process.exitCode = 1;
    } else if (!options.derive) {
      console.log('\n[跳过] --no-derive：未重建脉络与周期指标（脏标记保留，下轮流水线补算）');
    }

    const after = await countLinksByTopic(active.version);
    await finishClusterRun(runId, {
      status: 'completed',
      durationMs: Date.now() - startedAt,
      counters: {
        facetSucceeded: 0,
        facetFailed: 0,
        routedArticles: 0,
        newTopics: 0,
        reclaimedLinks: 0,
        analyzedTopics: 0,
        reviewedTopics: 0,
        newReviews: 0,
        insightReports: 0,
        rebalancedArticles: result.changedArticles,
        primarySwitches: result.primarySwitches,
        facetPending: await countFacetSourceArticles(CLUSTER_CONFIG.userId),
        rebalanceDeltas: result.topicDeltas,
        rebalanceExecuted: true,
        analysisExecuted: false,
      },
      topicDeltas: diffTopicLinkCounts(before, after),
    });

    console.log(`\n完成，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s。`);
    console.log('受影响主题已标记待更新：下一次周分析（默认周一 09:30）会按缓存增量重算综述与洞察。');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishClusterRun(runId, {
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    }).catch(() => undefined);
    throw error;
  }
}

function printResult(result: Awaited<ReturnType<typeof runAssignmentRebalance>>): void {
  console.log(`  扫描已归属文章：${result.scannedArticles} 篇`);
  console.log(`  归属变化文章  ：${result.changedArticles} 篇`);
  console.log(`  新增链接      ：${result.addedLinks} 条`);
  console.log(`  淘汰链接      ：${result.removedLinks} 条`);
  console.log(`  迁移主归属    ：${result.primarySwitches} 篇`);
  console.log(`  迟滞暂缓      ：${result.deferredCandidates} 次（优势不足，下轮再评估）`);
  console.log(`  受影响主题    ：${result.affectedTopicIds.length} 个`);
  if (result.skippedMissingFacet > 0) {
    console.log(`  ⚠ 缺切面跳过   ：${result.skippedMissingFacet} 篇（其归属保持不变）`);
  }
  if (result.skippedReason) {
    console.log(`  ⚠ 跳过原因     ：${result.skippedReason}`);
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (error) => {
    console.error(`\n❌ 执行失败：${error instanceof Error ? error.message : String(error)}`);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
