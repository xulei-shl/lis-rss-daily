import express from 'express';
import { sql } from 'kysely';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb, type DeepSearchTasksSelection } from '../../db.js';
import { config } from '../../config.js';

const router = express.Router();

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
  } | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
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
      query = query.where('status', '=', status as 'pending' | 'running' | 'completed' | 'failed');
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

    const db = getDb();
    const userId = req.userId!;

    const result = await fetch(`${config.deepSearchApiUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input_md,
        input_type: 'content',
        rounds: rounds || 1,
        score_threshold: score_threshold || 0.65,
        semantic_limit: semantic_limit || 5,
        max_final_articles: max_final_articles || 10,
      }),
    });

    if (!result.ok) {
      const errorText = await result.text();
      throw new Error(`DeepSearch API error: ${errorText}`);
    }

    const apiResult = await result.json() as {
      task_id: string;
      status: string;
      progress: { step: string; current: number; total: number };
    };

    const now = new Date().toISOString();
    const insertResult = await db
      .insertInto('deepsearch_tasks')
      .values({
        user_id: userId,
        task_name,
        input_md,
        rounds: rounds || 1,
        semantic_limit: semantic_limit || 5,
        score_threshold: score_threshold || 0.65,
        max_final_articles: max_final_articles || 10,
        external_task_id: apiResult.task_id,
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
        .where('external_task_id', '=', apiResult.task_id)
        .orderBy('id', 'desc')
        .executeTakeFirst();
      taskId = insertedTask?.id || null;
    }
    if (!taskId) {
      throw new Error('Failed to resolve inserted task ID');
    }

    res.json({
      id: taskId,
      taskName: task_name,
      status: 'running',
      externalTaskId: apiResult.task_id,
      createdAt: new Date().toISOString(),
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

    let progress: { step: string; current: number; total: number } | null = null;
    let result: {
      reportPath: string | null;
      articlesDir: string | null;
      outputDir: string | null;
      articleCount: number;
      pdfSummarySuccess: number;
      pdfSummaryFailed: number;
      pdfSummarySkipped: number;
    } | null = null;
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
    let responseOutputDir: string | null = null;

    if (task.external_task_id && task.status !== 'pending') {
      try {
        const statusRes = await fetch(`${config.deepSearchApiUrl}/task/${task.external_task_id}`);
        if (statusRes.ok) {
          const apiStatus = await statusRes.json() as {
            status: 'pending' | 'running' | 'completed' | 'failed';
            progress: { step: string; current: number; total: number };
            result?: {
              reportPath: string;
              articlesDir: string;
              outputDir: string;
              articleCount: number;
              pdfSummarySuccess: number;
              pdfSummaryFailed: number;
              pdfSummarySkipped: number;
            };
            error?: string;
          };

          progress = apiStatus.progress || null;
          responseStatus = apiStatus.status || task.status;
          if (typeof apiStatus.error === 'string') {
            responseErrorMessage = apiStatus.error;
          } else if (apiStatus.status === 'completed') {
            responseErrorMessage = null;
          }
          if (apiStatus.status === 'completed' && !task.completed_at) {
            responseCompletedAt = new Date().toISOString();
          }

          if (apiStatus.result) {
            responseReportPath = apiStatus.result.reportPath || null;
            responseArticlesDir = apiStatus.result.articlesDir || null;
            responseOutputDir = apiStatus.result.outputDir || null;
            responseArticleCount = apiStatus.result.articleCount || 0;
            responsePdfSummarySuccess = apiStatus.result.pdfSummarySuccess || 0;
            responsePdfSummaryFailed = apiStatus.result.pdfSummaryFailed || 0;
            responsePdfSummarySkipped = apiStatus.result.pdfSummarySkipped || 0;
          }

          const now = new Date().toISOString();
          const shouldUpdate =
            responseStatus !== task.status ||
            responseErrorMessage !== task.error_message ||
            responseCompletedAt !== task.completed_at ||
            responseReportPath !== task.result_report_path ||
            responseArticlesDir !== task.result_articles_dir ||
            responseArticleCount !== task.article_count ||
            responsePdfSummarySuccess !== task.pdf_summary_success ||
            responsePdfSummaryFailed !== task.pdf_summary_failed ||
            responsePdfSummarySkipped !== task.pdf_summary_skipped;

          if (shouldUpdate) {
            await db
              .updateTable('deepsearch_tasks')
              .set({
                status: responseStatus as 'pending' | 'running' | 'completed' | 'failed',
                result_report_path: responseReportPath,
                result_articles_dir: responseArticlesDir,
                article_count: responseArticleCount,
                pdf_summary_success: responsePdfSummarySuccess,
                pdf_summary_failed: responsePdfSummaryFailed,
                pdf_summary_skipped: responsePdfSummarySkipped,
                error_message: responseErrorMessage,
                completed_at: responseCompletedAt,
                updated_at: now,
              })
              .where('id', '=', taskId)
              .execute();
            responseUpdatedAt = now;
          }
        }
      } catch (apiError) {
        console.error('Failed to fetch task status from DeepSearch API:', apiError);
      }
    }

    if (responseReportPath || responseArticlesDir || responseArticleCount > 0) {
      result = {
        reportPath: responseReportPath,
        articlesDir: responseArticlesDir,
        outputDir: responseOutputDir,
        articleCount: responseArticleCount,
        pdfSummarySuccess: responsePdfSummarySuccess,
        pdfSummaryFailed: responsePdfSummaryFailed,
        pdfSummarySkipped: responsePdfSummarySkipped,
      };
    }

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
      .select(['id', 'task_name', 'external_task_id', 'status'])
      .where('id', '=', taskId)
      .where('user_id', '=', userId)
      .executeTakeFirst() as { id: number; task_name: string; external_task_id: string | null; status: string } | undefined;

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!task.external_task_id) {
      return res.status(400).json({ error: 'No external task ID' });
    }

    let taskStatus = task.status;
    if (taskStatus !== 'completed') {
      const statusResponse = await fetch(`${config.deepSearchApiUrl}/task/${task.external_task_id}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json() as {
          status: 'pending' | 'running' | 'completed' | 'failed';
          result?: {
            reportPath: string;
            articlesDir: string;
            articleCount: number;
            pdfSummarySuccess: number;
            pdfSummaryFailed: number;
            pdfSummarySkipped: number;
          };
          error?: string;
        };

        taskStatus = statusData.status;
        if (taskStatus === 'completed' || taskStatus === 'failed') {
          const now = new Date().toISOString();
          await db
            .updateTable('deepsearch_tasks')
            .set({
              status: taskStatus as 'pending' | 'running' | 'completed' | 'failed',
              result_report_path: statusData.result?.reportPath || null,
              result_articles_dir: statusData.result?.articlesDir || null,
              article_count: statusData.result?.articleCount || 0,
              pdf_summary_success: statusData.result?.pdfSummarySuccess || 0,
              pdf_summary_failed: statusData.result?.pdfSummaryFailed || 0,
              pdf_summary_skipped: statusData.result?.pdfSummarySkipped || 0,
              error_message: statusData.error || null,
              completed_at: taskStatus === 'completed' ? now : null,
              updated_at: now,
            })
            .where('id', '=', taskId)
            .execute();
        }
      }
    }

    if (taskStatus !== 'completed') {
      return res.status(400).json({ error: 'Task not completed' });
    }

    const apiResponse = await fetch(`${config.deepSearchApiUrl}/task/${task.external_task_id}/download`);

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      throw new Error(`DeepSearch API download error: ${errorText}`);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="deepsearch-${task.task_name.replace(/[^a-zA-Z0-9]/g, '_')}.zip"`);

    const arrayBuffer = await apiResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
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
