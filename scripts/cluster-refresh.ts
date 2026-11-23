/**
 * 主题聚类日常刷新。
 *
 * 与 cluster:init 的区别：不重建版本，只在 active 版本上追加新文章并重算脏主题。
 * --derive-only 零 token，适合先确认脉络结构；--analysis-only 只补综述。
 */

import { closeDb, getDb } from '../src/db.js';
import { CLUSTER_CONFIG } from '../src/topic-cluster/config.js';
import {
  runClusterPipeline,
  runScheduledAnalyses,
  runScheduledDerive,
} from '../src/topic-cluster/pipeline/index.js';
import { getActiveSet } from '../src/topic-cluster/repo/sets.js';

interface CliOptions {
  deriveOnly: boolean;
  analysisOnly: boolean;
  dryRun: boolean;
  skipAnalysis: boolean;
  limit: number | null;
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    deriveOnly: false,
    analysisOnly: false,
    dryRun: false,
    skipAnalysis: false,
    limit: null,
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--derive-only') options.deriveOnly = true;
    else if (arg === '--analysis-only') options.analysisOnly = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-analysis') options.skipAnalysis = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else {
      console.error(`未知参数：${arg}（用 --help 查看用法）`);
      process.exit(1);
    }
  }

  if (options.deriveOnly && options.analysisOnly) {
    console.error('--derive-only 与 --analysis-only 不能同时使用');
    process.exit(1);
  }
  return options;
}

function printHelp(): void {
  console.log(`主题聚类日常刷新

用法：pnpm run cluster:refresh [选项]

选项：
  --derive-only       只重算脏主题的脉络与指标（零 token）
  --analysis-only     只跑脏主题的两阶段综述（不重跑切面/路由）
  --skip-analysis     跑完整日派生，但不跑综述
  --limit N           analysis-only 时的主题上限（默认 200）
  --force             derive-only 重建全部主题派生；analysis-only 忽略 inputHash
  --dry-run           只打印规模与 token 估算，不落库
  -h, --help          显示本帮助

建议：每天由调度器跑日派生；每周跑 cluster:refresh --analysis-only。
`);
}

async function printDryRun(): Promise<void> {
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (!active) {
    console.log('当前没有 active 主题集合版本；首次运行请执行 pnpm run cluster:init。');
    return;
  }

  const db = getDb();
  const topicRow = await db
    .selectFrom('cluster_topics')
    .where('set_version', '=', active.version)
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();
  const dirtyRow = await db
    .selectFrom('cluster_topics')
    .where('set_version', '=', active.version)
    .where('is_dirty', '=', 1)
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();
  const threadRow = await db
    .selectFrom('topic_threads as th')
    .innerJoin('cluster_topics as t', 't.id', 'th.topic_id')
    .where('t.set_version', '=', active.version)
    .select((eb) => eb.fn.count('th.id').as('count'))
    .executeTakeFirst();

  const topics = Number(topicRow?.count ?? 0);
  const dirty = Number(dirtyRow?.count ?? 0);
  const threads = Number(threadRow?.count ?? 0);

  console.log(`集合版本：v${active.version}`);
  console.log(`主题数：${topics}；脏主题：${dirty}；角度数：${threads}`);
  console.log(
    `预计分析成本：${dirty} 个主题 × 2 次调用；` +
      `输入上限 ${CLUSTER_CONFIG.analysisInputCharBudget} 字符/主题，` +
      `阶段 B 输出上限 ${CLUSTER_CONFIG.analysisPhaseBTokens} token`
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.dryRun) {
    await printDryRun();
    return;
  }

  if (options.deriveOnly) {
    const { setVersion, derive } = await runScheduledDerive({ forceAll: options.force });
    console.log(
      `v${setVersion} 派生完成：处理主题 ${derive.processedTopics}，` +
        `重建脉络 ${derive.threadsRebuilt}，重建指标 ${derive.metricsRebuilt}，` +
        `角度总数 ${derive.threadsTotal}，loose=0`
    );
    if (derive.missingFacetArticleIds.length > 0) {
      console.log(`⚠️ 缺少切面的成员：${derive.missingFacetArticleIds.join(', ')}`);
    }
    return;
  }

  if (options.analysisOnly) {
    const summary = await runScheduledAnalyses({
      limit: options.limit ?? 200,
      force: options.force,
    });
    console.log(
      `分析完成：成功 ${summary.ok}，partial ${summary.partial}，` +
        `样本不足 ${summary.insufficient}，失败 ${summary.failed}`
    );
    for (const failure of summary.failures.slice(0, 5)) {
      console.log(`  ✗ 主题 #${failure.topicId}：${failure.error}`);
    }
    return;
  }

  const summary = await runClusterPipeline({
    skipAnalysis: options.skipAnalysis,
    analysisLimit: options.limit ?? 20,
    forceAnalysis: options.force,
  });
  console.log(
    `v${summary.setVersion} 刷新完成：新增切面 ${summary.facets.succeeded}，` +
      `路由 ${summary.routing.routedArticles}，新主题 ${summary.incubation.createdTopicIds.length}，` +
      `派生 ${summary.derive.threadsRebuilt}，分析成功 ${summary.analysis.ok}、失败 ${summary.analysis.failed}`
  );
}

main()
  .catch((error) => {
    console.error('❌ 执行失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
