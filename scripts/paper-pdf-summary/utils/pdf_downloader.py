#!/usr/bin/env python3
"""
PDF下载器封装模块 - 按优先级调用PDF下载脚本

功能：
1. 按优先级顺序尝试多个下载脚本
2. 支持动态配置下载脚本列表
3. 处理脚本输出，提取下载结果
"""

import subprocess
import sys
import os
import re
from pathlib import Path
from typing import Optional, List, Dict
import yaml

from utils.pdf_validator import validate_pdf, delete_pdf, check_pdf_integrity


def load_config(config_path: str = "config/config.yaml") -> Dict:
    """
    加载配置文件
    
    Args:
        config_path: 配置文件路径
        
    Returns:
        配置字典
    """
    config_path = Path(config_path)
    if not config_path.exists():
        raise FileNotFoundError(f"配置文件不存在: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def get_download_scripts_priority(config: Dict) -> List[str]:
    """
    获取下载脚本优先级列表
    
    Args:
        config: 配置字典
        
    Returns:
        脚本路径列表
    """
    pdf_config = config.get('pdf_download', {})
    scripts = pdf_config.get('priority_scripts', [])
    
    # 转换为绝对路径（相对于项目根目录）
    project_root = Path(__file__).parent.parent
    
    result = []
    for script in scripts:
        script_path = project_root / script
        if script_path.exists():
            result.append(str(script_path))
        else:
            print(f"[WARN] 下载脚本不存在: {script_path}")
    
    return result


def create_download_directory(download_root: str, date: str) -> Path:
    """
    创建当日下载目录
    
    Args:
        download_root: 下载根目录
        date: 日期字符串（YYYY-MM-DD）
        
    Returns:
        目录路径
    """
    download_dir = Path(download_root) / date
    download_dir.mkdir(parents=True, exist_ok=True)
    return download_dir


def call_download_script(script_path: str, keyword: str, output_dir: str, max_retries: int = 1) -> Optional[str]:
    """
    调用PDF下载脚本

    Args:
        script_path: 脚本路径
        keyword: 检索关键词（文章标题）
        output_dir: 输出目录
        max_retries: 最大重试次数（由脚本内部处理）

    Returns:
        下载的PDF文件路径，失败返回None
    """
    script_path = Path(script_path)

    if not script_path.exists():
        print(f"[ERROR] 下载脚本不存在: {script_path}")
        return None

    print(f"[INFO] 调用下载脚本: {script_path.name}")
    print(f"[INFO] 检索关键词: {keyword}")
    print(f"[INFO] 输出目录: {output_dir}")

    # 设置环境变量，传递输出目录
    env = os.environ.copy()
    env['PDF_OUTPUT_DIR'] = output_dir

    try:
        # 调用脚本（不传递 max_retries，由脚本内部处理重试）
        result = subprocess.run(
            ["xvfb-run", "-a", sys.executable, str(script_path), keyword],
            capture_output=True,
            text=True,
            timeout=600,  # 10分钟超时（含重试时间）
            env=env
        )

        # 打印输出
        if result.stdout:
            print(f"[STDOUT]\n{result.stdout}")
        if result.stderr:
            print(f"[STDERR]\n{result.stderr}")

        # 分析输出，判断是否成功
        output = result.stdout + result.stderr

        # 成功标志
        success_patterns = [
            r'下载成功',
            r'✅ .*成功',
            r'Download.*success',
            r'\.pdf.*保存',
        ]

        for pattern in success_patterns:
            if re.search(pattern, output, re.IGNORECASE):
                # 尝试提取PDF路径
                pdf_path = extract_pdf_path(output)
                if pdf_path and Path(pdf_path).exists():
                    return pdf_path

                # 如果脚本没有返回路径，尝试在输出目录查找最新的PDF
                latest_pdf = find_latest_pdf(output_dir)
                if latest_pdf:
                    return latest_pdf

        # 检查失败标志
        failure_patterns = [
            r'检索无结果',
            r'下载失败',
            r'没有找到',
            r'未检测到下载文件',
            r'验证码超时',
            r'达到最大重试次数',
        ]

        for pattern in failure_patterns:
            if re.search(pattern, output, re.IGNORECASE):
                print(f"[WARN] 下载失败: {pattern}")
                return None

        # 没有明确的成功/失败标志，尝试查找PDF
        latest_pdf = find_latest_pdf(output_dir)
        if latest_pdf:
            return latest_pdf

        return None

    except subprocess.TimeoutExpired:
        print(f"[ERROR] 下载脚本超时")
        return None
    except Exception as e:
        print(f"[ERROR] 调用下载脚本异常: {e}")
        import traceback
        traceback.print_exc()
        return None
        
    except subprocess.TimeoutExpired:
        print(f"[ERROR] 下载脚本超时")
        return None
    except Exception as e:
        print(f"[ERROR] 调用下载脚本异常: {e}")
        import traceback
        traceback.print_exc()
        return None


def extract_pdf_path(output: str) -> Optional[str]:
    """
    从脚本输出中提取PDF路径
    
    Args:
        output: 脚本输出
        
    Returns:
        PDF路径，如果未找到返回None
    """
    # 常见的路径模式
    patterns = [
        r'文件路径[：:]\s*(.+\.pdf)',
        r'保存到[：:]\s*(.+\.pdf)',
        r'save.*to[：:]\s*(.+\.pdf)',
        r'([A-Za-z]:\\[^\s]+\.pdf)',  # Windows绝对路径
        r'(/[^\s]+\.pdf)',  # Unix绝对路径
    ]
    
    for pattern in patterns:
        match = re.search(pattern, output, re.IGNORECASE)
        if match:
            return match.group(1)
    
    return None


def find_latest_pdf(directory: str) -> Optional[str]:
    """
    在目录中查找最新的PDF文件
    
    Args:
        directory: 目录路径
        
    Returns:
        最新PDF文件路径，如果未找到返回None
    """
    dir_path = Path(directory)
    if not dir_path.exists():
        return None
    
    pdf_files = list(dir_path.glob("*.pdf"))
    
    if not pdf_files:
        return None
    
    # 按修改时间排序，返回最新的
    latest = max(pdf_files, key=lambda p: p.stat().st_mtime)
    return str(latest)


def download_pdf(
    title: str,
    output_dir: str,
    config: Dict
) -> Optional[str]:
    """
    PDF下载主函数 - 按优先级尝试多个下载脚本
    
    Args:
        title: 文章标题（作为检索关键词）
        output_dir: 输出目录
        config: 配置字典
        
    Returns:
        下载的PDF路径，失败返回None
    """
    scripts = get_download_scripts_priority(config)
    
    if not scripts:
        print("[ERROR] 没有可用的下载脚本")
        return None
    
    max_retries = config.get('pdf_download', {}).get('max_retries', 1)
    
    # 按优先级尝试每个脚本
    for i, script_path in enumerate(scripts, 1):
        script_name = Path(script_path).name
        print(f"\n{'='*50}")
        print(f"[尝试 {i}/{len(scripts)}] 使用脚本: {script_name}")
        print('='*50)
        
        pdf_path = call_download_script(
            script_path, 
            title, 
            output_dir, 
            max_retries
        )
        
        if not pdf_path:
            print(f"[FAIL] 脚本 {script_name} 下载失败，尝试下一个脚本")
            continue
        
        # 检查PDF完整性
        is_valid, valid_reason = check_pdf_integrity(pdf_path)
        if not is_valid:
            print(f"[损坏] PDF文件损坏: {valid_reason}")
            print(f"[删除] 删除损坏的PDF，尝试下一个脚本")
            delete_pdf(pdf_path)
            continue
        
        print(f"[检查] PDF完整性检查通过: {valid_reason}")
        
        # 验证PDF文件名是否匹配
        threshold = config.get('pdf_download', {}).get('match_threshold', 0)
        matched, match_reason = validate_pdf(pdf_path, title, threshold)
        
        if matched:
            print(f"[OK] 脚本 {script_name} 下载成功: {pdf_path}")
            return pdf_path
        else:
            print(f"[不匹配] PDF文件名与标题不匹配: {match_reason}")
            print(f"[删除] 删除不匹配的PDF，尝试下一个脚本")
            delete_pdf(pdf_path)
            continue
    
    # 所有脚本都失败
    print(f"[ERROR] 所有下载脚本均失败")
    return None


# 测试入口
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        title = sys.argv[1]
    else:
        title = "测试文章标题"
    
    # 测试加载配置
    try:
        config = load_config()
        print(f"[OK] 配置文件加载成功")
        
        # 测试获取脚本列表
        scripts = get_download_scripts_priority(config)
        print(f"[INFO] 可用下载脚本: {scripts}")
        
    except Exception as e:
        print(f"[ERROR] {e}")
