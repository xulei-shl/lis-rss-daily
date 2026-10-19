/**
 * 主题聚类冷启动脚本（支持分阶段稳妥执行）。
 *
 * 设计依据：**聚类本身是纯代码、零 token、秒级完成，只有切面抽取花钱且带质量风险。**
 * 所以「分批」只应该切在切面抽取上，聚类必须一次全量——
 * 若把聚类也拆开，早期文章会先占坑，后续批次无法回溯重聚，主题结构会明显变差。
 *
 * ── 推荐的稳妥流程 ──
 *
 *   ① 小样本试抽（30 篇，验证切面质量）
 *      pnpm run cluster:init -- --facets-only --limit 30
 *
 *   ② 抽检切面：看 method / study_object 是否规范化、能否形成矩阵
 *      pnpm run cluster:validate -- --samples 20
 *
 *   ③ 不满意 → 改提示词后重抽这一批（仅限尚无归属链接的文章）
 *      pnpm run cluster:init -- --facets-only --ids 1,2,3 --reset
 *
 *   ④ 满意后分批抽完全部（反复执行同一命令即可，已抽过的会自动跳过）
 *      pnpm run cluster:init -- --facets-only --limit 200
 *
 *   ⑤ 再看阈值敏感度，必要时调整 CLUSTER_INIT_THRESHOLD
 *      pnpm run cluster:validate
 *
 *   ⑥ 一次全量聚类（零 token）+ 生成多维分析
 *      pnpm run cluster:init -- --skip-analysis    # 只想先看聚类结构时
 *      pnpm run cluster:init                       # 完整跑完
 *
 * 运行前请确认已执行 `pnpm run db:migrate`。
 */

import { closeDb } from '../src/db.js';
import { CLUSTER_CONFIG } from '../src/topic-cluster/config.js';
import { runColdStart, runFacetBackfill } from '../src/topic-cluster/pipeline/index.js';
import { deleteFacets } from '../src/topic-cluster/repo/facets.js';
import { countLinksForArticles } from '../src/topic-cluster/repo/links.js';

interface CliOptions {
  facetsOnly: boolean;
  limit: number | null;
  articleIds: number[];
  reset: boolean;
  skipAnalysis: boolean;
  analysisLimit: number | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    facetsOnly: false,
    limit: null,
    articleIds: [],
    reset: false,
    skipAnalysis: false,
    analysisLimit: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // pnpm 会把用户写的 `--` 原样透传过来，直接忽略，让两种写法都可用
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--facets-only') options.facetsOnly = true;
    else if (arg === '--reset') options.reset = true;
    else if (arg === '--skip-analysis') options.skipAnalysis = true;
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--analysis-limit') options.analysisLimit = Number(argv[++i]);
    else if (arg === '--ids') {
      options.articleIds = String(argv[++i] ?? '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
    } else {
      console.error(`未知参数：${arg}（用 --help 查看用法）`);
      process.exit(1);
    }
  }

  // --ids 是小样本质量抽检，不适合作聚类（几十篇聚不出有意义的主题集合）
  if (options.articleIds.length > 0) options.facetsOnly = true;
  return options;
}

function printHelp(): void {
  console.log(`主题聚类冷启动

用法：pnpm run cluster:init [选项]

选项：
  --facets-only          只抽切面，不聚类（可反复执行，已抽过的自动跳过）
  --limit N              本轮抽取篇数上限
                         facets-only 默认 200；完整模式默认 2000
  --ids 1,2,3            只处理指定文章（隐含 --facets-only，用于小样本抽检）
  --reset                需与 --ids 连用：先删除这些文章的切面再重抽
                         若这些文章已有归属链接会被拒绝（会留下脏数据）
  --skip-analysis        聚类后不做多维分析（省 token，之后可再单独补齐）
  --analysis-limit N     本轮分析的主题数上限（默认 200）
  -h, --help             显示本帮助

推荐顺序：--facets-only --limit 30 → cluster:validate → 分批抽完 → cluster:validate → 完整模式
`);
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function runFacetsOnly(options: CliOptions): Promise<void> {
  const limit = options.limit ?? 200;

  if (options.reset) {
    if (options.articleIds.length === 0) {
      fail('--reset 必须与 --ids 连用（避免误删全库切面）。全量重抽请升版 CLUSTER_FACET_CONTRACT_VERSION。');
    }
    // 安全检查：已有归属链接的文章不能删切面，否则会留下「有链接无切面」的脏数据
    const linkedCount = await countLinksForArticles(options.articleIds);
    if (linkedCount > 0) {
      fail(
        `指定的文章中有 ${linkedCount} 条归属链接，直接删切面会留下「有链接但无切面」的脏数据。` +
          `请改用升版 CLUSTER_FACET_CONTRACT_VERSION 触发安全重抽。`
      );
    }
    const deleted = await deleteFacets(options.articleIds);
    console.log(`♻️  已删除 ${deleted} 条切面，准备重抽`);
  }

  console.log(
    options.articleIds.length > 0
      ? `🔭 切面抽取（指定 ${options.articleIds.length} 篇，facets-only）`
      : `🔭 切面抽取（本轮上限 ${limit} 篇，facets-only）`
  );

  const startedAt = Date.now();
  const result = await runFacetBackfill({
    limit,
    articleIds: options.articleIds.length > 0 ? options.articleIds : undefined,
  });

  console.log('\n── 本轮结果 ──');
  console.log(`命中待抽：${result.requested} 篇`);
  console.log(`成功：${result.succeeded} 篇，失败：${result.failed} 篇，跳过已有：${result.skippedExisting} 篇`);
  for (const failure of result.failures.slice(0, 5)) {
    console.log(`  ✗ #${failure.articleId}：${failure.error}`);
  }
  console.log(`全库仍待抽取：${result.remaining} 篇`);
  console.log(`耗时：${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  if (result.failed > 0) {
    console.log('\n失败的篇目不落库，下次执行同一命令会自动重试。');
  }
  if (result.remaining > 0) {
    console.log(`\n下一步：重复执行本命令可继续推进（每次 ${limit} 篇）；`);
    console.log('       抽完后用 `pnpm run cluster:validate` 抽检质量与阈值敏感度。');
  } else {
    console.log('\n切面已全部就绪。下一步：`pnpm run cluster:validate` 抽检质量与阈值敏感度，');
    console.log('       确认后再执行 `pnpm run cluster:init` 做全量聚类。');
  }
}

async function runFull(options: CliOptions): Promise<void> {
  const facetBatchSize = options.limit ?? 2000;

  console.log('🔭 主题聚类冷启动（完整模式）');
  console.log(
    `   范围=${CLUSTER_CONFIG.scope}  归属用户=${CLUSTER_CONFIG.userId}  ` +
      `切面契约=${CLUSTER_CONFIG.facetContractVersion}  维度=${CLUSTER_CONFIG.embeddingDim}`
  );
  console.log(
    `   阈值：路由=${CLUSTER_CONFIG.simThreshold} 冷启动=${CLUSTER_CONFIG.initThreshold} ` +
      `角度=${CLUSTER_CONFIG.angleThreshold} 串链=${CLUSTER_CONFIG.chainThreshold}`
  );
  console.log(`   本轮切面上限=${facetBatchSize}，分析上限=${options.analysisLimit ?? 200}`);

  if (!CLUSTER_CONFIG.enabled) {
    console.warn('⚠️ CLUSTER_ENABLED=false。脚本仍会执行，但每日调度器不会自动运行。');
  }

  const startedAt = Date.now();
  if (options.skipAnalysis) {
    console.log('   已开启 --skip-analysis：只做聚类与派生，多维分析留到之后补齐');
  }

  const summary = await runColdStart({
    facetBatchSize,
    analysisLimit: options.analysisLimit ?? 200,
    skipAnalysis: options.skipAnalysis,
  });

  console.log('\n── 执行结果 ──');
  console.log(`主题集合版本：v${summary.setVersion}`);
  console.log(
    `切面：请求 ${summary.facets.requested}，成功 ${summary.facets.succeeded}，` +
      `失败 ${summary.facets.failed}，跳过已有 ${summary.facets.skippedExisting}`
  );
  console.log(`路由：游离池 ${summary.routing.poolSize}，归属 ${summary.routing.routedArticles} 篇`);
  console.log(
    `孵化：新建主题 ${summary.incubation.createdTopicIds.length} 个，` +
      `仍在游离池 ${summary.incubation.remainingPoolSize} 篇` +
      (summary.incubation.namingFailures > 0 ? `，命名失败 ${summary.incubation.namingFailures} 簇` : '')
  );
  if (summary.incubation.skippedReason) {
    console.log(`      跳过原因：${summary.incubation.skippedReason}`);
  }
  console.log(`派生：脉络 ${summary.derive.threadsTotal} 条，指标重算 ${summary.derive.metricsRebuilt} 个主题`);
  console.log(
    `分析：成功 ${summary.analysis.ok}，样本不足 ${summary.analysis.insufficient}，失败 ${summary.analysis.failed}`
  );
  for (const failure of summary.analysis.failures.slice(0, 5)) {
    console.log(`      ✗ 主题 #${failure.topicId}：${failure.error}`);
  }
  if (summary.drift.drifted) {
    console.log(`⚠️ 配置漂移：${summary.drift.reasons.join('；')}`);
  }
  console.log(`总耗时：${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  if (summary.analysis.failed > 0) {
    console.log('\n提示：失败主题的 is_dirty 保留，下一次调度会自动重试。');
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.facetsOnly) {
    await runFacetsOnly(options);
    return;
  }

  if (options.reset) {
    fail('--reset 仅适用于 --facets-only --ids 场景。');
  }

  await runFull(options);
}

main()
  .catch((error) => {
    console.error('❌ 执行失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
