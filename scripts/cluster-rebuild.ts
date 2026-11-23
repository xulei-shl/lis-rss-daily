/**
 * 主题集合重建。
 *
 * 归档当前版本 → 创建新版本 → 全量重新聚类 → 建立旧→新 remap。
 * 旧版本数据保留；旧 slug 通过 cluster_topic_remap 跳转到新主题。
 */

import { closeDb, getDb } from '../src/db.js';
import { CLUSTER_CONFIG } from '../src/topic-cluster/config.js';
import { runColdStart, startNewSetVersion } from '../src/topic-cluster/pipeline/index.js';
import { writeRemapForVersions } from '../src/topic-cluster/repo/remap.js';
import { getActiveSet } from '../src/topic-cluster/repo/sets.js';

interface CliOptions {
  reason: string;
  dryRun: boolean;
  skipAnalysis: boolean;
  analysisLimit: number | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    reason: 'manual_rebuild',
    dryRun: false,
    skipAnalysis: false,
    analysisLimit: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-analysis') options.skipAnalysis = true;
    else if (arg === '--reason') options.reason = String(argv[++i] ?? options.reason);
    else if (arg === '--analysis-limit') options.analysisLimit = Number(argv[++i]);
    else {
      console.error(`未知参数：${arg}（用 --help 查看用法）`);
      process.exit(1);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`主题集合重建

用法：pnpm run cluster:rebuild [选项]

选项：
  --reason TEXT        写进版本表的触发原因（默认 manual_rebuild）
  --skip-analysis      重建后不跑综述，保留脏标记
  --analysis-limit N   重建后分析的主题上限（默认 200）
  --dry-run            只打印当前规模，不归档/不建版本
  -h, --help           显示本帮助

注意：重建会切换 active 版本；旧主题保留并通过 remap 跳转。
`);
}

async function printDryRun(): Promise<void> {
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (!active) {
    console.log('当前没有 active 版本；重建将创建 v1。');
  } else {
    const row = await getDb()
      .selectFrom('cluster_topics')
      .where('set_version', '=', active.version)
      .select((eb) => eb.fn.count('id').as('count'))
      .executeTakeFirst();
    console.log(`当前 v${active.version}，主题 ${Number(row?.count ?? 0)} 个；重建将归档并创建新版本。`);
  }
  console.log('dry-run：未归档、未写库。');
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

  const previous = await getActiveSet(CLUSTER_CONFIG.userId);
  const newVersion = await startNewSetVersion(options.reason);
  const summary = await runColdStart({
    skipAnalysis: options.skipAnalysis,
    analysisLimit: options.analysisLimit ?? 200,
  });

  let remapped = 0;
  if (previous) {
    remapped = await writeRemapForVersions(previous.version, newVersion);
  }

  console.log(
    `重建完成：v${previous?.version ?? '—'} → v${newVersion}；` +
      `主题 ${summary.incubation.createdTopicIds.length} 个，` +
      `remap ${remapped} 条，分析成功 ${summary.analysis.ok}、失败 ${summary.analysis.failed}`
  );
  if (previous && remapped === 0) {
    console.log('提示：没有旧主题达到 0.72 质心相似度，旧 slug 不会重定向。');
  }
}

main()
  .catch((error) => {
    console.error('❌ 执行失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
