-- 为 deepsearch_tasks 增加 skip_pdf_summary 字段
ALTER TABLE deepsearch_tasks ADD COLUMN skip_pdf_summary INTEGER DEFAULT 0;
