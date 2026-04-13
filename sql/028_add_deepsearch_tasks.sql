-- 深度检索任务表
CREATE TABLE IF NOT EXISTS deepsearch_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_name TEXT NOT NULL,
    input_md TEXT NOT NULL,
    rounds INTEGER DEFAULT 1,
    semantic_limit INTEGER DEFAULT 5,
    score_threshold REAL DEFAULT 0.65,
    max_final_articles INTEGER DEFAULT 10,
    skip_pdf_summary INTEGER DEFAULT 0,
    external_task_id TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    result_report_path TEXT,
    result_articles_dir TEXT,
    article_count INTEGER DEFAULT 0,
    pdf_summary_success INTEGER DEFAULT 0,
    pdf_summary_failed INTEGER DEFAULT 0,
    pdf_summary_skipped INTEGER DEFAULT 0,
    search_stats_json TEXT,
    execution_logs_json TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deepsearch_tasks_user_id ON deepsearch_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_deepsearch_tasks_status ON deepsearch_tasks(status);
CREATE INDEX IF NOT EXISTS idx_deepsearch_tasks_created_at ON deepsearch_tasks(created_at);
