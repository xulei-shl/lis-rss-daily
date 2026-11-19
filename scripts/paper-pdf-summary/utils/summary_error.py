#!/usr/bin/env python3
"""
摘要内容错误识别

HiAgent 或 PDF 处理失败时，生成的 MD 往往不是摘要而是错误文案。
API 链路（utils/api_queue.py）与 CLI 链路（main.py）共用这里的模式清单，
避免多处重复维护。
"""

import re
from typing import Optional

# 摘要 MD 内容中的错误特征
SUMMARY_ERROR_PATTERNS = [
    r'无法完成',
    r'无法正常',
    r'No /Root object',
    r'Is this really a PDF',
    r'^文件链接无法正常访问',
    r'^文件格式异常',
    r'^链接无效',
    r'^格式异常',
    r'PDF.*?异常',
    r'处理失败',
    r'调用失败',
    r'抱歉.*?无法.*?',
    r'对不起.*?无法.*?',
    r'请求异常',
    r'稍后重试',
    # HiAgent agent 本身执行失败（工具未授权 / 入参错误 / 网络异常），返回的不是摘要
    r'agent\s*执行出错',
    r'执行出错.*(?:工具未授权|入参错误|网络异常)',
]


def contains_summary_error(md_content: Optional[str], max_length: Optional[int] = None) -> bool:
    """
    判断摘要内容是否其实是错误信息。

    Args:
        md_content: 摘要 MD 内容
        max_length: 只检查短内容时传入长度上限（CLI 链路用 200），None 表示不限长度

    Returns:
        True 表示内容命中了错误特征
    """
    if not md_content:
        return False
    if max_length is not None and len(md_content) >= max_length:
        return False
    return any(re.search(p, md_content, re.IGNORECASE) for p in SUMMARY_ERROR_PATTERNS)
