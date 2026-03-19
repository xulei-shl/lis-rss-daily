#!/usr/bin/env python3
"""
日志模块 - 生成每日处理报告

功能：
1. 初始化当日日志文件
2. 记录成功处理的数据
3. 记录失败处理的数据
4. 生成每日汇总报告
"""

import os
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional


class DailyLogger:
    """每日日志记录器"""
    
    def __init__(self, date: str, logs_root: str = "logs"):
        """
        初始化日志记录器
        
        Args:
            date: 日期字符串（YYYY-MM-DD）
            logs_root: 日志根目录
        """
        self.date = date
        self.logs_root = Path(logs_root)
        self.logs_root.mkdir(parents=True, exist_ok=True)
        
        self.log_file = self.logs_root / f"{date}.md"
        
        # 初始化成功/失败列表
        self.successes: List[Dict] = []
        self.failures: List[Dict] = []
        
        # 初始化日志文件
        self._init_log_file()
    
    def _init_log_file(self):
        """初始化日志文件（追加模式）"""
        self.state_file = self.logs_root / f"{self.date}.json"
        
        if self.state_file.exists():
            try:
                state = json.loads(self.state_file.read_text(encoding='utf-8'))
                self.successes = state.get('successes', [])
                self.failures = state.get('failures', [])
            except (json.JSONDecodeError, KeyError):
                self.successes = []
                self.failures = []
        else:
            self.successes = []
            self.failures = []
        
        if not self.log_file.exists():
            header = f"""# 每日处理报告 - {self.date}

## 处理概览

| 指标 | 数量 |
|------|------|
| 成功处理 | 0 |
| 失败处理 | 0 |

---

## 成功记录

暂无

---

## 失败记录

暂无

"""
            self.log_file.write_text(header, encoding='utf-8')
    
    def _format_source(self, article: Dict) -> str:
        """格式化来源信息"""
        source = article.get('source_name', '')
        if not source:
            if article.get('rss_source_id'):
                return f"rss_source_id={article['rss_source_id']}"
            elif article.get('journal_id'):
                return f"journal_id={article['journal_id']}"
            return article.get('source_origin', '未知')
        return source
    
    def log_success(self, article: Dict):
        """
        记录成功处理
        
        Args:
            article: 文章信息字典
        """
        record = {
            'id': article.get('id'),
            'title': article.get('title', ''),
            'source': self._format_source(article),
            'timestamp': datetime.now().isoformat()
        }
        self.successes.append(record)
        self._update_log_file()
    
    def log_failure(self, article: Dict, reason: str):
        """
        记录失败处理
        
        Args:
            article: 文章信息字典
            reason: 失败原因
        """
        record = {
            'id': article.get('id'),
            'title': article.get('title', ''),
            'source': self._format_source(article),
            'reason': reason,
            'timestamp': datetime.now().isoformat()
        }
        self.failures.append(record)
        self._update_log_file()
    
    def _format_article_list(self, articles: List[Dict]) -> str:
        """格式化文章列表"""
        if not articles:
            return "暂无"
        
        lines = []
        for i, article in enumerate(articles, 1):
            title = article.get('title', '')
            # 截断过长标题
            if len(title) > 40:
                title = title[:40] + "..."
            
            source = article.get('source', '')
            
            lines.append(f"### {i}. ID: {article.get('id')}")
            lines.append(f"**标题**: {title}")
            lines.append(f"**来源**: {source}")
            
            if 'reason' in article:
                lines.append(f"**失败原因**: {article['reason']}")
            
            lines.append("")
        
        return "\n".join(lines)
    
    def _save_state(self):
        """保存状态到JSON文件"""
        state = {
            'successes': self.successes,
            'failures': self.failures
        }
        self.state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    
    def _update_log_file(self):
        """更新日志文件"""
        self._save_state()
        
        success_count = len(self.successes)
        failure_count = len(self.failures)
        
        success_content = self._format_article_list(self.successes)
        failure_content = self._format_article_list(self.failures)
        
        if self.log_file.exists():
            content = self.log_file.read_text(encoding='utf-8')
            content = self._replace_section(content, '成功记录', success_content)
            content = self._replace_section(content, '失败记录', failure_content)
            content = self._update_count_in_table(content, success_count, failure_count)
        else:
            content = f"""# 每日处理报告 - {self.date}

## 处理概览

| 指标 | 数量 |
|------|------|
| 成功处理 | {success_count} |
| 失败处理 | {failure_count} |

---

## 成功记录

{success_content}

---

## 失败记录

{failure_content}

"""
        
        self.log_file.write_text(content, encoding='utf-8')
    
    def _replace_section(self, content: str, section_name: str, new_content: str) -> str:
        """替换markdown中的指定部分"""
        marker = f"## {section_name}\n\n"
        
        start_idx = content.find(marker)
        if start_idx == -1:
            return content
        
        start_idx = content.find('\n\n', start_idx) + 2
        
        next_header = content.find('\n## ', start_idx)
        
        if next_header != -1:
            return content[:start_idx] + new_content + content[next_header:]
        else:
            return content[:start_idx] + new_content + '\n'
    
    def _update_count_in_table(self, content: str, success_count: int, failure_count: int) -> str:
        """更新处理概览表格中的数量"""
        import re
        content = re.sub(r'\| 成功处理 \| \d+ \|', f'| 成功处理 | {success_count} |', content)
        content = re.sub(r'\| 失败处理 \| \d+ \|', f'| 失败处理 | {failure_count} |', content)
        return content
    
    def generate_report(self) -> str:
        """
        生成最终报告
        
        Returns:
            报告文件路径
        """
        self._update_log_file()
        return str(self.log_file)
    
    @property
    def success_count(self) -> int:
        """成功数量"""
        return len(self.successes)
    
    @property
    def failure_count(self) -> int:
        """失败数量"""
        return len(self.failures)


def init_daily_log(date: str, logs_root: str = "logs") -> DailyLogger:
    """
    初始化当日日志
    
    Args:
        date: 日期字符串（YYYY-MM-DD）
        logs_root: 日志根目录
        
    Returns:
        DailyLogger实例
    """
    return DailyLogger(date, logs_root)


def generate_daily_report(
    date: str,
    success_count: int,
    failure_count: int,
    log_file: Path,
    articles: Optional[List[Dict]] = None
) -> str:
    """
    生成每日报告（简化版本）
    
    Args:
        date: 日期字符串
        success_count: 成功数量
        failure_count: 失败数量
        log_file: 日志文件路径
        articles: 详细的文章列表（可选）
        
    Returns:
        报告文件路径
    """
    return str(log_file)


# 独立的函数版本（兼容旧接口）
def log_success(date: str, article: Dict, logs_root: str = "logs"):
    """记录成功（独立函数）"""
    logger = DailyLogger(date, logs_root)
    logger.log_success(article)
    return logger


def log_failure(date: str, article: Dict, reason: str, logs_root: str = "logs"):
    """记录失败（独立函数）"""
    logger = DailyLogger(date, logs_root)
    logger.log_failure(article, reason)
    return logger


# 测试入口
if __name__ == "__main__":
    # 测试日志功能
    today = datetime.now().strftime("%Y-%m-%d")
    
    logger = init_daily_log(today, "logs")
    
    # 测试记录成功
    article1 = {
        'id': 1,
        'title': '测试文章1',
        'source_name': '图书情报知识',
        'rss_source_id': 1
    }
    logger.log_success(article1)
    
    # 测试记录失败
    article2 = {
        'id': 2,
        'title': '测试文章2',
        'journal_id': 1
    }
    logger.log_failure(article2, "PDF下载失败")
    
    print(f"[OK] 日志已生成: {logger.log_file}")
    print(f"成功: {logger.success_count}, 失败: {logger.failure_count}")
