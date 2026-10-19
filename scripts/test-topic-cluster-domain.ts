/**
 * 主题聚类模块 — 纯函数层验证（无需数据库、不调用 LLM/embedding）
 *
 * 覆盖两处最容易出错、且直接决定主题质量的逻辑：
 *   1. 聚类连接方式：平均连接必须消除单链的桥接式假合并，且结果与暴力 UPGMA 一致；
 *   2. 词表归一：方法/研究对象必须收敛到规范键，词表外表述不得进入矩阵。
 *
 * 运行：npx tsx scripts/test-topic-cluster-domain.ts
 *   （或 pnpm run test:topic-cluster）
 */

import assert from 'node:assert/strict';

import { cohesionClusters, type ClusterItem } from '../src/topic-cluster/domain/clustering.js';
import { splitKeys } from '../src/topic-cluster/domain/facet.js';
import { ClusterSchemaError, isPlaceholder, requireText } from '../src/topic-cluster/llm/schema.js';
import {
  FACET_METHODS,
  FACET_OBJECTS,
  listOffVocabularyTerms,
  normalizeMethodKeys,
  normalizeObjectKeys,
} from '../src/topic-cluster/domain/vocab.js';

let passed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

/* ── 工具 ── */

/** 2 维嵌入到 dim 维的归一化向量：便于用夹角精确构造已知相似度 */
function unitVector(angleDeg: number, dim = 16): Float32Array {
  const rad = (angleDeg * Math.PI) / 180;
  const vector = new Float32Array(dim);
  vector[0] = Math.cos(rad);
  vector[1] = Math.sin(rad);
  return vector;
}

/** 确定性伪随机数（避免测试结果随运行变化） */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function normalize(vector: Float32Array): Float32Array {
  const out = new Float32Array(vector);
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm);
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

/** 独立实现的暴力 UPGMA，用于校验 Lance–Williams 增量更新是否正确 */
function bruteForceAverageLinkage(vectors: Float32Array[], threshold: number): number[][] {
  let clusters = vectors.map((_, index) => [index]);

  const averageSimilarity = (a: number[], b: number[]) => {
    let sum = 0;
    for (const i of a) for (const j of b) sum += cosine(vectors[i], vectors[j]);
    return sum / (a.length * b.length);
  };

  while (clusters.length > 1) {
    let bestI = -1;
    let bestJ = -1;
    let best = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const value = averageSimilarity(clusters[i], clusters[j]);
        if (value > best) {
          best = value;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (best < threshold) break;
    clusters.push([...clusters[bestI], ...clusters[bestJ]]);
    clusters = clusters.filter((_, index) => index !== bestI && index !== bestJ);
  }

  return clusters.map((cluster) => [...cluster].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}

function partitionOf(groups: number[][]): string {
  return groups
    .map((group) => [...group].sort((a, b) => a - b).join(','))
    .sort()
    .join(' | ');
}

/* ── ① 连接方式：桥接链 ── */

console.log('① 聚类连接方式');

// 三点等角：相邻 cos30°≈0.866，首尾 cos60°=0.5
const chain: ClusterItem[] = [
  { id: 1, vector: unitVector(0) },
  { id: 2, vector: unitVector(30) },
  { id: 3, vector: unitVector(60) },
];

check('单链会把三个点并成一簇（桥接式假合并，旧行为）', () => {
  const { components } = cohesionClusters(chain, 0.7, { minSize: 3, linkage: 'single' });
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].ids, [1, 2, 3]);
});

check('平均连接在 θ=0.70 时拒绝合并首尾（0.683 < 0.70），只保留 2 点簇', () => {
  const result = cohesionClusters(chain, 0.7, { minSize: 3 });
  assert.equal(result.components.length, 0, '2 点簇低于 minSize=3 应判为噪声');
  assert.deepEqual(result.noiseIds, [1, 2, 3]);

  // 放宽 minSize 后应能看到「近邻成簇、首尾不合并」
  const relaxed = cohesionClusters(chain, 0.7, { minSize: 2 });
  assert.equal(relaxed.components.length, 1);
  assert.deepEqual(relaxed.components[0].ids, [1, 2]);
  assert.deepEqual(relaxed.noiseIds, [3]);
});

check('平均连接在低阈值下仍会全部合并（阈值语义保持一致）', () => {
  const { components, noiseIds } = cohesionClusters(chain, 0.4, { minSize: 3 });
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].ids, [1, 2, 3]);
  assert.deepEqual(noiseIds, []);
});

check('阈值高于数据上界 → 一簇不孵，全部进游离池', () => {
  const { components, noiseIds } = cohesionClusters(chain, 0.95, { minSize: 2 });
  assert.equal(components.length, 0);
  assert.deepEqual(noiseIds, [1, 2, 3]);
});

/* ── ② 平均连接与暴力 UPGMA 等价 ── */

console.log('\n② 增量更新正确性（对照暴力 UPGMA）');

// 3 个紧凑团 + 2 个离群点：确定性随机，保证无并列，结果可复现
const random = makeRandom(20260929);
const blobs: Float32Array[] = [];
const centers = [unitVector(0), unitVector(120), unitVector(240)];
for (const center of centers) {
  for (let k = 0; k < 5; k += 1) {
    const noisy = new Float32Array(center.length);
    for (let d = 0; d < center.length; d += 1) noisy[d] = center[d] + (random() - 0.5) * 0.5;
    blobs.push(normalize(noisy));
  }
}
for (let k = 0; k < 2; k += 1) {
  const noisy = new Float32Array(16);
  for (let d = 0; d < 16; d += 1) noisy[d] = random() - 0.5;
  blobs.push(normalize(noisy));
}
const blobItems: ClusterItem[] = blobs.map((vector, index) => ({ id: index + 1, vector }));

for (const threshold of [0.5, 0.7, 0.85]) {
  check(`θ=${threshold.toFixed(2)} 时簇划分与暴力 UPGMA 完全一致`, () => {
    const { components, noiseIds } = cohesionClusters(blobItems, threshold, { minSize: 3 });
    const mine = components.map((component) => component.ids);
    // 暴力实现用的是下标，转成 item id 再比对
    const expected = bruteForceAverageLinkage(blobs, threshold)
      .filter((group) => group.length >= 3)
      .map((group) => group.map((index) => blobItems[index].id));

    assert.equal(partitionOf(mine), partitionOf(expected));
    // 未成簇的项必须全部出现在 noiseIds 中，且不重复
    const noiseSet = new Set(noiseIds);
    assert.equal(noiseSet.size, noiseIds.length, 'noiseIds 不应重复');
    const covered = new Set([...mine.flat(), ...noiseIds]);
    assert.equal(covered.size, blobItems.length, '每个成员只能出现一次');
  });
}

check('结果确定性：同输入两次运行产出完全相同的 ids', () => {
  const a = cohesionClusters(blobItems, 0.7, { minSize: 3 });
  const b = cohesionClusters(blobItems, 0.7, { minSize: 3 });
  assert.equal(partitionOf(a.components.map((c) => c.ids)), partitionOf(b.components.map((c) => c.ids)));
  assert.deepEqual(a.noiseIds, b.noiseIds);
});

check('簇内 id 升序、簇按规模降序（供上游做稳定 slug/展示）', () => {
  const { components } = cohesionClusters(blobItems, 0.5, { minSize: 3 });
  for (const component of components) {
    assert.deepEqual(component.ids, [...component.ids].sort((a, b) => a - b));
  }
  for (let i = 1; i < components.length; i += 1) {
    assert.ok(components[i - 1].ids.length >= components[i].ids.length, '簇应按规模降序');
  }
});

check('空输入与单元素输入不抛错', () => {
  assert.deepEqual(cohesionClusters([], 0.7, { minSize: 3 }), { components: [], noiseIds: [] });
  const single = cohesionClusters([{ id: 9, vector: unitVector(0) }], 0.7, { minSize: 2 });
  assert.equal(single.components.length, 0);
  assert.deepEqual(single.noiseIds, [9]);
});

/* ── ③ 词表归一 ── */

console.log('\n③ 词表归一');

check('方法同义词收敛到规范键', () => {
  assert.deepEqual(normalizeMethodKeys('文献综述 + 案例分析'), ['文献研究', '案例研究']);
  assert.deepEqual(normalizeMethodKeys('网络调研法 + 扎根理论 + 内容分析法'), [
    '问卷调查',
    '扎根理论',
    '内容分析',
  ]);
});

check('具体技术归入最接近的规范方法', () => {
  assert.deepEqual(normalizeMethodKeys('模糊集定性比较分析（fsQCA）'), ['定性比较分析']);
  assert.deepEqual(normalizeMethodKeys('结构方程模型(PLS-SEM)'), ['结构方程模型']);
  assert.deepEqual(normalizeMethodKeys('LDA主题模型'), ['机器学习建模']);
});

check('研究对象剥掉括号细节后取类别', () => {
  assert.deepEqual(normalizeObjectKeys('高校图书馆（52所国内外一流高校图书馆的GenAI资源指南）'), [
    '高校图书馆',
  ]);
  assert.deepEqual(normalizeObjectKeys('图书馆联盟（近十年中英文文献82篇、129份联盟战略规划）'), [
    '图书馆联盟',
  ]);
});

check('研究对象支持嵌套括号（正则实现会在这里失效）', () => {
  assert.deepEqual(
    normalizeObjectKeys('公共图书馆（湖南省少年儿童图书馆和湘江新区（岳麓）图书馆）'),
    ['公共图书馆']
  );
});

check('不配对的右括号只去符号，不吞内容', () => {
  assert.deepEqual(normalizeObjectKeys('公共图书馆、高校图书馆）'), ['公共图书馆', '高校图书馆']);
});

check('研究对象支持多类别与别名', () => {
  assert.deepEqual(normalizeObjectKeys('公共图书馆、高校图书馆'), ['公共图书馆', '高校图书馆']);
  assert.deepEqual(normalizeObjectKeys('图书馆'), ['图书馆'], '泛指图书馆是数据驱动补入的类别');
  assert.deepEqual(normalizeObjectKeys('大学生'), ['高校学生']);
  assert.deepEqual(normalizeObjectKeys('图书馆用户'), ['公共图书馆用户']);
});

check('词表外表述不产生键，并进入 offVocabulary 报告', () => {
  assert.deepEqual(normalizeMethodKeys('德尔菲法'), ['德尔菲法'], '德尔菲法已在词表内');
  assert.deepEqual(normalizeMethodKeys('五行相生法'), []);
  assert.deepEqual(normalizeObjectKeys('图书馆员培训体系'), [], '不在词表内的对象不产生键');

  const report = listOffVocabularyTerms([
    {
      research_question: 'q',
      method: '德尔菲法 + 五行相生法',
      study_object: '图书馆员培训体系',
      core_finding: 'f',
    },
  ]);
  assert.equal(report.articleCount, 1);
  assert.deepEqual(
    report.terms.map((item) => `${item.kind}:${item.term}`).sort(),
    ['method:五行相生法', 'object:图书馆员培训体系']
  );
});

check('词表本身无重复、无空项', () => {
  assert.equal(new Set(FACET_METHODS).size, FACET_METHODS.length);
  assert.equal(new Set(FACET_OBJECTS).size, FACET_OBJECTS.length);
  for (const name of [...FACET_METHODS, ...FACET_OBJECTS]) {
    assert.ok(name.trim().length >= 2, `词表项过短：${name}`);
  }
});

check('splitKeys 不在括号内切分（规范写法的前提）', () => {
  assert.deepEqual(splitKeys('高校学生（38所高校、213名大学生）'), ['高校学生（38所高校、213名大学生）']);
  assert.deepEqual(splitKeys('公共图书馆、高校图书馆'), ['公共图书馆', '高校图书馆']);
});

/* ── ④ LLM 输出校验器（占位符判据） ── */

console.log('\n④ 占位符判据');

// 该函数已错三次，每次都是判据漏洞，因此把两类反例都固化成用例：
//   reject = 真的没信息；keep = 合法术语/短结论，绝不能被误伤
const PLACEHOLDER_CASES: Array<{ value: string; placeholder: boolean; note: string }> = [
  { value: '未明确说明', placeholder: true, note: '模型看不到输入时的经典输出' },
  { value: '暂无相关数据', placeholder: true, note: '第二轮漏洞' },
  { value: '暂无统一结论', placeholder: true, note: '第二轮漏洞' },
  { value: '未明确', placeholder: true, note: '首轮锚定匹配的漏洞' },
  { value: '待补充信息', placeholder: true, note: '标记 + 套话名词' },
  { value: '相关内容', placeholder: true, note: '全是套话名词' },
  { value: '无', placeholder: true, note: '单字否定' },
  { value: 'TBD', placeholder: true, note: 'ASCII 标记（大小写无关）' },
  { value: 'N/A', placeholder: true, note: 'ASCII 标记（大小写无关）' },
  { value: 'none', placeholder: true, note: 'ASCII 标记' },
  { value: '', placeholder: true, note: '空串' },
  { value: '内容分析', placeholder: false, note: '⚠️ 第三轮误伤：「内容」是词表里的合法方法成分' },
  { value: '数据分析', placeholder: false, note: '⚠️ 同上，通用名词也是术语成分' },
  { value: '无障碍服务', placeholder: false, note: '⚠️ 上面那个「无」字不能单独当判据' },
  { value: '信息素养教育', placeholder: false, note: '⚠️ 同上' },
  { value: '问卷调查', placeholder: false, note: '合法方法词' },
  { value: '无显著影响', placeholder: false, note: '合法的短结论' },
  { value: '未明确提及样本量，但补充说明了两所高校', placeholder: false, note: '有标记但实质内容充足' },
  { value: '高校学生（51 名）', placeholder: false, note: '合法的规范对象写法' },
];

for (const testCase of PLACEHOLDER_CASES) {
  check(
    `${testCase.placeholder ? '拒收' : '放行'}「${testCase.value || '(空串)'}」— ${testCase.note}`,
    () => {
      assert.equal(isPlaceholder(testCase.value), testCase.placeholder);
    }
  );
}

check('requireText 对占位符抛 ClusterSchemaError、对合法值返回原文', () => {
  assert.throws(() => requireText('未明确说明', 'method', 2), ClusterSchemaError);
  assert.equal(requireText(' 内容分析 ', 'method', 2), '内容分析');
});

console.log(`\n全部通过：${passed} 项`);
