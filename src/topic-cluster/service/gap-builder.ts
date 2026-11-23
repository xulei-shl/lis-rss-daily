/**
 * 跨主题空白候选（规则层，零 token；设计文档 v2 §4.3）。
 *
 * 定义：主题 A 常用方法 M、邻近主题 B 常用对象 O，且 A/B 内都没有 M×O。
 * 这里只产出**候选与证据 ID**，LLM 负责把候选写成可检验假设，不得新增候选。
 */

import { getDb } from '../../db.js';
import { normalizeMethodKeys, normalizeObjectKeys } from '../domain/vocab.js';
import { listFacetsByArticleIds } from '../repo/facets.js';
import { parseFacetFields } from '../domain/facet.js';
import type { TopicMemberView } from './member-view.js';

export interface CrossTopicGap {
  method: string;
  object: string;
  methodCount: number;
  objectCount: number;
  adjacentTopicId: number;
  adjacentTopicName: string;
  evidenceArticleIds: number[];
}

interface TopicFacetPool {
  id: number;
  name: string;
  methods: Set<string>;
  objects: Set<string>;
  combos: Set<string>;
  articles: Array<{ articleId: number; methods: string[]; objects: string[] }>;
}

export async function buildCrossTopicGaps(
  topicId: number,
  setVersion: number,
  members: TopicMemberView[]
): Promise<CrossTopicGap[]> {
  if (members.length === 0) return [];

  const myMethods = unique(members.flatMap((member) => member.methodKeys));
  const myObjects = unique(members.flatMap((member) => member.objectKeys));
  if (myMethods.length === 0 || myObjects.length === 0) return [];

  const myMethodSet = new Set(myMethods);
  const myObjectSet = new Set(myObjects);
  const myCombos = new Set(
    members.flatMap((member) =>
      member.methodKeys.flatMap((method) =>
        member.objectKeys.map((object) => comboKey(method, object))
      )
    )
  );

  const others = await getDb()
    .selectFrom('article_topic_links as l')
    .innerJoin('cluster_topics as t', 't.id', 'l.topic_id')
    .where('l.set_version', '=', setVersion)
    .where('l.topic_id', '!=', topicId)
    .select(['t.id as id', 't.name as name', 'l.article_id as article_id'])
    .execute();
  if (others.length === 0) return [];

  const facets = await listFacetsByArticleIds([...new Set(others.map((row) => row.article_id))]);
  const facetMap = new Map(facets.map((facet) => [facet.article_id, facet]));

  const pools = new Map<number, TopicFacetPool>();
  for (const row of others) {
    const facetRow = facetMap.get(row.article_id);
    const facet = facetRow ? parseFacetFields(facetRow.facet_json) : null;
    if (!facet) continue;

    let pool = pools.get(row.id);
    if (!pool) {
      pool = {
        id: row.id,
        name: row.name,
        methods: new Set(),
        objects: new Set(),
        combos: new Set(),
        articles: [],
      };
      pools.set(row.id, pool);
    }

    const methods = normalizeMethodKeys(facet.method);
    const objects = normalizeObjectKeys(facet.study_object);
    for (const method of methods) pool.methods.add(method);
    for (const object of objects) pool.objects.add(object);
    for (const method of methods) {
      for (const object of objects) pool.combos.add(comboKey(method, object));
    }
    pool.articles.push({ articleId: row.article_id, methods, objects });
  }

  const adjacent = [...pools.values()]
    .map((pool) => {
      const sharedMethods = [...pool.methods].filter((method) => myMethodSet.has(method)).length;
      const sharedObjects = [...pool.objects].filter((object) => myObjectSet.has(object)).length;
      return { pool, score: sharedMethods + sharedObjects };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.pool.id - b.pool.id)
    .slice(0, 5);

  const candidates = new Map<string, CrossTopicGap>();

  for (const { pool } of adjacent) {
    // A 的方法 × B 的对象
    for (const method of myMethods) {
      for (const object of pool.objects) {
        const key = comboKey(method, object);
        if (myCombos.has(key) || pool.combos.has(key)) continue;

        const methodCount = membersWithMethod(members, method).length;
        const objectCount = poolArticlesWithObject(pool, object).length;
        if (methodCount < 2 || objectCount < 2) continue;

        const evidence = [
          membersWithMethod(members, method)[0]?.articleId ?? null,
          poolArticlesWithObject(pool, object)[0]?.articleId ?? null,
        ].filter((id): id is number => id !== null);
        if (new Set(evidence).size < 2) continue;

        addCandidate(candidates, {
          method,
          object,
          methodCount,
          objectCount,
          adjacentTopicId: pool.id,
          adjacentTopicName: pool.name,
          evidenceArticleIds: evidence,
        });
      }
    }

    // B 的方法 × A 的对象
    for (const method of pool.methods) {
      for (const object of myObjects) {
        const key = comboKey(method, object);
        if (myCombos.has(key) || pool.combos.has(key)) continue;

        const methodCount = poolArticlesWithMethod(pool, method).length;
        const objectCount = membersWithObject(members, object).length;
        if (methodCount < 2 || objectCount < 2) continue;

        const evidence = [
          poolArticlesWithMethod(pool, method)[0]?.articleId ?? null,
          membersWithObject(members, object)[0]?.articleId ?? null,
        ].filter((id): id is number => id !== null);
        if (new Set(evidence).size < 2) continue;

        addCandidate(candidates, {
          method,
          object,
          methodCount,
          objectCount,
          adjacentTopicId: pool.id,
          adjacentTopicName: pool.name,
          evidenceArticleIds: evidence,
        });
      }
    }
  }

  return [...candidates.values()]
    .sort(
      (a, b) =>
        Math.min(b.methodCount, b.objectCount) - Math.min(a.methodCount, a.objectCount) ||
        a.method.localeCompare(b.method) ||
        a.object.localeCompare(b.object)
    )
    .slice(0, 5);
}

function membersWithMethod(members: TopicMemberView[], method: string): TopicMemberView[] {
  return members.filter((member) => member.methodKeys.includes(method));
}

function membersWithObject(members: TopicMemberView[], object: string): TopicMemberView[] {
  return members.filter((member) => member.objectKeys.includes(object));
}

function poolArticlesWithMethod(
  pool: TopicFacetPool,
  method: string
): TopicFacetPool['articles'] {
  return pool.articles.filter((article) => article.methods.includes(method));
}

function poolArticlesWithObject(
  pool: TopicFacetPool,
  object: string
): TopicFacetPool['articles'] {
  return pool.articles.filter((article) => article.objects.includes(object));
}

function addCandidate(map: Map<string, CrossTopicGap>, candidate: CrossTopicGap): void {
  const key = comboKey(candidate.method, candidate.object);
  const existing = map.get(key);
  if (
    !existing ||
    Math.min(candidate.methodCount, candidate.objectCount) >
      Math.min(existing.methodCount, existing.objectCount)
  ) {
    map.set(key, candidate);
  }
}

function comboKey(method: string, object: string): string {
  return `${method}\u0000${object}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
