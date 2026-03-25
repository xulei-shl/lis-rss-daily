import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb, type DeepSearchTasksSelection } from '../../db.js';
import { startDeepSearchTask, getRuntimeTask, type DeepSearchRuntimeResult } from '../deepsearch.executor.js';
import { createZipBuffer } from '../../utils/simple-zip.js';

const router = express.Router();

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface DeepSearchStatsResponse {
  seedArticleCount: number;
  relatedArticlesCount: number;
  semanticSearchTermsCount: number;
  semanticSearchHitsCount: number;
  iterationRoundsConfigured: number;
  iterationRoundsExecuted: number;
}

interface DeepSearchTaskResponse {
  id: number;
  taskName: string;
  inputMd: string;
  rounds: number;
  semanticLimit: number;
  scoreThreshold: number;
  maxFinalArticles: number;
  status: string;
  externalTaskId: string | null;
  progress: { step: string; current: number; total: number } | null;
  result: {
    reportPath: string | null;
    articlesDir: string | null;
    outputDir: string | null;
    articleCount: number;
    pdfSummarySuccess: number;
    pdfSummaryFailed: number;
    pdfSummarySkipped: number;
    searchStats: DeepSearchStatsResponse | null;
  } | null;
  errorMessage: string | null;
  logs: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

function parseJsonObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === 'string');
  } catch {
    return [];
  }
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultProgress(status: string): { step: string; current: number; total: number } | null {
  if (status === 'pending') return { step: 'pending', current: 0, total: 100 };
  if (status === 'running') return { step: 'searching', current: 10, total: 100 };
  if (status === 'completed') return { step: 'completed', current: 100, total: 100 };
  if (status === 'failed') return { step: 'failed', current: 100, total: 100 };
  return null;
}

function sanitizeDownloadName(taskName: string): string {
  return taskName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function formatLogTimestampFromIso(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

function buildFallbackLogs(task: DeepSearchTasksSelection): string[] {
  const logs: string[] = [];
  logs.push(`[${formatLogTimestampFromIso(task.created_at)}] 任务已创建`);

  if (task.status === 'completed' && task.completed_at) {
    logs.push(`[${formatLogTimestampFromIso(task.completed_at)}] 任务执行完成`);
  }

  if (task.status === 'failed' && task.error_message) {
    logs.push(`[${formatLogTimestampFromIso(task.updated_at)}] 任务失败: ${task.error_message}`);
  }

  return logs;
}

async function collectFilesRecursively(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await collectFilesRecursively(rootDir, fullPath));
      continue;
    }
    if (entry.isFile()) {
      result.push(fullPath);
    }
  }

  return result;
}

router.get('/tasks', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const createdFrom = typeof req.query.created_from === 'string' ? req.query.created_from.trim() : '';
    const createdTo = typeof req.query.created_to === 'string' ? req.query.created_to.trim() : '';

    let query = db
      .selectFrom('deepsearch_tasks')
      .select(['id', 'task_name', 'rounds', 'semantic_limit', 'status', 'article_count', 'created_at', 'completed_at'])
      .where('user_id', '=', userId);

    if (keyword) {
      query = query.where('task_name', 'like', `%${keyword}%`);
    }

    if (status && ['pending', 'running', 'completed', 'failed'].includes(status)) {
      query = query.where('status', '=', status as TaskStatus);
    }

    if (createdFrom && /^\d{4}-\d{2}-\d{2}$/.test(createdFrom)) {
      query = query.where(sql<boolean>`datetime(created_at) >= datetime(${createdFrom})`);
    }

    if (createdTo && /^\d{4}-\d{2}-\d{2}$/.test(createdTo)) {
      const createdToEndOfDay = `${createdTo} 23:59:59`;
      query = query.where(sql<boolean>`datetime(created_at) <= datetime(${createdToEndOfDay})`);
    }

    const tasks = await query.orderBy('created_at', 'desc').execute();

    res.json({
      tasks: tasks.map(task => ({
        id: task.id,
        taskName: task.task_name,
        rounds: task.rounds,
        semanticLimit: task.semantic_limit,
        status: task.status,
        articleCount: task.article_count,
        createdAt: task.created_at,
        completedAt: task.completed_at,
      })),
    });
  } catch (error) {
    console.error('Failed to get deepsearch tasks:', error);
    res.status(500).json({ error: 'Failed to get tasks' });
  }
});

router.post('/tasks', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { task_name, input_md, rounds, semantic_limit, score_threshold, max_final_articles } = req.body;

    if (!task_name || !input_md) {
      return res.status(400).json({ error: 'task_name and input_md are required' });
    }

    const roundsNum = toNumber(rounds, 1);
    const semanticLimitNum = toNumber(semantic_limit, 5);
    const scoreThresholdNum = toNumber(score_threshold, 0.65);
    const maxFinalArticlesNum = toNumber(max_final_articles, 10);

    const db = getDb();
    const userId = req.userId!;
    const internalTaskId = randomUUID();
    const now = new Date().toISOString();

    const insertResult = await db
      .insertInto('deepsearch_tasks')
      .values({
        user_id: userId,
        task_name,
        input_md,
        rounds: roundsNum,
        semantic_limit: semanticLimitNum,
        score_threshold: scoreThresholdNum,
        max_final_articles: maxFinalArticlesNum,
        external_task_id: internalTaskId,
        status: 'running',
        article_count: 0,
        pdf_summary_success: 0,
        pdf_summary_failed: 0,
        pdf_summary_skipped: 0,
        created_at: now,
        updated_at: now,
      })
      .executeTakeFirst();

    let taskId = insertResult?.insertId ? Number(insertResult.insertId) : null;
    if (!taskId) {
      const insertedTask = await db
        .selectFrom('deepsearch_tasks')
        .select(['id'])
        .where('user_id', '=', userId)
        .where('external_task_id', '=', internalTaskId)
        .orderBy('id', 'desc')
        .executeTakeFirst();
      taskId = insertedTask?.id || null;
    }
    if (!taskId) {
      throw new Error('Failed to resolve inserted task ID');
    }

    startDeepSearchTask({
      taskId: internalTaskId,
      inputMd: String(input_md),
      rounds: roundsNum,
      scoreThreshold: scoreThresholdNum,
      semanticLimit: semanticLimitNum,
      maxFinalArticles: maxFinalArticlesNum,
      onCompleted: async (result: DeepSearchRuntimeResult) => {
        const finishTime = new Date().toISOString();
        const runtime = getRuntimeTask(internalTaskId);
        const persistedLogs = runtime && runtime.logs.length > 0 ? JSON.stringify(runtime.logs) : null;
        await db
          .updateTable('deepsearch_tasks')
          .set({
            status: 'completed',
            result_report_path: result.reportPath,
            result_articles_dir: result.articlesDir,
            article_count: result.articleCount,
            pdf_summary_success: result.pdfSummarySuccess,
            pdf_summary_failed: result.pdfSummaryFailed,
            pdf_summary_skipped: result.pdfSummarySkipped,
            search_stats_json: JSON.stringify(result.searchStats),
            execution_logs_json: persistedLogs,
            error_message: null,
            completed_at: finishTime,
            updated_at: finishTime,
          })
          .where('id', '=', taskId!)
          .where('user_id', '=', userId)
          .execute();
      },
      onFailed: async (errorMessage: string) => {
        const failTime = new Date().toISOString();
        const runtime = getRuntimeTask(internalTaskId);
        const persistedLogs = runtime && runtime.logs.length > 0 ? JSON.stringify(runtime.logs) : null;
        await db
          .updateTable('deepsearch_tasks')
          .set({
            status: 'failed',
            execution_logs_json: persistedLogs,
            error_message: errorMessage,
            completed_at: null,
            updated_at: failTime,
          })
          .where('id', '=', taskId!)
          .where('user_id', '=', userId)
          .execute();
      },
    });

    res.json({
      id: taskId,
      taskName: task_name,
      status: 'running',
      externalTaskId: internalTaskId,
      createdAt: now,
    });
  } catch (error) {
    console.error('Failed to create deepsearch task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

router.get('/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const taskIdStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const taskId = parseInt(taskIdStr, 10);
    const userId = req.userId!;

    const task = await db
      .selectFrom('deepsearch_tasks')
      .selectAll()
      .where('id', '=', taskId)
      .where('user_id', '=', userId)
      .executeTakeFirst() as DeepSearchTasksSelection | undefined;

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const runtime = task.external_task_id ? getRuntimeTask(task.external_task_id) : null;

    let responseStatus = task.status;
    let responseErrorMessage = task.error_message;
    let responseCompletedAt = task.completed_at;
    let responseUpdatedAt = task.updated_at;
    let responseReportPath = task.result_report_path;
    let responseArticlesDir = task.result_articles_dir;
    let responseArticleCount = task.article_count;
    let responsePdfSummarySuccess = task.pdf_summary_success;
    let responsePdfSummaryFailed = task.pdf_summary_failed;
    let responsePdfSummarySkipped = task.pdf_summary_skipped;
    let responseSearchStats: DeepSearchStatsResponse | null = parseJsonObject<DeepSearchStatsResponse>(task.search_stats_json);
    let responseOutputDir: string | null = responseReportPath ? path.dirname(responseReportPath) : null;
    let responseLogs = parseStringArray(task.execution_logs_json);
    if (responseLogs.length === 0) {
      responseLogs = buildFallbackLogs(task);
    }

    let progress = getDefaultProgress(responseStatus);

    if (runtime) {
      responseStatus = runtime.status;
      responseErrorMessage = runtime.error ?? responseErrorMessage;
      responseUpdatedAt = runtime.updatedAt;
      progress = runtime.progress;
      responseLogs = runtime.logs.length > 0 ? runtime.logs : responseLogs;

      if (runtime.status === 'completed' && !responseCompletedAt) {
        responseCompletedAt = runtime.updatedAt;
      }

      if (runtime.result) {
        responseReportPath = runtime.result.reportPath;
        responseArticlesDir = runtime.result.articlesDir;
        responseOutputDir = runtime.result.outputDir;
        responseArticleCount = runtime.result.articleCount;
        responsePdfSummarySuccess = runtime.result.pdfSummarySuccess;
        responsePdfSummaryFailed = runtime.result.pdfSummaryFailed;
        responsePdfSummarySkipped = runtime.result.pdfSummarySkipped;
        responseSearchStats = runtime.result.searchStats;
      }
    }

    const result = (responseReportPath || responseArticlesDir || responseArticleCount > 0 || responseSearchStats)
      ? {
        reportPath: responseReportPath,
        articlesDir: responseArticlesDir,
        outputDir: responseOutputDir,
        articleCount: responseArticleCount,
        pdfSummarySuccess: responsePdfSummarySuccess,
        pdfSummaryFailed: responsePdfSummaryFailed,
        pdfSummarySkipped: responsePdfSummarySkipped,
        searchStats: responseSearchStats,
      }
      : null;

    const response: DeepSearchTaskResponse = {
      id: task.id,
      taskName: task.task_name,
      inputMd: task.input_md,
      rounds: task.rounds,
      semanticLimit: task.semantic_limit,
      scoreThreshold: task.score_threshold,
      maxFinalArticles: task.max_final_articles,
      status: responseStatus,
      externalTaskId: task.external_task_id,
      progress,
      result,
      errorMessage: responseErrorMessage,
      logs: responseLogs,
      createdAt: task.created_at,
      updatedAt: responseUpdatedAt,
      completedAt: responseCompletedAt,
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get deepsearch task:', error);
    res.status(500).json({ error: 'Failed to get task' });
  }
});

router.get('/tasks/:id/download', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const taskIdStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const taskId = parseInt(taskIdStr, 10);
    const userId = req.userId!;

    const task = await db
      .selectFrom('deepsearch_tasks')
      .select(['id', 'task_name', 'external_task_id', 'status', 'result_report_path', 'result_articles_dir'])
      .where('id', '=', taskId)
      .where('user_id', '=', userId)
      .executeTakeFirst() as {
        id: number;
        task_name: string;
        external_task_id: string | null;
        status: string;
        result_report_path: string | null;
        result_articles_dir: string | null;
      } | undefined;

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    let taskStatus = task.status;
    let reportPath = task.result_report_path;
    let articlesDir = task.result_articles_dir;

    if (task.external_task_id) {
      const runtime = getRuntimeTask(task.external_task_id);
      if (runtime) {
        taskStatus = runtime.status;
        if (runtime.result) {
          reportPath = reportPath || runtime.result.reportPath;
          articlesDir = articlesDir || runtime.result.articlesDir;
        }
      }
    }

    if (taskStatus !== 'completed') {
      return res.status(400).json({ error: 'Task not completed' });
    }

    const zipEntries: Array<{ name: string; data: Buffer; mtime?: Date }> = [];

    if (reportPath) {
      try {
        const reportData = await fs.readFile(reportPath);
        const reportStat = await fs.stat(reportPath);
        zipEntries.push({
          name: path.basename(reportPath),
          data: reportData,
          mtime: reportStat.mtime,
        });
      } catch {
        // 报告文件缺失时继续尝试打包 articles
      }
    }

    if (articlesDir) {
      try {
        const files = await collectFilesRecursively(articlesDir);
        for (const filePath of files) {
          const relative = path.relative(articlesDir, filePath).replace(/\\/g, '/');
          const data = await fs.readFile(filePath);
          const stat = await fs.stat(filePath);
          zipEntries.push({
            name: `articles/${relative}`,
            data,
            mtime: stat.mtime,
          });
        }
      } catch {
        // 文章目录缺失时由下方统一兜底
      }
    }

    if (zipEntries.length === 0) {
      return res.status(500).json({ error: 'Result files not found' });
    }

    const zipBuffer = createZipBuffer(zipEntries);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="deepsearch-${sanitizeDownloadName(task.task_name)}.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    console.error('Failed to download deepsearch task:', error);
    res.status(500).json({ error: 'Failed to download task' });
  }
});

router.delete('/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const taskIdStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const taskId = parseInt(taskIdStr, 10);
    const userId = req.userId!;

    const existingTask = await db
      .selectFrom('deepsearch_tasks')
      .select(['id'])
      .where('id', '=', taskId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await db
      .deleteFrom('deepsearch_tasks')
      .where('id', '=', taskId)
      .where('user_id', '=', userId)
      .execute();

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete deepsearch task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
