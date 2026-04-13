import fs from 'fs/promises';
import path from 'path';
import { runDeepSearch, type DeepSearchOptions } from '../../scripts/deepsearch/deepsearch.js';

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DeepSearchRuntimeResult {
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

export interface DeepSearchRuntimeState {
  status: TaskStatus;
  progress: { step: string; current: number; total: number } | null;
  result: DeepSearchRuntimeResult | null;
  error: string | null;
  logs: string[];
  updatedAt: string;
}

interface StartTaskOptions {
  taskId: string;
  inputMd: string;
  rounds?: number;
  scoreThreshold?: number;
  semanticLimit?: number;
  maxFinalArticles?: number;
  skipPdfSummary?: boolean;
  configPath?: string;
  onCompleted?: (result: DeepSearchRuntimeResult) => Promise<void> | void;
  onFailed?: (error: string) => Promise<void> | void;
}

const runtimeTasks = new Map<string, DeepSearchRuntimeState>();

function formatLogTimestamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

function appendRuntimeLog(taskId: string, message: string): void {
  const current = runtimeTasks.get(taskId);
  if (!current) return;
  const line = `[${formatLogTimestamp()}] ${message}`;
  const logs = [...current.logs, line].slice(-500);
  setRuntimeState(taskId, { logs });
}

function setRuntimeState(taskId: string, patch: Partial<DeepSearchRuntimeState>): DeepSearchRuntimeState {
  const current = runtimeTasks.get(taskId) ?? {
    status: 'pending' as TaskStatus,
    progress: { step: 'pending', current: 0, total: 100 },
    result: null,
    error: null,
    logs: [],
    updatedAt: new Date().toISOString(),
  };
  const next: DeepSearchRuntimeState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  runtimeTasks.set(taskId, next);
  return next;
}

export function getRuntimeTask(taskId: string): DeepSearchRuntimeState | null {
  return runtimeTasks.get(taskId) ?? null;
}

export function startDeepSearchTask(options: StartTaskOptions): void {
  setRuntimeState(options.taskId, {
    status: 'pending',
    progress: { step: 'pending', current: 0, total: 100 },
    result: null,
    error: null,
    logs: [
      `[${formatLogTimestamp()}] 任务已创建`,
      `[${formatLogTimestamp()}] 任务配置：${options.skipPdfSummary ? '跳过 PDF 总结' : '执行 PDF 总结'}`,
    ],
  });

  void (async () => {
    try {
      setRuntimeState(options.taskId, {
        status: 'running',
        progress: { step: 'searching', current: 10, total: 100 },
      });
      appendRuntimeLog(options.taskId, '任务开始执行');

      const outputDir = path.join(process.cwd(), 'output', 'deepsearch', options.taskId);
      await fs.mkdir(outputDir, { recursive: true });

      const runOptions: DeepSearchOptions = {
        inputMd: options.inputMd,
        rounds: options.rounds,
        scoreThreshold: options.scoreThreshold,
        semanticLimit: options.semanticLimit,
        maxFinalArticles: options.maxFinalArticles,
        skipPdfSummary: options.skipPdfSummary,
        configPath: options.configPath,
        outputDir,
        onProgress: (step, current, total) => {
          setRuntimeState(options.taskId, {
            status: 'running',
            progress: { step, current, total },
          });
        },
        onLog: (message) => {
          appendRuntimeLog(options.taskId, message);
        },
      };

      const result = await runDeepSearch(runOptions);

      const runtimeResult: DeepSearchRuntimeResult = {
        reportPath: result.reportPath,
        articlesDir: result.articlesDir,
        outputDir: result.outputDir,
        articleCount: result.articleCount,
        pdfSummarySuccess: result.pdfSummarySuccess,
        pdfSummaryFailed: result.pdfSummaryFailed,
        pdfSummarySkipped: result.pdfSummarySkipped,
        searchStats: result.searchStats,
      };

      setRuntimeState(options.taskId, {
        status: 'completed',
        progress: { step: 'completed', current: 100, total: 100 },
        result: runtimeResult,
        error: null,
      });
      appendRuntimeLog(options.taskId, '任务执行完成');

      await options.onCompleted?.(runtimeResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeState(options.taskId, {
        status: 'failed',
        progress: { step: 'failed', current: 100, total: 100 },
        error: message,
      });
      appendRuntimeLog(options.taskId, `任务失败: ${message}`);
      await options.onFailed?.(message);
    }
  })();
}
