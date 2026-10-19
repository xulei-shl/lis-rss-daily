/**
 * 主题聚类质量校准脚本（离线，开发期使用）。
 *
 * 设计文档 §14.3 把「切面抽检 + 阈值校准」定为 P0 前置门禁：
 * 由于本模块全自动、无人工纠错入口，阈值没校准好，线上就没有任何补救途径。
 *
 * 本脚本输出三类可人工阅读的诊断：
 *   ① 切面样本：`method` / `study_object` 是否稳定可比较（能否真的形成矩阵）
 *   ② 簇纯度：每个主题的成员相似度分布与离群成员（低相似度者很可能是错分）
 *   ③ 阈值敏感度：在若干阈值下成簇数量与噪声比例的变化，用于选定 init 阈值
 *
 * 运行：
 *   pnpm run cluster:validate
 *   pnpm run cluster:validate -- --samples 30 --topics 8
 */

import { closeDb, getDb } from '../src/db.js';
import { CLUSTER_CONFIG } from '../src/topic-cluster/config.js';
import { cohesionClusters, type ClusterItem } from '../src/topic-cluster/domain/clustering.js';
import { parseFacetFields, type FacetFields } from '../src/topic-cluster/domain/facet.js';
import {
  listOffVocabularyTerms,
  normalizeMethodKeys,
  normalizeObjectKeys,
} from '../src/topic-cluster/domain/vocab.js';
import { blobToVector, cosine } from '../src/topic-cluster/domain/vector.js';
import { listFacets } from '../src/topic-cluster/repo/facets.js';
import { listTopicsByVersion } from '../src/topic-cluster/repo/topics.js';
import { getActiveSet } from '../src/topic-cluster/repo/sets.js';
import { loadTopicMembers } from '../src/topic-cluster/service/member-view.js';

function readArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const sampleLimit = readArg('samples', 20);
  const topicLimit = readArg('topics', 8);

  const facets = await listFacets(CLUSTER_CONFIG.userId);
  if (facets.length === 0) {
    console.log('尚无切面数据，请先执行 pnpm run cluster:init。');
    return;
  }

  console.log(`切面总数：${facets.length}\n`);
  if (facets.length < 200) {
    console.log(
      `⚠️  切面仅 ${facets.length} 篇，样本量过小：两两相似度上界随样本量上升` +
        `（${facets.length} 篇只有 ${(facets.length * (facets.length - 1)) / 2} 对，817 篇有 33 万对），\n` +
        '   因此本次只能确认「阈值下界」，不能据此定稿阈值。请抽满至少 200 篇后重跑本脚本。\n'
    );
  }

  /* ── ① 切面抽检 ── */
  console.log('══ ① 切面抽检（人工检查 method / study_object 是否稳定可比较）══');
  const step = Math.max(1, Math.floor(facets.length / sampleLimit));
  const methodCounts = new Map<string, number>();
  const objectCounts = new Map<string, number>();

  const parsedFacets: FacetFields[] = [];

  for (let i = 0; i < facets.length; i += 1) {
    const facet = parseFacetFields(facets[i].facet_json);
    if (!facet) continue;
    parsedFacets.push(facet);

    // 统计用**归一后的键**：这才是矩阵与熵真正使用的口径
    for (const key of normalizeMethodKeys(facet.method)) {
      methodCounts.set(key, (methodCounts.get(key) ?? 0) + 1);
    }
    for (const key of normalizeObjectKeys(facet.study_object)) {
      objectCounts.set(key, (objectCounts.get(key) ?? 0) + 1);
    }
  }

  for (let i = 0; i < facets.length && i / step < sampleLimit; i += step) {
    const facet = facets[i];
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(facet.facet_json);
    } catch {
      console.log(`#${facet.article_id}  ✗ facet_json 解析失败`);
      continue;
    }
    console.log(
      `#${facet.article_id}  [${facet.date_precision}] ${facet.event_date ?? '无时间'}\n` +
        `    问题：${parsed.research_question ?? ''}\n` +
        `    方法：${parsed.method ?? ''}\n` +
        `    对象：${parsed.study_object ?? ''}`
    );
  }

  console.log('\n方法词频 Top10（越集中说明规范化越好）：');
  printTopCounts(methodCounts, 10);
  console.log('\n研究对象词频 Top10：');
  printTopCounts(objectCounts, 10);

  const totalMethodKeys = [...methodCounts.values()].reduce((sum, value) => sum + value, 0);
  const avgMethodKeys = totalMethodKeys / facets.length;
  console.log(
    `\n方法词条数 ${methodCounts.size} / 提及总数 ${totalMethodKeys}（平均每篇 ${avgMethodKeys.toFixed(2)} 个方法键）` +
      (methodCounts.size > totalMethodKeys * 0.5 && avgMethodKeys < 1.5
        ? '  ⚠️ 词条过于分散，说明 method 抽取规范化不足，会削弱矩阵与脉络质量'
        : '  — 分散主要来自多方法论文的复合串，需人工看通用方法词是否收敛')
  );

  const totalObjectKeys = [...objectCounts.values()].reduce((sum, value) => sum + value, 0);
  console.log(
    `对象词条数 ${objectCounts.size} / 提及总数 ${totalObjectKeys}` +
      (objectCounts.size > totalObjectKeys * 0.8
        ? '  ⚠️ 几乎无重复键：study_object 未归类，方法×对象矩阵的对象轴会全空'
        : '  — 对象键有重复，可支撑矩阵对象轴')
  );

  // 词表外表述：不参与矩阵与熵，稳定出现即需扩充词表/别名
  const offVocabulary = listOffVocabularyTerms(parsedFacets);
  console.log(`\n词表外表述（不影响原文展示，但不进矩阵/熵）：${offVocabulary.articleCount} / ${parsedFacets.length} 篇`);
  if (offVocabulary.terms.length === 0) {
    console.log('  ✅ 无词表外表述，方法/对象均落在词表内');
  } else {
    for (const item of offVocabulary.terms.slice(0, 12)) {
      console.log(`  ${String(item.count).padStart(4)}  [${item.kind}] ${item.term}`);
    }
  }

  /* ── ② 簇纯度 ── */
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (active) {
    const topics = await listTopicsByVersion(active.version);
    console.log(
      `\n══ ② 簇纯度（版本 v${active.version}，共 ${topics.length} 个主题）══`
    );

    for (const topic of topics.slice(0, topicLimit)) {
      const { members } = await loadTopicMembers(topic.id);
      if (members.length === 0) {
        console.log(`\n#${topic.id} ${topic.name}：无成员`);
        continue;
      }
      const similarities = members.map((member) => member.similarity).sort((a, b) => a - b);
      const mean = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
      const outliers = members.filter((member) => member.similarity < CLUSTER_CONFIG.simThreshold);

      console.log(
        `\n#${topic.id} ${topic.name}\n` +
          `    篇数 ${members.length}  相似度 min=${similarities[0].toFixed(3)} ` +
          `中位=${similarities[Math.floor(similarities.length / 2)].toFixed(3)} mean=${mean.toFixed(3)} max=${similarities[similarities.length - 1].toFixed(3)}`
      );

      if (outliers.length > 0) {
        console.log(`    ⚠️ 低于路由阈值 ${CLUSTER_CONFIG.simThreshold} 的成员 ${outliers.length} 篇（可能错分）：`);
        for (const member of outliers.slice(0, 5)) {
          console.log(`       - #${member.articleId}（${member.similarity.toFixed(3)}）${member.facet.research_question.slice(0, 40)}`);
        }
      }
    }
  }

  /* ── ③ 阈值敏感度 ── */
  console.log('\n══ ③ 冷启动阈值敏感度（用于选定 CLUSTER_INIT_THRESHOLD）══');
  const items = facets.map((facet) => ({
    id: facet.article_id,
    vector: blobToVector(facet.embedding),
  }));

  const pairs = pairSimilarities(items);
  printSimilaritySpread(items, pairs);
  printConfiguredThresholds(pairs);

  // 两种连接并列打印：平均连接是生产默认，单链做对照——
  // 「簇内最小两两」明显低于 θ 就是桥接式假合并的直接证据
  for (const linkage of ['average', 'single'] as const) {
    console.log(`\n  ── ${linkage === 'average' ? '平均连接（生产默认）' : '单链（对照）'} ──`);
    for (const threshold of [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75]) {
      const { components, noiseIds } = cohesionClusters(items, threshold, {
        minSize: CLUSTER_CONFIG.minClusterSize,
        linkage,
      });
      const largest = components[0];
      const minPair = largest ? minIntraPair(largest.ids, items) : null;
      console.log(
        `  θ=${threshold.toFixed(2)}  成簇 ${String(components.length).padStart(2)} 个  ` +
          `噪声 ${String(noiseIds.length).padStart(4)} 篇（${((noiseIds.length / items.length) * 100).toFixed(1)}%）  ` +
          `最大簇 ${String(largest?.ids.length ?? 0).padStart(3)} 篇` +
          (minPair === null ? '' : `（簇内最小两两 ${minPair.toFixed(2)}）`)
      );
    }
  }

  console.log(
    '\n判断标准：噪声比例过高（>40%）说明阈值偏严、主题会孵不出来；' +
      '最大簇占比过高（>50%）说明阈值偏松、主题会糊成一团。'
  );
  console.log(
    '「簇内最小两两」是选连接方式的关键：它应当接近 θ。' +
      '明显低于 θ（如 θ=0.65 而簇内最小 0.47）说明发生了桥接式假合并。'
  );
  console.log(
    '网格下限 0.45：bge-m3 在中文图情文献切面上的相似度绝对值偏低，' +
      '若每个 θ 都成 0 簇，说明阈值整体仍在数据尺度之上，需要继续往下调。'
  );

  const linkRow = await getDb()
    .selectFrom('article_topic_links')
    .select((eb) => eb.fn.count('article_id').as('count'))
    .executeTakeFirst();
  console.log(`\n当前归属链接数：${Number(linkRow?.count ?? 0)}`);
}

/**
 * 相似度分布诊断。
 *
 * 只报「某阈值下成几个簇」不足以选阈值，必须同时看分布本身：
 *   - 两两相似度分位给出整体尺度（阈值不可能高于 p100）；
 *   - 最近邻相似度说明「每篇是否存在可归属的同伴」，
 *     它直接决定聚类能否形成 >= minClusterSize 的分量。
 */
function printSimilaritySpread(items: ClusterItem[], pairs: number[]): void {
  if (items.length < 2) {
    console.log('\n（样本不足 2 篇，跳过相似度分布诊断）');
    return;
  }

  const nearest: number[] = [];
  for (let i = 0; i < items.length; i += 1) {
    let best = -1;
    for (let j = 0; j < items.length; j += 1) {
      if (i === j) continue;
      const sim = cosine(items[i].vector, items[j].vector);
      if (sim > best) best = sim;
    }
    nearest.push(best);
  }
  nearest.sort((a, b) => a - b);

  const fmt = (value: number) => value.toFixed(3);
  console.log(
    `\n两两相似度（${pairs.length} 对）：` +
      `p10=${fmt(quantile(pairs, 0.1))} p25=${fmt(quantile(pairs, 0.25))} ` +
      `p50=${fmt(quantile(pairs, 0.5))} p75=${fmt(quantile(pairs, 0.75))} ` +
      `p90=${fmt(quantile(pairs, 0.9))} p95=${fmt(quantile(pairs, 0.95))} ` +
      `p100=${fmt(quantile(pairs, 1))}`
  );
  console.log(
    '最近邻相似度（每篇到最近一篇）：' +
      `min=${fmt(quantile(nearest, 0))} p25=${fmt(quantile(nearest, 0.25))} ` +
      `p50=${fmt(quantile(nearest, 0.5))} p75=${fmt(quantile(nearest, 0.75))} ` +
      `p100=${fmt(quantile(nearest, 1))}`
  );

  const atLeast = (threshold: number) => nearest.filter((value) => value >= threshold).length;
  console.log(
    `最近邻 >= 0.65 / 0.70 / 0.75 / 0.80 的篇数：` +
      `${atLeast(0.65)} / ${atLeast(0.7)} / ${atLeast(0.75)} / ${atLeast(0.8)}（共 ${nearest.length}）`
  );
}

function pairSimilarities(items: ClusterItem[]): number[] {
  const pairs: number[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      pairs.push(cosine(items[i].vector, items[j].vector));
    }
  }
  pairs.sort((a, b) => a - b);
  return pairs;
}

/** 簇内最小两两相似度：连接方式是否「说到做到」的直接证据 */
function minIntraPair(ids: number[], items: ClusterItem[]): number | null {
  const vectors = new Map(items.map((item) => [item.id, item.vector]));
  let min = Number.POSITIVE_INFINITY;
  let found = false;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = vectors.get(ids[i]);
      const b = vectors.get(ids[j]);
      if (!a || !b) continue;
      min = Math.min(min, cosine(a, b));
      found = true;
    }
  }
  return found ? min : null;
}

/**
 * 配置阈值在两两相似度中的位置（**文章↔文章**尺度）。
 *
 * 阈值高于 p100 = 结构性不可达，相关判定会恒为同一分支
 * （例如承接率恒为 0 → 所有角度降级为「零散研究」）。
 *
 * 注意 CLUSTER_SIM_THRESHOLD（路由）与 CLUSTER_ANGLE_THRESHOLD（角度分群）是
 * **文章→质心**尺度：质心是均值向量，相似度系统性偏高，不能用这里的分布判断。
 */
function printConfiguredThresholds(pairs: number[]): void {
  if (pairs.length === 0) return;

  const configured = [
    { name: 'CLUSTER_INIT_THRESHOLD', value: CLUSTER_CONFIG.initThreshold },
    { name: 'CLUSTER_CHAIN_THRESHOLD', value: CLUSTER_CONFIG.chainThreshold },
    { name: 'CLUSTER_STRONG_THRESHOLD', value: CLUSTER_CONFIG.strongThreshold },
  ];

  console.log('\n配置阈值在两两相似度中的位置（文章↔文章尺度）：');
  for (const item of configured) {
    const reachable = pairs.filter((value) => value >= item.value).length;
    const share = ((reachable / pairs.length) * 100).toFixed(2);
    console.log(
      `  ${item.name}=${item.value.toFixed(2)}  →  ≥ 该值的对 ${String(reachable).padStart(6)} / ${pairs.length}（${share}%）` +
        (reachable === 0 ? '  ⚠️ 结构性不可达：相关判定恒为同一分支，必须下调' : '')
    );
  }
}

function quantile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1)))];
}

function printTopCounts(counts: Map<string, number>, limit: number): void {
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (top.length === 0) {
    console.log('  （无数据）');
    return;
  }
  for (const [key, count] of top) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
  }
}

main()
  .catch((error) => {
    console.error('❌ 校准脚本失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
