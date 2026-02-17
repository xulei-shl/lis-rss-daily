-- 将历史数据中拒绝的文章标记为已读
UPDATE articles SET is_read = 1 WHERE filter_status = 'rejected' AND is_read = 0;
