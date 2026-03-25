export interface DeepSearchConfig {
  user: {
    userId: number;
  };
  database: {
    path: string;
  };
  llm: {
    task_type: string | null;
    temperature: number;
    max_tokens: number;
    retry_delay_ms: number;
  };
  search: {
    prompt: string;
    iteration_rounds: number;
    score_threshold: number;
    semantic_limit: number;
    semantic_weight: number;
    keyword_weight: number;
    max_final_articles: number;
  };
  pdf_summary: {
    api_url: string;
    timeout: number;
    max_retries: number;
  };
  output: {
    base_dir: string;
    report_dir: string;
    articles_dir: string;
  };
}

export interface SeedArticle {
  articleId: number | null;
  title: string;
  aiSummary?: string | null;
  markdownContent?: string | null;
  content?: string | null;
}

export interface ParsedSeedLine {
  articleId: number | null;
  title: string;
}

export interface CandidateArticle {
  articleId: number | null;
  title: string;
  score: number;
  source: 'related' | 'semantic' | 'seed';
}

export interface SearchResult {
  articleId: number;
  score: number;
  semanticScore?: number;
  keywordScore?: number;
  metadata?: {
    title: string;
    url: string;
    summary: string | null;
    published_at: string | null;
    rss_source_name?: string;
    published_year?: number | null;
    published_issue?: number | null;
    published_volume?: number | null;
    source_origin?: 'rss' | 'journal' | 'keyword';
    journal_name?: string;
    keyword_name?: string;
  };
}

export interface PdfApiResult {
  success: boolean;
  md_path?: string;
  pdf_path?: string;
  reason?: string;
}

export interface ArticleMDResult {
  articleId: number | null;
  title: string;
  mdPath: string | null;
  pdfSuccess: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface DeepSearchResult {
  reportPath: string;
  articlesDir: string;
  outputDir: string;
  articleCount: number;
  pdfSummarySuccess: number;
  pdfSummaryFailed: number;
  pdfSummarySkipped: number;
  searchStats: {
    seedArticleCount: number;
    relatedArticlesCount: number;
    relatedArticlesFilteredCount: number;
    relatedArticlesUniqueAddedCount: number;
    semanticSearchTermsCount: number;
    semanticSearchHitsCount: number;
    semanticSearchFilteredCount: number;
    semanticSearchUniqueAddedCount: number;
    iterationRoundsConfigured: number;
    iterationRoundsExecuted: number;
  };
}

export interface ProcessOptions {
  inputMd: string;
  inputType: 'content' | 'file';
  rounds?: number;
  scoreThreshold?: number;
  semanticLimit?: number;
  maxFinalArticles?: number;
  outputDir?: string;
}

export interface TaskStatus {
  taskId: string;
  status: 'running' | 'completed' | 'failed';
  progress: {
    step: 'searching' | 'pdf_summary' | 'generating_report';
    current: number;
    total: number;
  };
  result?: DeepSearchResult;
  error?: string;
}
