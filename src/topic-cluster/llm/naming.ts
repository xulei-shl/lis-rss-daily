/**
 * 主题命名：为孵化出的新主题生成名称与关键词（每次孵化一次 LLM）。
 *
 * 注意：名称是**展示属性**，不参与任何判定。主题身份由不可变 slug 承担，
 * 因此改名不会影响归属、脉络或历史（设计文档 §7.9）。
 */

import { CLUSTER_LIMITS, CLUSTER_TASKS } from '../config.js';
import type { FacetFields } from '../domain/facet.js';
import { runClusterJsonTask } from './client.js';
import { ClusterSchemaError, optionalText, requireText, textArray } from './schema.js';

export interface TopicNamingInput {
  userId: number;
  facets: Array<{ articleId: number; facet: FacetFields }>;
}

export interface TopicNamingResult {
  name: string;
  keywords: string[];
  description: string | null;
}

export async function nameTopic(input: TopicNamingInput): Promise<TopicNamingResult> {
  const sample = input.facets.slice(0, CLUSTER_LIMITS.maxArticlesPerAnalysisInput);
  const payload = sample.map((item) => ({
    article_id: item.articleId,
    research_question: item.facet.research_question,
    method: item.facet.method,
    study_object: item.facet.study_object,
    core_finding: item.facet.core_finding,
  }));

  return runClusterJsonTask<TopicNamingResult>({
    userId: input.userId,
    taskType: CLUSTER_TASKS.naming,
    promptType: CLUSTER_TASKS.naming,
    label: 'cluster_naming',
    maxTokens: 600,
    temperature: 0.2,
    variables: {
      FACETS_JSON: JSON.stringify(payload, null, 2),
    },
    validate: (raw) => {
      const name = requireText(raw.name, 'name', 4);
      const keywords = textArray(raw.keywords, 5);
      if (keywords.length === 0) {
        throw new ClusterSchemaError('nameTopic: keywords 为空');
      }
      return {
        name,
        keywords,
        description: optionalText(raw.description),
      };
    },
  });
}
