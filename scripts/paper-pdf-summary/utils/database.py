#!/usr/bin/env python3
"""
数据库操作模块 - 用于读取和更新articles表数据

功能：
1. 连接SQLite数据库
2. 加载期刊白名单
3. 按优先级获取待处理数据
4. 获取来源名称（rss_source或journal）
5. 更新ai_summary字段
"""

import sqlite3
import random
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime


def get_connection(db_path: str) -> sqlite3.Connection:
    """
    获取数据库连接
    
    Args:
        db_path: 数据库文件路径
        
    Returns:
        SQLite连接对象
    """
    db_path = Path(db_path)
    if not db_path.exists():
        raise FileNotFoundError(f"数据库文件不存在: {db_path}")
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row  # 使用列名访问
    return conn


def load_journals_list(config_path: str) -> List[str]:
    """
    加载期刊白名单
    
    Args:
        config_path: journals_list.yaml文件路径
        
    Returns:
        期刊名称列表
    """
    import yaml
    
    config_path = Path(config_path)
    if not config_path.exists():
        raise FileNotFoundError(f"期刊列表配置文件不存在: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        journals = yaml.safe_load(f)
    
    return journals if isinstance(journals, list) else []


def get_source_ids_from_journals(conn: sqlite3.Connection, journals: List[str]) -> Tuple[List[int], List[int]]:
    """
    根据期刊名称获取rss_source_id和journal_id列表
    
    Args:
        conn: 数据库连接
        journals: 期刊名称列表
        
    Returns:
        (rss_source_ids, journal_ids)
    """
    if not journals:
        return [], []
    
    # 构建IN查询的占位符
    placeholders = ','.join(['?' for _ in journals])
    
    # 查询rss_sources表
    rss_query = f"SELECT id FROM rss_sources WHERE name IN ({placeholders})"
    cursor = conn.execute(rss_query, journals)
    rss_source_ids = [row['id'] for row in cursor.fetchall()]
    
    # 查询journals表（复数形式）
    journal_query = f"SELECT id FROM journals WHERE name IN ({placeholders})"
    cursor = conn.execute(journal_query, journals)
    journal_ids = [row['id'] for row in cursor.fetchall()]
    
    return rss_source_ids, journal_ids


def fetch_pending_articles(
    db_path: str,
    journals: List[str],
    limit: int,
    use_priority: bool = True
) -> List[Dict]:
    """
    获取待处理的文章数据
    
    获取条件：
    必备条件：
    - ai_summary为空
    - rss_source_id在白名单 或 journal_id在白名单
    
    优先级（use_priority=True时）：
    - filter_status='passed' AND is_read=0（最高优先级）
    
    Args:
        db_path: 数据库文件路径
        journals: 期刊名称白名单
        limit: 获取数量限制
        use_priority: 是否使用优先级排序
        
    Returns:
        文章数据列表
    """
    conn = get_connection(db_path)
    
    try:
        # 获取白名单中的来源ID
        rss_source_ids, journal_ids = get_source_ids_from_journals(conn, journals)
        
        if not rss_source_ids and not journal_ids:
            print(f"[WARN] 期刊白名单中没有匹配的数据源")
            return []
        
        # 构建基础查询
        # 必备条件：ai_summary为空，且来源在白名单中
        conditions = ["(ai_summary IS NULL OR ai_summary = '')"]
        
        # 来源条件
        source_conditions = []
        if rss_source_ids:
            placeholders = ','.join(['?' for _ in rss_source_ids])
            source_conditions.append(f"rss_source_id IN ({placeholders})")
        if journal_ids:
            placeholders = ','.join(['?' for _ in journal_ids])
            source_conditions.append(f"journal_id IN ({placeholders})")
        
        if source_conditions:
            conditions.append(f"({' OR '.join(source_conditions)})")
        
        base_where = " AND ".join(conditions)
        
        # 优先级查询
        if use_priority:
            # 优先获取 filter_status='passed' AND is_read=0 的数据
            priority_where = base_where + " AND filter_status='passed' AND is_read=0"
            priority_query = f"""
                SELECT id, rss_source_id, journal_id, title, url, source_origin
                FROM articles
                WHERE {priority_where}
                ORDER BY filtered_at DESC, published_at DESC
                LIMIT ?
            """
            
            params = rss_source_ids + journal_ids + [limit]
            cursor = conn.execute(priority_query, params)
            priority_articles = [dict(row) for row in cursor.fetchall()]
            
            # 如果优先数据足够，直接返回
            if len(priority_articles) >= limit:
                return priority_articles
            
            # 优先数据不足，补充其他数据
            remaining = limit - len(priority_articles)
            
            # 获取已处理的ID列表（排除）
            processed_ids = [a['id'] for a in priority_articles]
            if processed_ids:
                exclude_ids = ','.join(['?' for _ in processed_ids])
                other_where = base_where + f" AND id NOT IN ({exclude_ids})"
            else:
                other_where = base_where
            
            # 随机获取其他数据
            other_query = f"""
                SELECT id, rss_source_id, journal_id, title, url, source_origin
                FROM articles
                WHERE {other_where}
                ORDER BY RANDOM()
                LIMIT ?
            """
            
            params = rss_source_ids + journal_ids + processed_ids + [remaining]
            cursor = conn.execute(other_query, params)
            other_articles = [dict(row) for row in cursor.fetchall()]
            
            # 合并结果
            return priority_articles + other_articles
        else:
            # 不使用优先级，直接随机获取
            query = f"""
                SELECT id, rss_source_id, journal_id, title, url, source_origin
                FROM articles
                WHERE {base_where}
                ORDER BY RANDOM()
                LIMIT ?
            """
            
            params = rss_source_ids + journal_ids + [limit]
            cursor = conn.execute(query, params)
            return [dict(row) for row in cursor.fetchall()]
    
    finally:
        conn.close()


def get_source_name(article: Dict, conn: sqlite3.Connection) -> str:
    """
    获取文章来源名称（rss_source或journal）
    
    Args:
        article: 文章数据字典
        conn: 数据库连接
        
    Returns:
        来源名称
    """
    rss_source_id = article.get('rss_source_id')
    journal_id = article.get('journal_id')
    
    if rss_source_id:
        cursor = conn.execute(
            "SELECT name FROM rss_sources WHERE id = ?",
            (rss_source_id,)
        )
        row = cursor.fetchone()
        if row:
            return row['name']
    
    if journal_id:
        cursor = conn.execute(
            "SELECT name FROM journals WHERE id = ?",
            (journal_id,)
        )
        row = cursor.fetchone()
        if row:
            return row['name']
    
    return "未知来源"


def get_article_full_info(article_id: int, db_path: str) -> Optional[Dict]:
    """
    获取文章的完整信息
    
    Args:
        article_id: 文章ID
        db_path: 数据库路径
        
    Returns:
        文章完整信息字典
    """
    conn = get_connection(db_path)
    
    try:
        cursor = conn.execute(
            """SELECT 
                id, rss_source_id, journal_id, title, url, 
                source_origin, filter_status, is_read, 
                created_at, updated_at
               FROM articles WHERE id = ?""",
            (article_id,)
        )
        row = cursor.fetchone()
        
        if row:
            article = dict(row)
            article['source_name'] = get_source_name(article, conn)
            return article
        
        return None
    
    finally:
        conn.close()


def update_ai_summary(article_id: int, summary: str, db_path: str) -> bool:
    """
    更新文章的ai_summary字段
    
    Args:
        article_id: 文章ID
        summary: AI总结内容
        db_path: 数据库路径
        
    Returns:
        是否更新成功
    """
    conn = get_connection(db_path)
    
    try:
        now = datetime.now().isoformat()
        cursor = conn.execute(
            "UPDATE articles SET ai_summary = ?, updated_at = ? WHERE id = ?",
            (summary, now, article_id)
        )
        conn.commit()
        
        return cursor.rowcount > 0
    
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] 更新ai_summary失败: {e}")
        return False
    
    finally:
        conn.close()


def mark_article_processed(article_id: int, db_path: str, success: bool = True) -> bool:
    """
    标记文章已处理
    
    Args:
        article_id: 文章ID
        db_path: 数据库路径
        success: 是否成功处理
        
    Returns:
        是否更新成功
    """
    conn = get_connection(db_path)
    
    try:
        # 如果成功，可以标记is_read为1
        if success:
            cursor = conn.execute(
                "UPDATE articles SET is_read = 1 WHERE id = ?",
                (article_id,)
            )
        else:
            # 失败时不修改is_read
            cursor = conn.execute(
                "SELECT 1 FROM articles WHERE id = ?",
                (article_id,)
            )
            cursor = conn.execute("SELECT 1")  # 创建一个假的cursor
        
        conn.commit()
        return True
    
    except Exception as e:
        print(f"[ERROR] 标记处理状态失败: {e}")
        return False
    
    finally:
        conn.close()


# 测试入口
if __name__ == "__main__":
    import sys
    
    # 测试数据库连接
    db_path = "F:/Github/lis-rss-daily/data/rss-tracker.db"
    
    try:
        print("[INFO] 测试数据库连接...")
        conn = get_connection(db_path)
        print("[OK] 数据库连接成功")
        
        # 测试获取表列表
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row['name'] for row in cursor.fetchall()]
        print(f"[INFO] 数据库表: {tables}")
        
        # 测试加载期刊列表
        journals = load_journals_list("config/journals_list.yaml")
        print(f"[INFO] 期刊数量: {len(journals)}")
        print(f"[INFO] 前5个期刊: {journals[:5]}")
        
        # 测试获取来源ID
        rss_ids, journal_ids = get_source_ids_from_journals(conn, journals)
        print(f"[INFO] 匹配的rss_source数量: {len(rss_ids)}")
        print(f"[INFO] 匹配的journal数量: {len(journal_ids)}")
        
        # 测试获取待处理数据
        articles = fetch_pending_articles(db_path, journals, limit=5, use_priority=True)
        print(f"[INFO] 获取到待处理文章: {len(articles)}")
        
        for i, article in enumerate(articles, 1):
            print(f"  {i}. ID={article['id']}, Title={article['title'][:30]}...")
        
        conn.close()
        
    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
