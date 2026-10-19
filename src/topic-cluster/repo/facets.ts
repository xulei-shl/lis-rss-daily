/**
 * 切面仓储（article_cluster_facets）。
 *
 * 性能约束（设计文档 §15.3 I2）：better-sqlite3 是同步驱动，
 * 逐行写入会阻塞事件循环，因此提供**批量事务**写入入口。
 */

import { getDb, type ArticleClusterFacetsSelection } from '../../db.js';
import type { DatePrecision } from '../domain/facet.js';
import { CLUSTER_CONFIG } from '../config.js';

export interface FacetInsertRow {
  articleId: number;
  userId: number;
  facetJson: string;
  facetText: string;
  facetContractVersion: string;
  embedding: Buffer;
  embeddingModel: string | null;
  embeddingDim: number;
  eventDate: string | null;
  datePrecision: DatePrecision;
}

/** 单篇切面 */
export async function getFacet(articleId: number): Promise<ArticleClusterFacetsSelection | undefined> {
  return getDb()
    .selectFrom('article_cluster_facets')
    .selectAll()
    .where('article_id', '=', articleId)
    .executeTakeFirst();
}

/** 某用户全部切面（冷启动/全量扫描用，量级为数百条） */
export async function listFacets(userId: number): Promise<ArticleClusterFacetsSelection[]> {
  return getDb()
    .selectFrom('article_cluster_facets')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('article_id', 'asc')
    .execute();
}

/** 指定文章的切面 */
export async function listFacetsByArticleIds(
  articleIds: number[]
): Promise<ArticleClusterFacetsSelection[]> {
  if (articleIds.length === 0) return [];
  return getDb()
    .selectFrom('article_cluster_facets')
    .selectAll()
    .where('article_id', 'in', articleIds)
    .execute();
}

export async function countFacets(userId: number): Promise<number> {
  const row = await getDb()
    .selectFrom('article_cluster_facets')
    .where('user_id', '=', userId)
    .select((eb) => eb.fn.count('article_id').as('count'))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/**
 * 批量写入切面（单条 SQL + 事务）。
 *
 * 使用 upsert：同一篇文章重算切面时覆盖，保证幂等。
 */
export async function upsertFacetsBatch(rows: FacetInsertRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  const now = new Date().toISOString();

  await db.transaction().execute(async (trx) => {
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await trx
        .insertInto('article_cluster_facets')
        .values(
          chunk.map((row) => ({
            article_id: row.articleId,
            user_id: row.userId,
            facet_json: row.facetJson,
            facet_text: row.facetText,
            facet_contract_version: row.facetContractVersion,
            embedding: row.embedding,
            embedding_model: row.embeddingModel,
            embedding_dim: row.embeddingDim,
            event_date: row.eventDate,
            date_precision: row.datePrecision,
            updated_at: now,
          }))
        )
        .onConflict((oc) =>
          oc.column('article_id').doUpdateSet((eb) => ({
            facet_json: eb.ref('excluded.facet_json'),
            facet_text: eb.ref('excluded.facet_text'),
            facet_contract_version: eb.ref('excluded.facet_contract_version'),
            embedding: eb.ref('excluded.embedding'),
            embedding_model: eb.ref('excluded.embedding_model'),
            embedding_dim: eb.ref('excluded.embedding_dim'),
            event_date: eb.ref('excluded.event_date'),
            date_precision: eb.ref('excluded.date_precision'),
            updated_at: now,
          }))
        )
        .execute();
    }
  });

  return rows.length;
}

/**
 * 返回这批文章中**已有合格切面**的 id。
 *
 * 「合格」= 已落库且 facet_contract_version 与当前配置一致。
 * 契约版本不一致的切面必须重抽——这是设计文档 §7.9 的重建触发条件之一。
 */
export async function listArticleIdsWithFacet(articleIds: number[]): Promise<Set<number>> {
  if (articleIds.length === 0) return new Set();
  const rows = await getDb()
    .selectFrom('article_cluster_facets')
    .select(['article_id', 'facet_contract_version'])
    .where('article_id', 'in', articleIds)
    .execute();

  const ready = new Set<number>();
  for (const row of rows) {
    if (row.facet_contract_version === CLUSTER_CONFIG.facetContractVersion) {
      ready.add(row.article_id);
    }
  }
  return ready;
}

/**
 * 游离池：在该版本下**无任何归属链接**的文章切面（设计文档 §7.4）。
 *
 * 这是「游离池」定义的唯一出处（设计文档 §13.4.2 预留点）。
 * 路由、孵化、回捞三条路径都以本查询为准，避免三处口径不一致。
 * 未来若加入「人工排除」，只需在此追加 `NOT EXISTS(override)` 条件。
 */
export async function listUnroutedFacets(
  userId: number,
  setVersion: number,
  minArticleId?: number
): Promise<ArticleClusterFacetsSelection[]> {
  let query = getDb()
    .selectFrom('article_cluster_facets as f')
    .leftJoin('article_topic_links as l', (join) =>
      join.onRef('l.article_id', '=', 'f.article_id').on('l.set_version', '=', setVersion)
    )
    .where('f.user_id', '=', userId)
    .where('l.article_id', 'is', null)
    .selectAll('f');

  if (minArticleId) {
    query = query.where('f.article_id', '>', minArticleId);
  }

  return query.orderBy('f.article_id', 'asc').execute();
}

export async function deleteFacet(articleId: number): Promise<void> {
  await getDb().deleteFrom('article_cluster_facets').where('article_id', '=', articleId).execute();
}

/**
 * 批量删除切面（仅用于小样本重抽：调完提示词后重跑同一批文章）。
 *
 * ⚠️ 调用方需自行确认这些文章已无归属链接，否则会留下「有链接但无切面」的脏数据
 * （脉络计算会因此漏掉成员）。生产环境的全量重抽应改用
 * `CLUSTER_FACET_CONTRACT_VERSION` 升版，而不是删数据。
 */
export async function deleteFacets(articleIds: number[]): Promise<number> {
  if (articleIds.length === 0) return 0;
  const result = await getDb()
    .deleteFrom('article_cluster_facets')
    .where('article_id', 'in', articleIds)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}
