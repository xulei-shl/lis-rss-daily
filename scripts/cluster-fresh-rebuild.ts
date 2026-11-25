/**
 * 主题聚类与洞察 - 彻底清空后从头全新冷启动重建脚本。
 *
 * 适用场景：
 *   - 阈值体系重构后（如 θ_init 从 0.65 升级为 0.68，二级分面从 0.82 优化为 0.70），
 *     希望废弃所有旧的历史大主题与错乱脉络，从 v1 开始干干净净重新聚合全库文献。
 *
 * 执行步骤：
 *   ① 强制物理备份：在执行任何清空前，自动将 SQLite 库文件备份至带时间戳的文件；
 *   ② 级联清空聚类层：清空主题、链接、版本、脉络、分析、综述、空白与洞察等全部下游表；
 *      （默认保留 930 篇已抽取的文献特征向量切面，0 Token 秒级完成重新凝聚成簇；可用 --clean-facets 彻底重抽）
 *   ③ 全新冷启动（v1 起步）：
 *      - 全库切面进入未归属池（游离池）；
 *      - 纯向量平均连接（θ=0.68）孵化全新健康的一级大主题；
 *      - LLM 命名新主题；
 *      - 二级子课题聚类（θ=0.70）与脉络派生（1:1 严格对齐分面）；
 *      - 可选执行多维分析、深度综述与宏观洞察（可通过 --skip-analysis 快速跳过大额 Token 消耗）。
 *
 * 运行方式：
 *   pnpm run cluster:fresh-rebuild -- --dry-run
 *   pnpm run cluster:fresh-rebuild -- --yes --skip-analysis
 *   pnpm run cluster:fresh-rebuild -- --yes
 */

import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'kysely';

import { config } from '../src/config.js';
import { CLUSTER_CONFIG } from '../src/topic-cluster/config.js';
import { closeDb, getDb } from '../src/db.js';
import { runColdStart } from '../src/topic-cluster/pipeline/index.js';

interface CliOptions {
  dryRun: boolean;
  yes: boolean;
  cleanFacets: boolean;
  skipAnalysis: boolean;
  analysisLimit: number | null;
  help: boolean;
}

const CLUSTER_TABLES = [
  'cluster_topic_documents',
  'cluster_insight_reports',
  'cluster_topic_gaps',
  'cluster_topic_reviews',
  'cluster_topic_analysis',
  'topic_metrics_period',
  'thread_articles',
  'topic_threads',
  'cluster_topic_merge_remap',
  'cluster_topic_remap',
  'article_topic_links',
  'cluster_topics',
  'cluster_run_logs',
  'cluster_topic_sets',
] as const;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    yes: false,
    cleanFacets: false,
    skipAnalysis: false,
    analysisLimit: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--clean-facets') options.cleanFacets = true;
    else if (arg === '--skip-analysis') options.skipAnalysis = true;
    else if (arg === '--analysis-limit') options.analysisLimit = Number(argv[++i]);
    else {
      console.error(`未知参数：${arg}（用 --help 查看用法）`);
      process.exit(1);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`主题聚类全量清空与从头冷启动重建

用法：
  pnpm run cluster:fresh-rebuild -- --dry-run
  pnpm run cluster:fresh-rebuild -- --yes [--skip-analysis] [--clean-facets]

选项：
  --dry-run            预检模式：仅打印当前数据量、备份路径与执行计划，不修改数据库
  --yes, -y            确认执行清空与重建（不可逆操作，除 --dry-run 外必须提供）
  --skip-analysis      完成清空与新主题/子课题聚类派生后，跳过 Phase A/B 综述与洞察
                       （极度推荐首次重构使用：0 Token 消耗秒级看聚类结果，满意后再跑综述）
  --clean-facets       连同文章语义切面 (article_cluster_facets) 一起清空
                       （默认保留切面以省去 930 篇文献的重复抽取费用；通常无需开启）
  --analysis-limit N   重建后最多分析的主题数上限（默认 200）
  -h, --help           显示本帮助

核心保障：
  - 脚本在执行 DELETE 前会自动为数据库生成带时间戳的完整物理备份文件；
  - 原始文章库 (articles) 与订阅数据不受任何影响，仅重置主题聚类与洞察层。
`);
}

async function getTableCounts(): Promise<Record<string, number>> {
  const db = getDb();
  const counts: Record<string, number> = {};

  for (const table of CLUSTER_TABLES) {
    try {
      const res = await sql<{ count: number }>`SELECT count(*) as count FROM ${sql.raw(table)}`.execute(db);
      counts[table] = Number(res.rows[0]?.count ?? 0);
    } catch {
      counts[table] = 0;
    }
  }

  try {
    const res = await sql<{ count: number }>`SELECT count(*) as count FROM article_cluster_facets`.execute(db);
    counts.article_cluster_facets = Number(res.rows[0]?.count ?? 0);
  } catch {
    counts.article_cluster_facets = 0;
  }

  return counts;
}

async function createDatabaseBackup(): Promise<string> {
  const dbPath = path.resolve(config.databasePath);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`数据库文件不存在：${dbPath}`);
  }

  const db = getDb();
  // 1. 刷盘 WAL 确保主文件数据完整
  try {
    await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(db);
  } catch (error) {
    console.warn('⚠️  WAL checkpoint 告警：', error instanceof Error ? error.message : String(error));
  }

  // 2. 生成备份文件名（格式同 migrate.ts）
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupPath = dbPath.replace(/\.db$/, `.backup-${timestamp}.db`);

  // 3. 物理拷贝并校验
  fs.copyFileSync(dbPath, backupPath);

  const origSize = fs.statSync(dbPath).size;
  const backupSize = fs.statSync(backupPath).size;
  if (backupSize === 0 || backupSize !== origSize) {
    throw new Error(`备份文件校验失败：源文件 ${origSize} 字节，备份文件 ${backupSize} 字节`);
  }

  return backupPath;
}

async function clearClusterTables(cleanFacets: boolean): Promise<Record<string, number>> {
  const db = getDb();
  const counts = await getTableCounts();

  // 临时关闭外键约束以支持安全高速级联清空
  await sql`PRAGMA foreign_keys = OFF`.execute(db);

  try {
    for (const table of CLUSTER_TABLES) {
      await sql`DELETE FROM ${sql.raw(table)}`.execute(db);
    }

    if (cleanFacets) {
      await sql`DELETE FROM article_cluster_facets`.execute(db);
    }

    // 重置自增序列，确保新主题 id、review id 等从 1 开始
    const tablesToReset = [...CLUSTER_TABLES, ...(cleanFacets ? ['article_cluster_facets'] : [])];
    const quoted = tablesToReset.map((t) => `'${t}'`).join(', ');
    await sql`DELETE FROM sqlite_sequence WHERE name IN (${sql.raw(quoted)})`.execute(db);
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }

  return counts;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  console.log('════════════════════════════════════════════════════════════');
  console.log('       LIS-RSS-Daily · 主题聚类全量清空与冷启动重建         ');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`数据库路径：${config.databasePath}`);
  console.log(`重构阈值参数：宏观建簇 θ_init=${CLUSTER_CONFIG.initThreshold}，子课题分面 θ_angle=${CLUSTER_CONFIG.subtopicThreshold}`);

  const counts = await getTableCounts();
  console.log('\n当前聚类数据量统计：');
  for (const table of CLUSTER_TABLES) {
    if (counts[table] > 0) {
      console.log(`  - ${table.padEnd(28)} : ${counts[table]} 行`);
    }
  }
  console.log(`  - article_cluster_facets (切面库) : ${counts.article_cluster_facets} 篇`);

  if (options.dryRun) {
    console.log('\n[DRY RUN 预检模式]');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const previewBackup = config.databasePath.replace(/\.db$/, `.backup-${timestamp}.db`);
    console.log(`  1. 预计自动备份到 : ${previewBackup}`);
    console.log(`  2. 预计清空数据表 : 上述 ${CLUSTER_TABLES.length} 张聚类与洞察表`);
    if (options.cleanFacets) {
      console.log('  3. 切面处理方式   : 【彻底清空切面】将重新从 930 篇文献全文抽取切面与向量');
    } else {
      console.log(`  3. 切面处理方式   : 【保留已有切面】直接复用 ${counts.article_cluster_facets} 篇向量切面（0 Token 重新冷启动）`);
    }
    console.log(`  4. 随后执行流程   : 创建全新 v1 集合 → 纯向量聚类 → 主题命名 → 1:1 分面脉络派生${options.skipAnalysis ? '（跳过后续耗费 Token 的 LLM 综述）' : '（全套分析与综述）'}`);
    console.log('\n预检完成，未修改数据库。正式执行请执行：pnpm run cluster:fresh-rebuild -- --yes');
    return;
  }

  if (!options.yes) {
    console.error('\n❌ 危险操作警告：该脚本将彻底清空当前所有聚类版本、主题、脉络与综述数据！');
    console.error('   若确认执行，请显式附带 --yes 参数：');
    console.error('   pnpm run cluster:fresh-rebuild -- --yes\n');
    process.exitCode = 2;
    return;
  }

  // 1. 自动物理备份
  console.log('\n[步骤 1/3] 正在对当前数据库进行完整备份...');
  const backupFile = await createDatabaseBackup();
  console.log(`  ✓ 备份成功！备份文件保存在：${backupFile}`);

  // 2. 彻底清空数据
  console.log('\n[步骤 2/3] 正在清空历史聚类与洞察数据表...');
  const cleared = await clearClusterTables(options.cleanFacets);
  console.log(`  ✓ 已清空 ${CLUSTER_TABLES.length} 张聚类表及自增序列计数。`);

  // 旧主题的 HTML 版本文件已失去归属，随元数据一并删除，避免磁盘残留。
  const documentsDir = path.join(path.dirname(config.databasePath), 'cluster-documents');
  fs.rmSync(documentsDir, { recursive: true, force: true });
  console.log('  ✓ 已删除旧的主题洞察 HTML 版本文件。');
  if (options.cleanFacets) {
    console.log(`  ✓ 已一并清空 article_cluster_facets（共 ${cleared.article_cluster_facets} 条切面）。`);
  } else {
    console.log(`  ✓ 成功保留 article_cluster_facets（共 ${cleared.article_cluster_facets} 篇），将秒级复用向量进行重聚类。`);
  }

  // 3. 执行从头冷启动
  console.log('\n[步骤 3/3] 开始全新的全量冷启动流水线 (从 v1 开始)...');
  const startedAt = Date.now();
  const summary = await runColdStart({
    facetBatchSize: 2000,
    analysisLimit: options.analysisLimit ?? 200,
    skipAnalysis: options.skipAnalysis,
    trigger: 'cold_start',
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`               全新冷启动重建完成 (耗时 ${elapsed}s)          `);
  console.log('════════════════════════════════════════════════════════════');
  console.log(`新集合版本  : v${summary.setVersion}`);
  console.log(`孵化新主题  : ${summary.incubation.createdTopicIds.length} 个全新一级主题`);
  console.log(`游离池收敛  : ${summary.routing.routedArticles} 篇已完成主题归属（多归属模型）`);
  console.log(`二级子课题  : 派生出 ${summary.derive.threadsTotal} 条子课题时序脉络`);
  console.log(`分析与综述  : 成功分析 ${summary.analysis.ok} 个，深度综述 ${summary.review.created} 篇`);

  if (options.skipAnalysis) {
    console.log('\n💡 提示：您开启了 --skip-analysis，一级主题与二级子课题已全部生成完成（可在 /clusters 页面直接查看结构）。');
    console.log('   后续如需生成具体主题的深度综述与局限空白，可使用：');
    console.log('   pnpm run cluster:insight-rebuild -- --topic <id|slug>');
  }

  console.log('\n若需要回滚到本次执行前的旧数据，可随时使用上述备份文件直接覆盖恢复。');
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
