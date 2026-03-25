import express from 'express';
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

    const tasks = await db
      .selectFrom('deepsearch_tasks')
      .select(['id', 'task_name', 'rounds', 'semantic_limit', 'status', 'article_count', 'created_at', 'completed_at'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();

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

    const taskId = insertResult?.insertId;

    res.json({
      id: Number(taskId),
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

    if (task.external_task_id && task.status !== 'pending') {
      try {
        const statusRes = await fetch(`${config.deepSearchApiUrl}/task/${task.external_task_id}`);
        if (statusRes.ok) {
          const apiStatus = await statusRes.json() as {
            status: string;
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

          if (apiStatus.result) {
            result = {
              reportPath: apiStatus.result.reportPath || null,
              articlesDir: apiStatus.result.articlesDir || null,
              outputDir: apiStatus.result.outputDir || null,
              articleCount: apiStatus.result.articleCount || 0,
              pdfSummarySuccess: apiStatus.result.pdfSummarySuccess || 0,
              pdfSummaryFailed: apiStatus.result.pdfSummaryFailed || 0,
              pdfSummarySkipped: apiStatus.result.pdfSummarySkipped || 0,
            };

            if (apiStatus.status !== task.status || apiStatus.result) {
              await db
                .updateTable('deepsearch_tasks')
                .set({
                  status: apiStatus.status as 'pending' | 'running' | 'completed' | 'failed',
                  result_report_path: apiStatus.result?.reportPath || null,
                  result_articles_dir: apiStatus.result?.articlesDir || null,
                  article_count: apiStatus.result?.articleCount || 0,
                  pdf_summary_success: apiStatus.result?.pdfSummarySuccess || 0,
                  pdf_summary_failed: apiStatus.result?.pdfSummaryFailed || 0,
                  pdf_summary_skipped: apiStatus.result?.pdfSummarySkipped || 0,
                  error_message: apiStatus.error || null,
                  completed_at: apiStatus.status === 'completed' ? new Date().toISOString() : null,
                })
                .where('id', '=', taskId)
                .execute();
            }
          }
        }
      } catch (apiError) {
        console.error('Failed to fetch task status from DeepSearch API:', apiError);
      }
    }

    const response: DeepSearchTaskResponse = {
      id: task.id,
      taskName: task.task_name,
      inputMd: task.input_md,
      rounds: task.rounds,
      semanticLimit: task.semantic_limit,
      scoreThreshold: task.score_threshold,
      maxFinalArticles: task.max_final_articles,
      status: task.status,
      externalTaskId: task.external_task_id,
      progress,
      result,
      errorMessage: task.error_message,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      completedAt: task.completed_at,
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

    if (task.status !== 'completed') {
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