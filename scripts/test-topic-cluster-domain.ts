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

import {
  buildSteps,
  buildThreads,
  groupAngles,
  type AngleGroup,
  type ChainItem,
} from '../src/topic-cluster/domain/chaining.js';
import { cohesionClusters, type ClusterItem } from '../src/topic-cluster/domain/clustering.js';
import { buildReviewGroups } from '../src/topic-cluster/service/review-builder.js';
import { buildParadigmDomains } from '../src/topic-cluster/service/paradigm.js';
import type { TopicMemberView } from '../src/topic-cluster/service/member-view.js';
import type { MatrixResult } from '../src/topic-cluster/service/matrix.js';
import { addMonths } from '../src/topic-cluster/domain/metrics.js';
import { fillMissingMonths, type PeriodPoint } from '../src/topic-cluster/service/metrics-builder.js';
import { pickBestTopic } from '../src/topic-cluster/repo/remap.js';
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

/* ── ④ 脉络：发散保留、角色、angle_key ── */

console.log('\n④ 脉络与角度身份');

function chainItem(
  articleId: number,
  angleDeg: number,
  eventDate: string,
  method = '实验研究',
  object = '高校图书馆'
): ChainItem {
  return {
    articleId,
    vector: unitVector(angleDeg),
    eventDate,
    precision: 'day',
    methodKeys: [method],
    objectKeys: [object],
  };
}

function angleOf(items: ChainItem[], angleKey = 'a-test'): AngleGroup {
  const centroid = normalize(
    items.reduce((sum, item) => {
      for (let i = 0; i < item.vector.length; i += 1) sum[i] += item.vector[i];
      return sum;
    }, new Float32Array(items[0].vector.length))
  );
  return { angleKey, angleLabel: null, members: items, centroid };
}

const threadOptions = {
  minThreadLength: 3,
  strongThreshold: 0.88,
  chainThreshold: 0.78,
};

check('完全没有连续承接段的角度保留为 divergent，成员不再进入 loose', () => {
  // 相邻 cos47°≈0.68 < 0.78，且方法/对象都不同 → 每条边都是 shift；
  // 角度仍必须保留全部 8 篇。
  const items = Array.from({ length: 8 }, (_, index) =>
    chainItem(
      index + 1,
      index * 47,
      `2025-0${(index % 9) + 1}-01`,
      `方法-${index}`,
      `对象-${index}`
    )
  );
  const { threads, loose } = buildThreads([angleOf(items)], threadOptions);

  assert.equal(loose.length, 0);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].patternType, 'divergent');
  assert.equal(threads[0].steps.length, 8);
  assert.ok(threads[0].representatives.length >= 1 && threads[0].representatives.length <= 4);
  assert.ok(threads[0].steps.every((step) => Boolean(step.academicRole)));
});

check('高承接角度保留为 linear，成员全部是 backbone', () => {
  const items = Array.from({ length: 5 }, (_, index) =>
    chainItem(index + 1, 0, `2025-0${index + 1}-01`)
  );
  const { threads } = buildThreads([angleOf(items)], threadOptions);

  assert.equal(threads[0].patternType, 'linear');
  assert.equal(threads[0].representatives.length, 0);
  assert.ok(threads[0].steps.every((step) => step.academicRole === 'backbone'));
});

check('局部连续段存在时不再整簇判为 divergent', () => {
  // 前 3 篇同向量形成 2 条承接边，后 5 篇在 90°/180° 间来回转向：
  // 全簇承接率很低，但局部连续段必须被识别出来。
  const items = [
    chainItem(1, 0, '2025-01-01', '方法-A', '对象-A'),
    chainItem(2, 0, '2025-02-01', '方法-A', '对象-A'),
    chainItem(3, 0, '2025-03-01', '方法-A', '对象-A'),
    chainItem(4, 90, '2025-04-01', '方法-B', '对象-B'),
    chainItem(5, 180, '2025-05-01', '方法-C', '对象-C'),
    chainItem(6, 90, '2025-06-01', '方法-D', '对象-D'),
    chainItem(7, 180, '2025-07-01', '方法-E', '对象-E'),
    chainItem(8, 90, '2025-08-01', '方法-F', '对象-F'),
  ];
  const { threads } = buildThreads([angleOf(items)], threadOptions);

  assert.equal(threads[0].patternType, 'linear');
  assert.deepEqual(
    threads[0].steps
      .filter((step) => step.academicRole === 'backbone')
      .map((step) => step.articleId),
    [1, 2, 3]
  );
  assert.ok(
    threads[0].steps
      .filter((step) => step.articleId > 3)
      .every((step) => step.academicRole === 'divergent')
  );
});

check('跨时间精度的相邻对不构成连续承接', () => {
  const items = [
    { ...chainItem(1, 0, '2025-01-01', '方法-A', '对象-A'), precision: 'year' as const },
    { ...chainItem(2, 0, '2025-01-02', '方法-A', '对象-A'), precision: 'day' as const },
    { ...chainItem(3, 0, '2025-01-03', '方法-A', '对象-A'), precision: 'year' as const },
  ];
  const steps = buildSteps(angleOf(items), threadOptions);

  assert.ok(
    steps
      .slice(1)
      .every((step) => step.crossPrecision && step.relation === 'shift')
  );
});

check('同签名角度追加冲突后缀，angle_key 全局唯一', () => {
  // 两组向量相距 180°，但方法/对象完全相同 → buildAngleKey 同签名
  const items = [
    ...Array.from({ length: 6 }, (_, index) => chainItem(index + 1, 0, `2025-01-0${index + 1}`)),
    ...Array.from({ length: 6 }, (_, index) =>
      chainItem(index + 7, 180, `2025-02-0${index + 1}`)
    ),
  ];
  const angles = groupAngles(items, 0.82, { maxAngleCount: 10 });
  const keys = angles.map((angle) => angle.angleKey);

  assert.equal(angles.length, 2);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.some((key) => /-\d+$/.test(key)), '第二个同签名角度应带 -2 后缀');
});

check('成员小幅变动时复用旧 angle_key，避免身份漂移', () => {
  const base = [
    ...Array.from({ length: 6 }, (_, index) => chainItem(index + 1, 0, `2025-01-0${index + 1}`)),
    ...Array.from({ length: 6 }, (_, index) =>
      chainItem(index + 7, 180, `2025-02-0${index + 1}`)
    ),
  ];
  const first = groupAngles(base, 0.82, { maxAngleCount: 10 });
  const previous = first.map((angle) => ({
    angleKey: angle.angleKey,
    angleLabel: '旧标签',
    articleIds: angle.members.map((member) => member.articleId),
  }));

  const withNewMember = [...base, chainItem(99, 5, '2025-03-01')];
  const second = groupAngles(withNewMember, 0.82, {
    maxAngleCount: 10,
    previous,
  });

  const oldKey = first.find((angle) =>
    angle.members.some((member) => member.articleId === 1)
  )?.angleKey;
  const newKey = second.find((angle) =>
    angle.members.some((member) => member.articleId === 1)
  )?.angleKey;

  assert.ok(oldKey);
  assert.equal(newKey, oldKey);
  assert.equal(
    second.find((angle) => angle.angleKey === oldKey)?.angleLabel,
    '旧标签'
  );
});

check('243 篇压力用例：角度 3~10、成员不丢、angle_key 唯一、loose=0', () => {
  const items = Array.from({ length: 243 }, (_, index) =>
    chainItem(
      index + 1,
      (index % 10) * 36 + (index % 5),
      `2025-${String((index % 12) + 1).padStart(2, '0')}-01`,
      index % 2 === 0 ? '实验研究' : '问卷调查',
      index % 2 === 0 ? '高校图书馆' : '公共图书馆'
    )
  );
  const angles = groupAngles(items, 0.72, { maxAngleCount: 10 });

  assert.ok(angles.length >= 3 && angles.length <= 10, `角度数应在 3~10，实际 ${angles.length}`);
  assert.equal(
    new Set(angles.flatMap((angle) => angle.members.map((member) => member.articleId))).size,
    243
  );
  assert.equal(new Set(angles.map((angle) => angle.angleKey)).size, angles.length);

  const { threads, loose } = buildThreads(angles, threadOptions);
  assert.equal(loose.length, 0);
  assert.equal(
    new Set(threads.flatMap((thread) => thread.steps.map((step) => step.articleId))).size,
    243
  );
});

/* ── ⑤ 深度综述只合并角度，不独立切分成员 ── */

console.log('\n⑤ 深度综述与角度分区的一致性');

check('综述组只能由完整角度合并而成，不会拆开同一角度', () => {
  const members: TopicMemberView[] = [];
  for (let cluster = 0; cluster < 2; cluster += 1) {
    const base = cluster === 0 ? 0 : 120;
    for (let index = 0; index < 10; index += 1) {
      const articleId = cluster * 10 + index + 1;
      members.push({
        articleId,
        vector: unitVector(base),
        eventDate: `2025-${String(cluster * 6 + index + 1).padStart(2, '0')}-01`,
        precision: 'day',
        methodKeys: ['实验研究'],
        objectKeys: ['高校图书馆'],
        similarity: 0.8,
        isPrimary: true,
        rank: articleId,
        facet: {
          research_question: `问题 ${articleId}`,
          method: '实验研究',
          study_object: '高校图书馆',
          core_finding: `发现 ${articleId}`,
        },
      });
    }
  }

  const angles = groupAngles(
    members.map((member) => ({
      articleId: member.articleId,
      vector: member.vector,
      eventDate: member.eventDate,
      precision: member.precision,
      methodKeys: member.methodKeys,
      objectKeys: member.objectKeys,
    })),
    0.82,
    { maxAngleCount: 10 }
  );
  const groups = buildReviewGroups(members, new Map());

  assert.equal(angles.length, 2);
  assert.equal(groups.length, 2);
  for (const group of groups) {
    for (const angle of angles) {
      const inside = angle.members.filter((member) =>
        group.memberIds.includes(member.articleId)
      ).length;
      assert.ok(
        inside === 0 || inside === angle.members.length,
        `角度 ${angle.angleKey} 被综述组拆开了`
      );
    }
  }
});

/* ── ⑥ 范式域聚合 ── */

console.log('\n⑥ 范式域聚合');

check('6 个高频格聚成 3~5 个范式域，每域代表 ≤7 篇', () => {
  const members: TopicMemberView[] = [];
  const cells: MatrixResult['cells'] = [];
  const methods = ['实验研究', '问卷调查', '案例研究'];
  const objects = ['高校图书馆', '公共图书馆'];
  let id = 1;

  for (let m = 0; m < methods.length; m += 1) {
    for (let o = 0; o < objects.length; o += 1) {
      const articleIds: number[] = [];
      for (let k = 0; k < 3; k += 1) {
        const articleId = id++;
        articleIds.push(articleId);
        members.push({
          articleId,
          vector: unitVector(m * 60 + o * 20 + k * 2),
          eventDate: `2024-0${(k % 9) + 1}-01`,
          precision: 'day',
          methodKeys: [methods[m]],
          objectKeys: [objects[o]],
          similarity: 0.8,
          isPrimary: true,
          rank: articleId,
          facet: {
            research_question: `问题 ${articleId}`,
            method: methods[m],
            study_object: objects[o],
            core_finding: `发现 ${articleId}`,
          },
        });
      }
      cells.push({ method: methods[m], object: objects[o], count: 3, articleIds });
    }
  }

  const matrix: MatrixResult = {
    methods,
    objects,
    cells,
    holes: [],
  };
  const { domains, sparseArticleIds } = buildParadigmDomains(matrix, members);

  assert.ok(domains.length >= 3 && domains.length <= 5, `域数 ${domains.length}`);
  assert.equal(sparseArticleIds.length, 0);
  for (const domain of domains) {
    assert.ok(domain.representativeIds.length <= 7);
    assert.ok(domain.articleCount >= domain.representativeIds.length);
  }
  assert.equal(
    new Set(domains.flatMap((domain) => domain.representativeIds)).size,
    domains.flatMap((domain) => domain.representativeIds).length
  );
});

/* ── ⑦ 周期指标月份补齐 ── */

console.log('\n⑦ 周期指标月份补齐');

check('addMonths 处理跨年与负偏移', () => {
  assert.equal(addMonths('2026-01', 1), '2026-02');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-01', 12), '2027-01');
});

check('首尾之间的空月补成 added=0、指标 null 的连续月', () => {
  const point = (period: string, articleId: number): PeriodPoint => ({
    period,
    articleIds: [articleId],
    primaryCount: 1,
    avgSimilarity: 0.8,
    vectors: [unitVector(10)],
    methodKeys: ['实验研究'],
    objectKeys: ['高校图书馆'],
  });

  const filled = fillMissingMonths([point('2025-11', 1), point('2026-02', 2)]);
  assert.deepEqual(
    filled.map((item) => item.period),
    ['2025-11', '2025-12', '2026-01', '2026-02']
  );
  assert.equal(filled[0].articleIds.length, 1);
  assert.equal(filled[1].articleIds.length, 0);
  assert.equal(filled[1].primaryCount, 0);
  assert.equal(filled[1].avgSimilarity, null);
  assert.deepEqual(filled[1].vectors, []);
  assert.equal(filled[3].articleIds.length, 1);
});

check('单月与空输入不额外补齐', () => {
  assert.deepEqual(fillMissingMonths([]), []);
  const single = fillMissingMonths([
    {
      period: '2026-03',
      articleIds: [1],
      primaryCount: 1,
      avgSimilarity: 0.7,
      vectors: [],
      methodKeys: [],
      objectKeys: [],
    },
  ]);
  assert.equal(single.length, 1);
});

/* ── ⑧ 跨版本 remap 选择 ── */

console.log('\n⑧ 跨版本 remap 选择');

check('选质心最相似的新主题，低于 0.72 不重定向', () => {
  const oldVector = unitVector(0);
  const best = pickBestTopic(oldVector, [
    { topicId: 10, vector: unitVector(20) },
    { topicId: 11, vector: unitVector(5) },
    { topicId: 12, vector: unitVector(40) },
  ]);
  assert.equal(best?.topicId, 11);
  assert.ok((best?.similarity ?? 0) >= 0.72);

  assert.equal(
    pickBestTopic(oldVector, [{ topicId: 20, vector: unitVector(90) }]),
    null
  );
});

console.log(`\n全部通过：${passed} 项`);
