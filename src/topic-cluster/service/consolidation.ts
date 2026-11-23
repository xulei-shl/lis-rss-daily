import { getDb } from '../../db.js';
import { CLUSTER_CONFIG, CLUSTER_LIMITS } from '../config.js';
import { listTopicsByVersion, getTopicById, markTopicDirty, updateTopicDates } from '../repo/topics.js';
import {
  assignArticleToTopic,
  countTopicLinks,
  getLinksForArticle,
  getTopicMemberIds,
  refreshTopicCounts,
} from '../repo/links.js';
import { listFacets } from '../repo/facets.js';
import { blobToVector, centroidOf, cosine, vectorToBlob } from '../domain/vector.js';
import { resolveTopicDateRange } from '../service/centroid.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'topic-cluster/consolidation' });

export interface ConsolidationMerge {
  smallTopicId: number;
  targetTopicId: number;
  similarity: number;
  smallSize: number;
  targetSizeBefore: number;
  targetSizeAfter: number;
}

export interface ConsolidationResult {
  setVersion: number;
  dryRun: boolean;
  merges: ConsolidationMerge[];
  removedTopicIds: number[];
  affectedTopicIds: number[];
  remainingSmall: number;
}

interface TopicState {
  id: number;
  name: string;
  keywords: string[];
  size: number;
  centroid: Float32Array;
  removed?: boolean;
}

function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  } catch {
    return [String(raw)];
  }
}

function keywordOverlap(a: string[], b: string[]): number {
  const left = new Set(a.map((item) => item.toLowerCase()));
  let count = 0;
  for (const item of b) if (left.has(item.toLowerCase())) count += 1;
  return count;
}

/** 通用学术词，避免仅因“研究/框架/治理”这类词就判定主题同义。 */
const GENERIC_NAME_BIGRAMS = new Set([
  '研究', '应用', '评价', '构建', '框架', '治理', '时代', '发展', '路径', '机制',
  '模式', '实践', '探索', '影响', '分析', '技术', '服务', '管理', '建设', '资源',
  '方法', '视角', '视域', '面向', '基于', '策略', '体系', '平台', '系统', '创新',
  '融合', '赋能', '图书', '书馆', '数智', '智化', '化转', '转型',
]);

function nameBigrams(name: string): Set<string> {
  const text = name.toLowerCase().replace(/[^0-9a-z\u4e00-\u9fff]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const gram = text.slice(i, i + 2);
    if (!GENERIC_NAME_BIGRAMS.has(gram)) out.add(gram);
  }
  return out;
}

function nameOverlap(a: string, b: string): number {
  const left = nameBigrams(a);
  let count = 0;
  for (const gram of nameBigrams(b)) if (left.has(gram)) count += 1;
  return count;
}

function weightedCentroid(
  a: Float32Array,
  sizeA: number,
  b: Float32Array,
  sizeB: number
): Float32Array {
  const total = sizeA + sizeB;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = (a[i] * sizeA + b[i] * sizeB) / total;
  }
  let norm = 0;
  for (let i = 0; i < out.length; i += 1) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

function planMerges(initial: TopicState[]): ConsolidationMerge[] {
  const topics = initial.map((topic) => ({ ...topic, removed: false }));
  const merges: ConsolidationMerge[] = [];
  let changed = true;

  while (changed) {
    changed = false;
    const active = topics.filter((topic) => !topic.removed);
    const smalls = active
      .filter((topic) => topic.size < CLUSTER_LIMITS.minArticlesForAnalysis)
      .sort((a, b) => a.size - b.size || a.id - b.id);
    if (smalls.length === 0) break;

    let best: {
      small: TopicState;
      target: TopicState;
      similarity: number;
      score: number;
    } | null = null;

    for (const small of smalls) {
      if (!small.centroid) continue;
      for (const target of active) {
        if (target.id === small.id || target.removed) continue;
        if (!target.centroid) continue;
        const similarity = cosine(small.centroid, target.centroid);
        const threshold =
          target.size < CLUSTER_LIMITS.minArticlesForAnalysis
            ? CLUSTER_LIMITS.smallTopicMergeThreshold
            : CLUSTER_LIMITS.smallTopicAbsorbThreshold;
        if (similarity < threshold) continue;
        const overlap = keywordOverlap(small.keywords, target.keywords);
        const titleOverlap = nameOverlap(small.name, target.name);
        const targetIsSmall = target.size < CLUSTER_LIMITS.minArticlesForAnalysis;
        // 小主题互并看标题重合即可；被正式主题吸收要更严格，避免把微主题塞进大而泛的主题。
        const semanticMatch = targetIsSmall
          ? overlap >= 1 || titleOverlap >= 2 || similarity >= 0.85
          : overlap >= 1 || titleOverlap >= 5;
        if (!semanticMatch) continue;
        if (target.size >= 50 && overlap < 2) continue;
        const score =
          similarity + (target.size >= CLUSTER_LIMITS.minArticlesForAnalysis ? 0.005 : 0);
        if (
          !best ||
          score > best.score ||
          (score === best.score && target.id < best.target.id)
        ) {
          best = { small, target, similarity, score };
        }
      }
    }

    if (!best) break;

    merges.push({
      smallTopicId: best.small.id,
      targetTopicId: best.target.id,
      similarity: best.similarity,
      smallSize: best.small.size,
      targetSizeBefore: best.target.size,
      targetSizeAfter: best.small.size + best.target.size,
    });

    best.target.size += best.small.size;
    best.target.centroid = weightedCentroid(
      best.target.centroid,
      best.target.size - best.small.size,
      best.small.centroid,
      best.small.size
    );
    best.small.removed = true;
    changed = true;
  }

  return merges;
}

function countRemainingSmall(initial: TopicState[], merges: ConsolidationMerge[]): number {
  const sizes = new Map(initial.map((topic) => [topic.id, topic.size]));
  const removed = new Set<number>();
  for (const merge of merges) {
    removed.add(merge.smallTopicId);
    sizes.set(merge.targetTopicId, (sizes.get(merge.targetTopicId) ?? 0) + (sizes.get(merge.smallTopicId) ?? 0));
  }
  let count = 0;
  for (const [topicId, size] of sizes) {
    if (!removed.has(topicId) && size < CLUSTER_LIMITS.minArticlesForAnalysis) count += 1;
  }
  return count;
}

async function loadTopicStates(setVersion: number): Promise<TopicState[]> {
  const topics = await listTopicsByVersion(setVersion);
  const states: TopicState[] = [];
  for (const topic of topics) {
    if (!topic.centroid) continue;
    const { linked } = await countTopicLinks(topic.id);
    states.push({
      id: topic.id,
      name: topic.name,
      keywords: parseKeywords(topic.keywords),
      size: linked,
      centroid: blobToVector(topic.centroid),
    });
  }
  return states;
}

async function applyMerge(
  smallTopicId: number,
  targetTopicId: number,
  setVersion: number,
  embeddings: Map<number, Float32Array>
): Promise<void> {
  const db = getDb();
  const smallTopic = await getTopicById(smallTopicId);
  const targetTopic = await getTopicById(targetTopicId);
  if (!smallTopic || !targetTopic || !targetTopic.centroid) {
    throw new Error(`合并主题不存在: ${smallTopicId} -> ${targetTopicId}`);
  }

  const smallMembers = await getTopicMemberIds(smallTopicId);
  const targetCentroid = blobToVector(targetTopic.centroid);

  for (const articleId of smallMembers) {
    const vector = embeddings.get(articleId);
    const similarity = vector ? cosine(vector, targetCentroid) : 0;
    await assignArticleToTopic({
      articleId,
      setVersion,
      candidates: [{ topicId: targetTopicId, similarity }],
      assignMethod: 'centroid',
      maxTopics: 3,
    });
  }

  await db
    .deleteFrom('article_topic_links')
    .where('topic_id', '=', smallTopicId)
    .where('set_version', '=', setVersion)
    .execute();

  // 删除旧链接后重新排序，避免原主归属被删后文章没有主归属。
  for (const articleId of smallMembers) {
    const remaining = await getLinksForArticle(articleId, setVersion);
    if (remaining.length === 0) continue;
    await assignArticleToTopic({
      articleId,
      setVersion,
      candidates: remaining.map((link) => ({
        topicId: link.topic_id,
        similarity: link.similarity,
      })),
      assignMethod: 'centroid',
      maxTopics: CLUSTER_CONFIG.maxTopicsPerArticle,
    });
  }

  const mergeSimilarity = cosine(blobToVector(smallTopic.centroid!), targetCentroid);
  await db
    .insertInto('cluster_topic_merge_remap')
    .values({
      old_topic_id: smallTopicId,
      old_slug: smallTopic.slug,
      new_topic_id: targetTopicId,
      similarity: mergeSimilarity,
      set_version: setVersion,
    })
    .onConflict((oc) =>
      oc.columns(['old_topic_id', 'new_topic_id']).doUpdateSet({
        old_slug: smallTopic.slug,
        similarity: mergeSimilarity,
        set_version: setVersion,
      })
    )
    .execute();

  await db.deleteFrom('cluster_topics').where('id', '=', smallTopicId).execute();

  const newMembers = await getTopicMemberIds(targetTopicId);
  const vectors = newMembers
    .map((articleId) => embeddings.get(articleId))
    .filter((vector): vector is Float32Array => Boolean(vector));
  if (vectors.length > 0) {
    const centroid = centroidOf(vectors);
    await db
      .updateTable('cluster_topics')
      .set({
        centroid: vectorToBlob(centroid),
        centroid_dim: centroid.length,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', targetTopicId)
      .execute();
  }

  await refreshTopicCounts(targetTopicId);
  const range = await resolveTopicDateRange(targetTopicId);
  await updateTopicDates(targetTopicId, range.first, range.last);
  await markTopicDirty(targetTopicId);

  log.info(
    { smallTopicId, targetTopicId, members: smallMembers.length },
    '微主题已整合'
  );
}

export async function consolidateSmallTopics(
  setVersion: number,
  options: { dryRun?: boolean } = {}
): Promise<ConsolidationResult> {
  const facets = await listFacets(CLUSTER_CONFIG.userId);
  const embeddings = new Map(
    facets.map((facet) => [facet.article_id, blobToVector(facet.embedding)])
  );

  const initial = await loadTopicStates(setVersion);
  const merges = planMerges(initial);

  if (!options.dryRun) {
    for (const merge of merges) {
      await applyMerge(merge.smallTopicId, merge.targetTopicId, setVersion, embeddings);
    }
  }

  const remainingSmall = options.dryRun
    ? countRemainingSmall(initial, merges)
    : (await loadTopicStates(setVersion)).filter(
        (topic) => topic.size < CLUSTER_LIMITS.minArticlesForAnalysis
      ).length;

  const result: ConsolidationResult = {
    setVersion,
    dryRun: Boolean(options.dryRun),
    merges,
    removedTopicIds: merges.map((merge) => merge.smallTopicId),
    affectedTopicIds: [...new Set(merges.map((merge) => merge.targetTopicId))],
    remainingSmall,
  };

  log.info(
    {
      setVersion,
      dryRun: result.dryRun,
      merges: merges.length,
      removed: result.removedTopicIds.length,
      remainingSmall,
    },
    '微主题整合完成'
  );

  return result;
}
