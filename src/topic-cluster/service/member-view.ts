/**
 * 主题成员视图（TopicMemberView）。
 *
 * 角色：把「链接表 + 切面表」合并成后续所有计算（质心、分链、指标、矩阵）
 * 统一消费的中间结构，避免每个环节各自解析一次 JSON。
 *
 * 这是读路径的核心：一次查询、一次解析，处处复用。
 */

import type { ArticleClusterFacetsSelection } from '../../db.js';
import { parseFacetFields, type DatePrecision, type FacetFields } from '../domain/facet.js';
import { normalizeMethodKeys, normalizeObjectKeys } from '../domain/vocab.js';
import { blobToVector } from '../domain/vector.js';
import { listFacetsByArticleIds } from '../repo/facets.js';
import { listLinksByTopic } from '../repo/links.js';

export interface TopicMemberView {
  articleId: number;
  facet: FacetFields;
  /** 已归一化的切面向量 */
  vector: Float32Array;
  eventDate: string | null;
  precision: DatePrecision;
  methodKeys: string[];
  objectKeys: string[];
  /** 该文对该主题的链接信息 */
  similarity: number;
  isPrimary: boolean;
  rank: number;
}

export interface LoadMembersOptions {
  /** 仅保留主归属（用于「严格口径」的统计） */
  primaryOnly?: boolean;
}

/** 加载主题全部成员视图（切面缺失的成员会被跳过，并回报其 id） */
export async function loadTopicMembers(
  topicId: number,
  options: LoadMembersOptions = {}
): Promise<{ members: TopicMemberView[]; missingFacetArticleIds: number[] }> {
  const links = await listLinksByTopic(topicId);
  const filtered = options.primaryOnly ? links.filter((link) => link.is_primary === 1) : links;
  if (filtered.length === 0) return { members: [], missingFacetArticleIds: [] };

  const facets = await listFacetsByArticleIds(filtered.map((link) => link.article_id));
  const facetMap = new Map<number, ArticleClusterFacetsSelection>();
  for (const facet of facets) facetMap.set(facet.article_id, facet);

  const members: TopicMemberView[] = [];
  const missingFacetArticleIds: number[] = [];

  for (const link of filtered) {
    const facetRow = facetMap.get(link.article_id);
    if (!facetRow) {
      missingFacetArticleIds.push(link.article_id);
      continue;
    }
    const facet = parseFacetFields(facetRow.facet_json);
    if (!facet) {
      missingFacetArticleIds.push(link.article_id);
      continue;
    }

    members.push({
      articleId: link.article_id,
      facet,
      vector: blobToVector(facetRow.embedding),
      eventDate: facetRow.event_date ?? null,
      precision: (facetRow.date_precision ?? 'ingest') as DatePrecision,
      methodKeys: normalizeMethodKeys(facet.method),
      objectKeys: normalizeObjectKeys(facet.study_object),
      similarity: link.similarity,
      isPrimary: link.is_primary === 1,
      rank: link.link_rank,
    });
  }

  return { members, missingFacetArticleIds };
}
