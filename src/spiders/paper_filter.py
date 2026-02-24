#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
论文标题过滤模块

提供统一的非论文条目过滤功能，用于过滤期刊爬虫中的非论文内容。

使用方法：
    from paper_filter import PaperFilter
    
    filter = PaperFilter()
    if filter.should_skip(title):
        continue
"""

from typing import List, Optional


class PaperFilter:
    """论文标题过滤器"""
    
    # 默认跳过的关键词列表（非论文条目）
    DEFAULT_SKIP_KEYWORDS = [
        "优秀审稿专家",
        "优秀编委", 
        "优秀论文",
        "年度优秀",
        "编者按",
        "声明",
        "征稿",
        "选题",
        "征稿",
        "声明",
        "目录",
        "阅读书单",
        "书讯",
    ]
    
    # 默认跳过的精确标题
    DEFAULT_SKIP_EXACT_TITLES = [
        "目录",
    ]
    
    def __init__(
        self,
        skip_keywords: Optional[List[str]] = None,
        skip_exact_titles: Optional[List[str]] = None,
        skip_prefixes: Optional[List[str]] = None,
        extra_keywords: Optional[List[str]] = None,
    ):
        """
        初始化过滤器
        
        Args:
            skip_keywords: 跳过的关键词列表（包含即跳过），默认使用 DEFAULT_SKIP_KEYWORDS
            skip_exact_titles: 精确匹配跳过的标题列表，默认使用 DEFAULT_SKIP_EXACT_TITLES
            skip_prefixes: 跳过的标题前缀列表
            extra_keywords: 额外的跳过关键词（追加到默认列表）
        """
        # 使用默认值或自定义值
        self.skip_keywords = skip_keywords if skip_keywords is not None else self.DEFAULT_SKIP_KEYWORDS.copy()
        self.skip_exact_titles = skip_exact_titles if skip_exact_titles is not None else self.DEFAULT_SKIP_EXACT_TITLES.copy()
        self.skip_prefixes = skip_prefixes or []
        
        # 追加额外关键词
        if extra_keywords:
            self.skip_keywords.extend(extra_keywords)
    
    def should_skip(self, title: str) -> bool:
        """
        判断是否应该跳过该标题
        
        跳过规则：
        1. 空标题
        2. 精确匹配跳过列表
        3. 包含跳过关键词
        4. 以指定前缀开头
        
        Args:
            title: 论文标题
            
        Returns:
            True 表示跳过，False 表示保留
        """
        if not title:
            return True
        
        title = title.strip()
        
        # 空标题
        if not title:
            return True
        
        # 精确匹配
        if title in self.skip_exact_titles:
            return True
        
        # 关键词匹配
        for keyword in self.skip_keywords:
            if keyword in title:
                return True
        
        # 前缀匹配
        for prefix in self.skip_prefixes:
            if title.startswith(prefix):
                return True
        
        return False
    
    def add_keyword(self, keyword: str):
        """添加跳过关键词"""
        if keyword not in self.skip_keywords:
            self.skip_keywords.append(keyword)
    
    def add_exact_title(self, title: str):
        """添加精确匹配标题"""
        if title not in self.skip_exact_titles:
            self.skip_exact_titles.append(title)
    
    def add_prefix(self, prefix: str):
        """添加跳过前缀"""
        if prefix not in self.skip_prefixes:
            self.skip_prefixes.append(prefix)


def create_default_filter() -> PaperFilter:
    """创建默认过滤器（使用默认配置）"""
    return PaperFilter()


def create_lis_filter() -> PaperFilter:
    """创建图书情报知识期刊专用过滤器
    
    LIS 期刊有特殊规则：
    - 跳过 "专题：xxx 序" 格式
    - 跳过《图书情报工作》相关
    """
    filter = PaperFilter(
        skip_keywords=["优秀审稿专家", "优秀编委", "优秀论文", "年度优秀"],
        skip_prefixes=["《图书情报工作》"],
    )
    # 添加 LIS 特殊规则：跳过 "专题：xxx 序" 格式
    # 这里需要特殊处理，在 should_skip 中检查
    return filter


class LISPaperFilter(PaperFilter):
    """图书情报知识期刊专用过滤器（带特殊规则）"""
    
    def should_skip(self, title: str) -> bool:
        """
        判断是否应该跳过该标题（LIS 特殊规则）
        
        额外规则：
        - 跳过 "专题：xxx 序" 格式
        """
        # 先执行父类规则
        if super().should_skip(title):
            return True
        
        if not title:
            return True
        
        title = title.strip()
        
        # 跳过纯专题标题（不包含具体论文标题）
        # 格式如 "专题：构建面向强国建设的科技文献资源保障发展体系 序"
        # 但保留 "专题：xxx 论文标题" 格式中的论文
        if title.startswith("专题：") and " 序" in title:
            return True
        
        return False


def should_skip_title(title: str, extra_keywords: Optional[List[str]] = None) -> bool:
    """
    快捷函数：判断是否应该跳过该标题
    
    使用默认配置进行过滤，支持额外关键词
    
    Args:
        title: 论文标题
        extra_keywords: 额外的跳过关键词
        
    Returns:
        True 表示跳过，False 表示保留
    """
    filter = PaperFilter(extra_keywords=extra_keywords)
    return filter.should_skip(title)


# 模块测试
if __name__ == "__main__":
    # 测试用例
    test_titles = [
        "目录",
        "",
        "优秀审稿专家名单",
        "年度优秀论文评选结果",
        "编者按：本期导读",
        "声明",
        "征稿启事",
        "基于深度学习的文本分类研究",  # 正常论文
        "《图书情报工作》2025年征稿启事",  # LIS 特殊
        "专题：构建面向强国建设的科技文献资源保障发展体系 序",  # LIS 特殊
    ]
    
    print("=== 默认过滤器测试 ===")
    default_filter = create_default_filter()
    for title in test_titles:
        result = default_filter.should_skip(title)
        status = "跳过" if result else "保留"
        print(f"  [{status}] {title[:40]}...")
    
    print("\n=== LIS 过滤器测试 ===")
    lis_filter = create_lis_filter()
    for title in test_titles:
        result = lis_filter.should_skip(title)
        status = "跳过" if result else "保留"
        print(f"  [{status}] {title[:40]}...")
