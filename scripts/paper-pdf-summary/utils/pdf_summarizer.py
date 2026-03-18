#!/usr/bin/env python3
"""
PDF总结模块 - 调用HiAgent进行PDF总结

功能：
1. 上传PDF到HiAgent获取总结
2. 生成MD文件
3. 支持删除原PDF
"""

import subprocess
import sys
import os
import re
from pathlib import Path
from typing import Optional, Tuple
import yaml


def load_config(config_path: str = "config/config.yaml") -> dict:
    """加载配置文件"""
    config_path = Path(config_path)
    if not config_path.exists():
        raise FileNotFoundError(f"配置文件不存在: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def summarize_pdf(pdf_path: str, config: dict) -> Optional[str]:
    """
    调用HiAgent进行PDF总结

    Args:
        pdf_path: PDF文件路径
        config: 配置字典

    Returns:
        生成的MD文件路径，失败返回None
    """
    pdf_config = config.get('pdf_summary', {})
    script = pdf_config.get('script', 'pdf-summary/hiagent_upload.py')
    script_path = Path(__file__).parent.parent / script

    if not script_path.exists():
        print(f"[错误] PDF总结脚本不存在: {script_path}")
        return None

    # 加载.env
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path)

    delete_pdf = pdf_config.get('delete_pdf', True)

    # 构建MD输出路径
    pdf_file = Path(pdf_path)
    md_path = pdf_file.with_suffix('.md')

    print(f"[INFO] PDF总结: {pdf_path} -> {md_path}")
    print(f"[INFO] 删除原PDF: {'是' if delete_pdf else '否'}")

    # 构建命令参数
    cmd = [sys.executable, str(script_path), str(pdf_path)]
    if delete_pdf:
        cmd.append("--delete")
    else:
        cmd.append("--no-delete")  # 使用 --no-delete 而不是 --delete false

    try:
        print(f"[INFO] 调用脚本: {' '.join(cmd)}")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10分钟超时
            env=os.environ.copy()
        )

        output = result.stdout + result.stderr
        return_code = result.returncode

        print(f"[INFO] 子进程返回码: {return_code}")

        # 输出前500字符的日志
        if output:
            print(f"[输出] {output[:500]}")
            if len(output) > 500:
                print(f"[输出] ... (总计 {len(output)} 字符)")

        # 检查是否生成了MD文件（关键判断）
        if md_path.exists() and md_path.stat().st_size > 0:
            md_size = md_path.stat().st_size
            print(f"[成功] MD文件已生成: {md_path} ({md_size} 字节)")
            return str(md_path)

        # 尝试查找其他可能的输出位置
        possible_md = list(Path('.').glob(f"**/{pdf_file.stem}.md"))
        if possible_md:
            found_md = possible_md[0]
            if found_md.exists() and found_md.stat().st_size > 0:
                md_size = found_md.stat().st_size
                print(f"[警告] 在非预期位置找到MD: {found_md} ({md_size} 字节)")
                return str(found_md)

        # 检查输出中的错误信息
        if re.search(r'错误|error|失败|fail', output, re.IGNORECASE):
            print(f"[失败] PDF总结失败 - 输出中检测到错误")
            return None

        print(f"[失败] 未找到有效的MD文件")
        return None

    except subprocess.TimeoutExpired:
        print("[警告] PDF总结脚本超时，检查MD文件是否已生成...")
        # 超时后检查MD文件是否已生成
        if md_path.exists() and md_path.stat().st_size > 0:
            md_size = md_path.stat().st_size
            print(f"[恢复] 检测到MD文件已生成: {md_path} ({md_size} 字节)")
            print(f"[成功] 虽然超时，但MD文件有效，继续处理")
            return str(md_path)

        print("[失败] PDF总结超时且未生成有效的MD文件")
        return None

    except Exception as e:
        print(f"[警告] PDF总结异常: {e}")
        # 异常后检查MD文件是否已生成
        if md_path.exists() and md_path.stat().st_size > 0:
            md_size = md_path.stat().st_size
            print(f"[恢复] 检测到MD文件已生成: {md_path} ({md_size} 字节)")
            print(f"[成功] 虽然发生异常，但MD文件有效，继续处理")
            return str(md_path)

        print(f"[失败] PDF总结异常且未生成有效的MD文件")
        import traceback
        traceback.print_exc()
        return None


# 测试入口
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
    else:
        print("用法: python pdf_summarizer.py <pdf_path>")
        sys.exit(1)
    
    try:
        config = load_config()
        md_path = summarize_pdf(pdf_path, config)
        
        if md_path:
            print(f"\n[成功] MD文件: {md_path}")
        else:
            print(f"\n[失败] PDF总结失败")
            
    except Exception as e:
        print(f"[错误] {e}")
