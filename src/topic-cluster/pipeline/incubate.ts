/**
 * 步骤 3：游离池孵化新主题。
 *
 * 这是「新主题自动涌现」的唯一入口——也是本模块不能用固定标签分类器的根本原因
 * （设计文档 §7.0）：今天不存在的主题，必须能自己长出来。
 *
 * 处理对象只有**游离池**（无任何归属的文章）。因此新主题天然可能不全，
 * 由紧随其后的定向回捞（reclaim.ts）修补。
 */

import { logger } from '../../logger.js';
import { CLUSTER_CONFIG } from '../config.js';
import { parseFacetFields, type FacetFields } from '../domain/facet.js';
import { shortHash } from '../domain/hash.js';
import { cohesionClusters } from '../domain/clustering.js';
import { centroidOf, dotNormalized, vectorToBlob, blobToVector } from '../domain/vector.js';
import { nameTopic } from '../llm/naming.js';
import { listUnroutedFacets } from '../repo/facets.js';
import { assignArticleToTopic } from '../repo/links.js';
import { countTopicsInVersion, insertTopic } from '../repo/topics.js';

const log = logger.child({ module: 'topic-cluster/incubate' });

export interface IncubationResult {
  poolSize: number;
  /** 成功创建的主题 id（按簇大小降序） */
  createdTopicIds: number[];
  /** 成簇规模不足 / 命名失败而留在池中的文章数 */
  remainingPoolSize: number;
  skippedReason: string | null;
  /** 命名失败而放弃建簇的规模（便于诊断提示词问题） */
  namingFailures: number;
}

export async function runIncubation(input: {
  userId: number;
  setVersion: number;
}): Promise<IncubationResult> {
  const result: IncubationResult = {
    poolSize: 0,
    createdTopicIds: [],
    remainingPoolSize: 0,
    skippedReason: null,
    namingFailures: 0,
  };

  const facets = await listUnroutedFacets(input.userId, input.setVersion);
  result.poolSize = facets.length;
  result.remainingPoolSize = facets.length;

  if (facets.length < CLUSTER_CONFIG.minPoolSize) {
    result.skippedReason = `游离池 ${facets.length} 篇低于孵化阈值 ${CLUSTER_CONFIG.minPoolSize}`;
    return result;
  }

  const facetMap = new Map(facets.map((facet) => [facet.article_id, facet]));
  const items = facets.map((facet) => ({
    id: facet.article_id,
    vector: blobToVector(facet.embedding),
  }));

  const { components, noiseIds } = cohesionClusters(items, CLUSTER_CONFIG.initThreshold, {
    minSize: CLUSTER_CONFIG.minClusterSize,
  });

  result.remainingPoolSize = noiseIds.length;

  if (components.length === 0) {
    result.skippedReason = `游离池 ${facets.length} 篇未形成规模 ≥ ${CLUSTER_CONFIG.minClusterSize} 的簇`;
    return result;
  }

  let seq = await countTopicsInVersion(input.setVersion);

  for (const component of components) {
    const usable: Array<{ articleId: number; facet: FacetFields }> = [];
    for (const articleId of component.ids) {
      const row = facetMap.get(articleId);
      if (!row) continue;
      const facet = parseFacetFields(row.facet_json);
      if (!facet) continue;
      usable.push({ articleId, facet });
    }

    if (usable.length < CLUSTER_CONFIG.minClusterSize) continue;

    // 命名失败则整簇留在池中下轮重试——不为无名主题落库（设计文档 §7.7 拒收纪律）
    let naming: Awaited<ReturnType<typeof nameTopic>>;
    try {
      naming = await nameTopic({ userId: input.userId, facets: usable });
    } catch (error) {
      result.namingFailures += 1;
      result.remainingPoolSize += usable.length;
      log.warn(
        { size: usable.length, error: error instanceof Error ? error.message : String(error) },
        '主题命名失败，该簇保留在游离池等待下轮重试'
      );
      continue;
    }

    seq += 1;
    const memberVectors = new Map<number, Float32Array>();
    for (const item of usable) {
      memberVectors.set(item.articleId, blobToVector(facetMap.get(item.articleId)!.embedding));
    }
    const centroid = centroidOf(usable.map((item) => memberVectors.get(item.articleId)!));
    const slug = `v${input.setVersion}-t-${String(seq).padStart(3, '0')}-${shortHash(
      usable.map((item) => item.articleId).join('-')
    )}`;

    const topicId = await insertTopic({
      userId: input.userId,
      setVersion: input.setVersion,
      slug,
      name: naming.name,
      keywords: naming.keywords,
      centroid: vectorToBlob(centroid),
      centroidDim: centroid.length,
      firstEventDate: null,
      lastEventDate: null,
    });

    for (const item of usable) {
      await assignArticleToTopic({
        articleId: item.articleId,
        setVersion: input.setVersion,
        candidates: [
          {
            topicId,
            similarity: dotNormalized(centroid, memberVectors.get(item.articleId)!),
          },
        ],
        assignMethod: 'incubation',
        maxTopics: CLUSTER_CONFIG.maxTopicsPerArticle,
      });
    }

    result.createdTopicIds.push(topicId);
    result.remainingPoolSize -= usable.length;
    log.info({ topicId, slug, name: naming.name, size: usable.length }, '孵化新主题');
  }

  // createdTopicIds 按插入顺序即簇大小降序（components 已排序）
  return result;
}


