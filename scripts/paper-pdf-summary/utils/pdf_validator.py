#!/usr/bin/env python3
"""
PDF验证模块 - 验证下载的PDF是否与标题匹配

功能：
1. 验证PDF文件名是否与文章标题匹配
2. 删除不匹配的PDF文件
3. 提供详细的验证报告
4. 检查PDF完整性（是否损坏）
"""

import os
import re
from pathlib import Path
from typing import Tuple, Optional, Dict
from utils.keyword_normalizer import normalize_text, extract_filename_key, is_match, diagnose_text

try:
    import fitz
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False
    print("[WARN] PyMuPDF未安装，PDF完整性检查功能不可用")


def get_pdf_filename(pdf_path: str) -> str:
    """
    获取PDF文件名（不含路径）
    
    Args:
        pdf_path: PDF文件完整路径
        
    Returns:
        文件名
    """
    return Path(pdf_path).name


def validate_pdf(pdf_path: str, original_title: str, threshold: int = 0) -> Tuple[bool, str]:
    """
    验证PDF是否与原始标题匹配
    
    验证逻辑：
    1. 获取PDF文件名
    2. 将标题和文件名都标准化（去除空格、标点等）
    3. 进行完全匹配
    
    Args:
        pdf_path: PDF文件路径
        original_title: 原始文章标题
        threshold: 允许的误差字符数（目前只支持0，即完全匹配）
        
    Returns:
        (是否匹配, 原因描述)
    """
    if not pdf_path or not original_title:
        return False, "PDF路径或标题为空"
    
    pdf_file = Path(pdf_path)
    
    # 检查文件是否存在
    if not pdf_file.exists():
        return False, f"PDF文件不存在: {pdf_path}"
    
    # 检查是否是PDF文件
    if pdf_file.suffix.lower() != '.pdf':
        return False, f"不是PDF文件: {pdf_file.suffix}"
    
    # 获取文件名
    filename = pdf_file.name
    
    # 诊断文件名
    filename_diag = diagnose_text(filename)
    print(f"\n[文件名诊断]")
    print(f"  原始: {filename}")
    print(f"  标准化: {filename_diag['normalized']}")
    print(f"  长度: {filename_diag['length']} -> {len(filename_diag['normalized'])}")
    if filename_diag['issues']:
        print(f"  问题: {filename_diag['issues']}")
    
    # 诊断标题
    title_diag = diagnose_text(original_title)
    print(f"\n[标题诊断]")
    print(f"  原始: {original_title[:50]}...")
    print(f"  标准化: {title_diag['normalized'][:50]}...")
    print(f"  长度: {title_diag['length']} -> {len(title_diag['normalized'])}")
    if title_diag['issues']:
        print(f"  问题: {title_diag['issues']}")
    
    # 执行匹配
    matched, reason = is_match(original_title, filename, threshold)
    
    print(f"\n[匹配结果]: {matched}")
    print(f"  原因: {reason}")
    
    return matched, reason


def delete_pdf(pdf_path: str) -> bool:
    """
    删除PDF文件
    
    Args:
        pdf_path: PDF文件路径
        
    Returns:
        是否删除成功
    """
    try:
        pdf_file = Path(pdf_path)
        
        if not pdf_file.exists():
            print(f"[WARN] 文件不存在，跳过删除: {pdf_path}")
            return True
        
        pdf_file.unlink()
        print(f"[OK] 已删除PDF文件: {pdf_path}")
        return True
        
    except Exception as e:
        print(f"[ERROR] 删除PDF失败: {e}")
        return False


def validate_and_cleanup(pdf_path: str, original_title: str, threshold: int = 0, delete_on_mismatch: bool = True) -> Tuple[bool, str]:
    """
    验证PDF并在不匹配时删除
    
    Args:
        pdf_path: PDF文件路径
        original_title: 原始文章标题
        threshold: 允许的误差字符数
        delete_on_mismatch: 不匹配时是否删除
        
    Returns:
        (是否匹配, 原因描述)
    """
    matched, reason = validate_pdf(pdf_path, original_title, threshold)
    
    if not matched and delete_on_mismatch:
        print(f"\n[操作] PDF与标题不匹配，删除文件...")
        delete_pdf(pdf_path)
    
    return matched, reason


def check_pdf_integrity(pdf_path: str) -> Tuple[bool, str]:
    """
    检查PDF文件是否完整、可正常打开
    
    检查方法：
    1. 尝试用PyMuPDF打开PDF
    2. 检查是否能读取PDF元数据
    3. 检查是否有页数
    
    Args:
        pdf_path: PDF文件路径
        
    Returns:
        (是否完整, 原因描述)
    """
    if not pdf_path:
        return False, "PDF路径为空"
    
    pdf_file = Path(pdf_path)
    
    if not pdf_file.exists():
        return False, f"PDF文件不存在: {pdf_path}"
    
    if pdf_file.suffix.lower() != '.pdf':
        return False, f"不是PDF文件: {pdf_file.suffix}"
    
    if pdf_file.stat().st_size == 0:
        return False, "PDF文件大小为0（空文件）"
    
    if pdf_file.stat().st_size < 1000:
        return False, f"PDF文件过小（{pdf_file.stat().st_size} 字节），可能是损坏或无效文件"
    
    if not PYMUPDF_AVAILABLE:
        return True, "PyMuPDF未安装，跳过深度检查"
    
    try:
        doc = fitz.open(pdf_path)
        
        if doc.is_closed:
            doc.close()
            return False, "PDF无法保持打开状态"
        
        page_count = len(doc)
        
        if page_count == 0:
            doc.close()
            return False, "PDF页数为0（可能是损坏文件）"
        
        try:
            metadata = doc.metadata
            if not metadata:
                doc.close()
                return False, "PDF元数据为空，可能损坏"
        except Exception:
            pass
        
        for page_num in range(min(3, page_count)):
            try:
                page = doc[page_num]
                page.get_text("text")
            except Exception as e:
                doc.close()
                return False, f"PDF第{page_num + 1}页读取失败: {str(e)}"
        
        doc.close()
        return True, f"PDF完整，{page_count}页"
        
    except Exception as e:
        error_msg = str(e).lower()
        if "encrypted" in error_msg:
            return False, "PDF已加密，无法读取"
        elif "corrupt" in error_msg or "damaged" in error_msg:
            return False, f"PDF文件损坏: {str(e)}"
        elif "invalid" in error_msg:
            return False, f"PDF文件无效: {str(e)}"
        else:
            return False, f"PDF无法正常打开: {str(e)}"


def get_pdf_info(pdf_path: str) -> Optional[Dict]:
    """
    获取PDF文件信息
    
    Args:
        pdf_path: PDF文件路径
        
    Returns:
        文件信息字典
    """
    try:
        pdf_file = Path(pdf_path)
        
        if not pdf_file.exists():
            return None
        
        stat = pdf_file.stat()
        
        return {
            'path': str(pdf_file.absolute()),
            'name': pdf_file.name,
            'size': stat.st_size,
            'size_mb': round(stat.st_size / 1024 / 1024, 2),
            'created': stat.st_ctime,
            'modified': stat.st_mtime,
        }
        
    except Exception as e:
        print(f"[ERROR] 获取PDF信息失败: {e}")
        return None


# 测试入口
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 2:
        pdf_path = sys.argv[1]
        title = sys.argv[2]
    else:
        pdf_path = "test.pdf"
        title = "分级阅读的历史逻辑、本土特质与实践路径"
    
    print(f"PDF文件: {pdf_path}")
    print(f"标题: {title}")
    print("=" * 50)
    
    # 验证
    matched, reason = validate_and_cleanup(pdf_path, title)
    
    print("=" * 50)
    print(f"最终结果: {'匹配' if matched else '不匹配'}")
    print(f"原因: {reason}")
