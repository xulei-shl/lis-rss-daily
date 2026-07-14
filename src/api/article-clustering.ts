import type { DailySummaryArticle } from './daily-summary-repository.js';

export interface ClusterScore {
  coverage: number;
  diversity: number;
  trendLabel: 'emerging' | 'sustained' | 'declining' | 'singleton';
}

export interface ArticleCluster {
  articles: DailySummaryArticle[];
  score: ClusterScore;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'can', 'could', 'do', 'does', 'each', 'for', 'from', 'had', 'has', 'have',
  'in', 'into', 'is', 'its', 'may', 'might', 'more', 'no', 'not', 'of',
  'on', 'or', 'such', 'that', 'the', 'their', 'there', 'these', 'they', 'this',
  'to', 'was', 'were', 'which', 'who', 'will', 'with', 'would',
  '的', '了', '在', '是', '和', '与', '及', '或', '而', '但',
  '对', '被', '把', '从', '向', '将', '以', '为', '所', '因',
  '由', '如', '能', '可', '该', '等', '并', '且', '这', '那',
]);

function clusterText(article: DailySummaryArticle): string {
  return article.title;
}

export function textTokens(text: string): Set<string> {
  const tokens = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function computeTrendLabel(
  articles: DailySummaryArticle[],
  windowStart: Date,
  windowEnd: Date
): ClusterScore['trendLabel'] {
  if (articles.length <= 1) return 'singleton';

  const midMs = (windowStart.getTime() + windowEnd.getTime()) / 2;
  let older = 0;
  let recent = 0;

  for (const a of articles) {
    if (!a.published_at) { recent++; continue; }
    const d = new Date(a.published_at).getTime();
    if (isNaN(d)) { recent++; continue; }
    if (d >= midMs) recent++;
    else older++;
  }

  if (recent >= older * 2 && older > 0) return 'emerging';
  if (older >= recent * 2 && recent > 0) return 'declining';
  return 'sustained';
}

export function clusterArticles(
  articles: DailySummaryArticle[],
  windowDays: number,
  similarityThreshold = 0.18
): ArticleCluster[] {
  if (articles.length === 0) return [];
  if (articles.length === 1) {
    return [{ articles: [articles[0]], score: { coverage: 1, diversity: 1, trendLabel: 'singleton' } }];
  }

  const now = Date.now();
  const windowStart = new Date(now - windowDays * 24 * 60 * 60 * 1000);

  const texts = articles.map(a => textTokens(clusterText(a)));
  const n = articles.length;
  const parent = new Array(n).fill(0).map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(x: number, y: number): void {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[ry] = rx;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (find(i) === find(j)) continue;
      if (jaccardSimilarity(texts[i], texts[j]) >= similarityThreshold) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, DailySummaryArticle[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(articles[i]);
  }

  const nowDate = new Date();
  const windowEnd = new Date(nowDate);
  windowEnd.setDate(windowEnd.getDate() - 1);

  const clusters: ArticleCluster[] = [];
  for (const group of groups.values()) {
    const sourceNames = new Set(group.map(a => a.source_name));
    const trendLabel = computeTrendLabel(group, windowStart, windowEnd);
    clusters.push({
      articles: group.sort(
        (a, b) => (b.published_at || '').localeCompare(a.published_at || '')
      ),
      score: {
        coverage: group.length,
        diversity: sourceNames.size,
        trendLabel,
      },
    });
  }

  clusters.sort((a, b) => {
    if (a.score.trendLabel === 'singleton' && b.score.trendLabel !== 'singleton') return 1;
    if (b.score.trendLabel === 'singleton' && a.score.trendLabel !== 'singleton') return -1;
    return b.score.coverage - a.score.coverage;
  });

  return clusters;
}

export function buildClusteredArticlesText(
  clusters: ArticleCluster[],
  dateStr: string
): string {
  const trendEmoji: Record<string, string> = {
    emerging: '🔺',
    sustained: '➡️',
    declining: '🔻',
    singleton: '',
  };

  let text = `日期范围：${dateStr}\n\n`;
  let clusterIndex = 0;
  const singletons: ArticleCluster[] = [];

  for (const cluster of clusters) {
    if (cluster.score.trendLabel === 'singleton') {
      singletons.push(cluster);
      continue;
    }

    clusterIndex++;
    const emoji = trendEmoji[cluster.score.trendLabel];
    const titleKeywords = cluster.articles[0].title.slice(0, 40);
    text += `## 话题簇 ${clusterIndex}：${titleKeywords}（${cluster.score.coverage} 篇 · ${cluster.score.diversity} 个来源 · 趋势：${cluster.score.trendLabel} ${emoji}）\n`;

    for (const article of cluster.articles) {
      const date = article.published_at ? article.published_at.slice(0, 10) : '日期未知';
      text += `- ID: ${article.id} - ${article.title}（来源：${article.source_name}，日期：${date}）\n`;
    }
    text += '\n';

    for (const article of cluster.articles) {
      const content = article.markdown_content || article.summary || '';
      const preview = content.length > 500 ? content.slice(0, 500) + '...' : content;
      text += `### ID: ${article.id} - ${article.title}\n`;
      text += `来源：${article.source_name}\n`;
      text += `预览：${preview}\n\n`;
    }
  }

  if (singletons.length > 0) {
    text += `## 单篇文章（未聚类）\n`;
    for (const cluster of singletons) {
      for (const article of cluster.articles) {
        const content = article.markdown_content || article.summary || '';
        const preview = content.length > 500 ? content.slice(0, 500) + '...' : content;
        text += `### ID: ${article.id} - ${article.title}\n`;
        text += `来源：${article.source_name}\n`;
        text += `预览：${preview}\n\n`;
      }
    }
  }

  return text;
}
