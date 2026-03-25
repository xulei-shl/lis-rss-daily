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
}

export interface DeepSearchRuntimeState {
  status: TaskStatus;
  progress: { step: string; current: number; total: number } | null;
  result: DeepSearchRuntimeResult | null;
  error: string | null;
  updatedAt: string;
}

interface StartTaskOptions {
  taskId: string;
  inputMd: string;
  rounds?: number;
  scoreThreshold?: number;
  semanticLimit?: number;
  maxFinalArticles?: number;
  configPath?: string;
  onCompleted?: (result: DeepSearchRuntimeResult) => Promise<void> | void;
  onFailed?: (error: string) => Promise<void> | void;
}

const runtimeTasks = new Map<string, DeepSearchRuntimeState>();

function setRuntimeState(taskId: string, patch: Partial<DeepSearchRuntimeState>): DeepSearchRuntimeState {
  const current = runtimeTasks.get(taskId) ?? {
    status: 'pending' as TaskStatus,
    progress: { step: 'pending', current: 0, total: 100 },
    result: null,
    error: null,
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
  });

  void (async () => {
    try {
      setRuntimeState(options.taskId, {
        status: 'running',
        progress: { step: 'searching', current: 10, total: 100 },
      });

      const outputDir = path.join(process.cwd(), 'output', 'deepsearch', options.taskId);
      await fs.mkdir(outputDir, { recursive: true });

      const runOptions: DeepSearchOptions = {
        inputMd: options.inputMd,
        rounds: options.rounds,
        scoreThreshold: options.scoreThreshold,
        semanticLimit: options.semanticLimit,
        maxFinalArticles: options.maxFinalArticles,
        configPath: options.configPath,
        outputDir,
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
      };

      setRuntimeState(options.taskId, {
        status: 'completed',
        progress: { step: 'completed', current: 100, total: 100 },
        result: runtimeResult,
        error: null,
      });

      await options.onCompleted?.(runtimeResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeState(options.taskId, {
        status: 'failed',
        progress: { step: 'failed', current: 100, total: 100 },
        error: message,
      });
      await options.onFailed?.(message);
    }
  })();
}

