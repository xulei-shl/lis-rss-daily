/**
 * 主题洞察重建（单主题 / 全量）。
 *
 * 只重建已有主题的洞察层，不重抽 facets、不改成员、不切版本：
 *   1. 角度/脉络 + 周期指标（零 token）
 *   2. 两阶段分析（overview / synthesis / angles / 宏观 gaps）
 *   3. 深度综述 + 子主题独立研究空白分析（按子课题分面各调一次 LLM）
 *   4. 主题内洞察（先对综述聚元簇再挂载分面与宏观空白）
 *
 * 运行：
 *   pnpm run cluster:insight-rebuild -- --topic v1-t-030-f5ffcaaa
 *   pnpm run cluster:insight-rebuild -- --all --yes
 *   pnpm run cluster:insight-rebuild -- --topic 30 --derive-only
 */

import 'dotenv/config';

import { closeDb } from '../src/db.js';
import type { ClusterTopicsSelection } from '../src/db.js';
import { CLUSTER_CONFIG } from '../src/topic-cluster/config.js';
import { resolveTopic } from '../src/topic-cluster/query.js';
import { getActiveSet } from '../src/topic-cluster/repo/sets.js';
import {
  clearTopicDirty,
  listTopicsByVersion,
  markTopicDirty,
} from '../src/topic-cluster/repo/topics.js';
import { runInsightReports } from '../src/topic-cluster/service/insight-runner.js';
import { rebuildTopicMetrics } from '../src/topic-cluster/service/metrics-builder.js';
import { runTopicAnalysis } from '../src/topic-cluster/service/analysis-runner.js';
import { runTopicReviews } from '../src/topic-cluster/service/review-runner.js';
import { rebuildTopicThreads } from '../src/topic-cluster/service/thread-builder.js';

interface CliOptions {
  topicRefs: string[];
  all: boolean;
  deriveOnly: boolean;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
}

interface TopicResult {
  id: number;
  slug: string;
  name: string;
  threads: number;
  linear: number;
  divergent: number;
  analysis: string;
  reviews: string;
  insights: string;
}

interface Failure {
  topicId: number;
  stage: string;
  error: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    topicRefs: [],
    all: false,
    deriveOnly: false,
    dryRun: false,
    yes: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--derive-only') options.deriveOnly = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--topic') {
      const value = argv[++i];
      if (!value) throw new Error('--topic 缺少主题 id 或 slug');
      options.topicRefs.push(
        ...value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      );
    } else {
      throw new Error(`未知参数：${arg}（用 --help 查看用法）`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`主题洞察重建（单主题 / 全量）

用法：
  pnpm run cluster:insight-rebuild -- --topic <id|slug>
  pnpm run cluster:insight-rebuild -- --topic <id|slug>,<id|slug>
  pnpm run cluster:insight-rebuild -- --all --yes
  pnpm run cluster:insight-rebuild -- --topic 30 --derive-only
  pnpm run cluster:insight-rebuild -- --all --dry-run

选项：
  --topic <id|slug>  指定主题，可重复或逗号分隔
  --all              重建 active 版本的全部主题
  --derive-only      只重算角度、脉络和周期指标，不调用 LLM
  --dry-run          只列出目标和预计调用，不写库
  --yes, -y          全量 LLM 重建的确认开关（--all 非 derive-only 时必填）
  -h, --help         显示帮助

说明：
  - 本脚本只重建已有主题的洞察层，不重抽 facets、不改成员、不切换版本；
  - 单主题模式不会处理其他主题；全量模式会遍历 active 版本全部主题；
  - --derive-only 会保留脏标记，后续分析/综述仍会被调度器补算；
  - 全量 LLM 重建可能产生大量调用，建议先 --dry-run 看目标数量。
`);
}

async function resolveTargets(
  options: CliOptions,
  activeVersion: number
): Promise<ClusterTopicsSelection[]> {
  if (options.all) {
    return listTopicsByVersion(activeVersion);
  }

  const seen = new Set<number>();
  const targets: ClusterTopicsSelection[] = [];
  for (const ref of options.topicRefs) {
    const topic = await resolveTopic(ref);
    if (!topic) throw new Error(`主题不存在：${ref}`);
    if (topic.set_version !== activeVersion) {
      throw new Error(
        `主题 ${ref} 属于 v${topic.set_version}，不是当前 active 版本 v${activeVersion}；` +
          '请先切换版本或改用当前版本的 slug。'
      );
    }
    if (seen.has(topic.id)) continue;
    seen.add(topic.id);
    targets.push(topic);
  }
  return targets;
}

function printPlan(
  options: CliOptions,
  activeVersion: number,
  targets: ClusterTopicsSelection[]
): void {
  console.log(`活动版本：v${activeVersion}`);
  console.log(`目标主题：${targets.length} 个`);
  for (const topic of targets) {
    console.log(`  - #${topic.id} ${topic.slug} ${topic.name}（${topic.linked_count} 篇）`);
  }
  console.log(
    `执行模式：${options.deriveOnly ? '仅派生（0 token）' : '派生 + 分析 + 综述 + 洞察'}`
  );
  if (!options.deriveOnly) {
    console.log(
      `预计 LLM 调用：两阶段分析 2 × ${targets.length} 次；` +
        '深度综述按子课题分面通常 1~8 次/主题；子主题独立空白分析 1~8 次/主题；' +
        '主题内洞察按综述元簇 0~3 次/主题。'
    );
  }
}

async function runTopic(
  topic: ClusterTopicsSelection,
  activeVersion: number,
  options: CliOptions,
  failures: Failure[]
): Promise<TopicResult> {
  const result: TopicResult = {
    id: topic.id,
    slug: topic.slug,
    name: topic.name,
    threads: 0,
    linear: 0,
    divergent: 0,
    analysis: '—',
    reviews: '—',
    insights: '—',
  };

  try {
    // 先标脏：中途失败时，调度器下一轮还能补算。
    await markTopicDirty(topic.id);
    const threads = await rebuildTopicThreads(topic.id);
    await rebuildTopicMetrics(topic.id);
    result.threads = threads.threadCount;
    result.linear = threads.linearCount;
    result.divergent = threads.divergentCount;
    console.log(
      `  [派生] 角度 ${threads.threadCount}（linear ${threads.linearCount} / divergent ${threads.divergentCount}），` +
        `成员 ${threads.memberCount}，loose ${threads.looseCount}`
    );
    if (threads.missingFacetArticleIds.length > 0) {
      console.log(`  ⚠️ 缺少切面的成员：${threads.missingFacetArticleIds.join(', ')}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ topicId: topic.id, stage: 'derive', error: message });
    console.log(`  ✗ 派生失败：${message}`);
    return result;
  }

  if (options.deriveOnly) {
    console.log('  [跳过] --derive-only：不调用分析/综述/洞察，保留脏标记');
    return result;
  }

  try {
    const analysis = await runTopicAnalysis(topic.id, { force: true });
    result.analysis = analysis.status;
    console.log(
      `  [分析] ${analysis.status}，角度 ${analysis.angleCount}，空白 ${analysis.gapCount}` +
        (analysis.error ? `，${analysis.error}` : '')
    );
    if (analysis.status === 'ok' || analysis.status === 'insufficient_data') {
      await clearTopicDirty(topic.id, new Date().toISOString());
    } else {
      failures.push({
        topicId: topic.id,
        stage: 'analysis',
        error: analysis.error ?? analysis.status,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.analysis = 'error';
    failures.push({ topicId: topic.id, stage: 'analysis', error: message });
    console.log(`  ✗ 分析失败：${message}`);
  }

  try {
    const reviews = await runTopicReviews(topic.id, { force: true });
    result.reviews = reviews.status;
    console.log(
      `  [综述] ${reviews.status}，新建 ${reviews.created}，更新 ${reviews.updated}，` +
        `跳过 ${reviews.skipped}，失败 ${reviews.failed}` +
        (typeof reviews.gapsGenerated === 'number' ? `，空白 ${reviews.gapsGenerated}` : '')
    );
    if (reviews.status === 'failed') {
      failures.push({
        topicId: topic.id,
        stage: 'review',
        error: reviews.error ?? '综述失败',
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.reviews = 'error';
    failures.push({ topicId: topic.id, stage: 'review', error: message });
    console.log(`  ✗ 综述失败：${message}`);
  }

  // 综述失败时不要用旧/半套综述生成洞察；其余情况按单主题过滤执行。
  if (result.reviews === 'failed' || result.reviews === 'error') {
    result.insights = 'skipped';
    console.log('  [洞察] 跳过（综述未成功）');
    return result;
  }

  try {
    const insights = await runInsightReports(activeVersion, {
      force: true,
      topicIds: [topic.id],
    });
    result.insights = insights.status;
    console.log(
      `  [洞察] ${insights.status}，簇 ${insights.clusters}，新建 ${insights.created}，` +
        `更新 ${insights.updated}，跳过 ${insights.skipped}，失败 ${insights.failed}`
    );
    if (insights.failed > 0) {
      failures.push({
        topicId: topic.id,
        stage: 'insight',
        error: insights.errors.map((item) => item.error).join('；') || '洞察生成失败',
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.insights = 'error';
    failures.push({ topicId: topic.id, stage: 'insight', error: message });
    console.log(`  ✗ 洞察失败：${message}`);
  }

  return result;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!options.all && options.topicRefs.length === 0) {
    printHelp();
    throw new Error('必须指定 --topic 或 --all');
  }
  if (options.all && options.topicRefs.length > 0) {
    throw new Error('--all 与 --topic 不能同时使用');
  }

  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (!active) throw new Error('当前没有 active 主题集合版本，请先执行 cluster:init');

  const targets = await resolveTargets(options, active.version);
  if (targets.length === 0) throw new Error('没有匹配的主题');
  targets.sort((a, b) => a.id - b.id);

  printPlan(options, active.version, targets);

  if (options.dryRun) {
    console.log('\n--dry-run：未写库、未调用 LLM。');
    return;
  }

  if (options.all && !options.deriveOnly && !options.yes) {
    console.log('\n全量 LLM 重建未执行：请加 --yes 确认。');
    process.exitCode = 2;
    return;
  }

  const failures: Failure[] = [];
  const results: TopicResult[] = [];

  console.log('\n开始重建...');
  for (let index = 0; index < targets.length; index += 1) {
    const topic = targets[index];
    console.log(`\n[${index + 1}/${targets.length}] #${topic.id} ${topic.name}`);
    results.push(await runTopic(topic, active.version, options, failures));
  }

  console.log('\n=== 重建结果 ===');
  console.table(
    results.map((item) => ({
      id: item.id,
      slug: item.slug,
      角度: item.threads,
      linear: item.linear,
      divergent: item.divergent,
      分析: item.analysis,
      综述: item.reviews,
      洞察: item.insights,
    }))
  );

  if (failures.length > 0) {
    console.log(`\n存在 ${failures.length} 个失败：`);
    for (const failure of failures) {
      console.log(`  - #${failure.topicId} [${failure.stage}] ${failure.error}`);
    }
    console.log('失败主题保留了脏标记，可修复后重跑本脚本。');
  } else {
    console.log('\n全部完成。');
  }

  process.exitCode = failures.length > 0 ? 1 : 0;
}

main()
  .then(async () => {
    await closeDb();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (error) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
