#!/usr/bin/env python3
"""
PDF总结模块 - 调用HiAgent进行PDF总结
"""

import subprocess
import sys
import os
import json
from pathlib import Path
from typing import Optional
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

    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path)

    delete_pdf = pdf_config.get('delete_pdf', True)

    pdf_file = Path(pdf_path)
    expected_md_path = pdf_file.with_suffix('.md')

    print(f"[INFO] PDF总结: {pdf_path} -> {expected_md_path}")
    print(f"[INFO] 删除原PDF: {'是' if delete_pdf else '否'}")

    cmd = ["xvfb-run", "-a", sys.executable, str(script_path), str(pdf_path)]
    if delete_pdf:
        cmd.append("--delete")
    else:
        cmd.append("--no-delete")

    try:
        print(f"[INFO] 调用脚本: {' '.join(cmd)}")
        
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=os.environ.copy()
        )

        last_json = None
        for line in proc.stdout:
            print(line, end='')
            try:
                data = json.loads(line.strip())
                if data.get('status') == 'success':
                    last_json = data
            except json.JSONDecodeError:
                pass

        proc.wait()

        if last_json and last_json.get('md_path'):
            md_path = last_json['md_path']
            print(f"[成功] MD文件已生成: {md_path}")
            return md_path

        print("[警告] 未解析到成功状态，检查文件...")

    except subprocess.TimeoutExpired:
        proc.kill()
        print("[警告] 超时，尝试恢复...")
    except Exception as e:
        print(f"[警告] 进程异常: {e}")

    if expected_md_path.exists() and expected_md_path.stat().st_size > 0:
        print(f"[恢复] MD文件已生成: {expected_md_path}")
        return str(expected_md_path)

    md_candidates = list(pdf_file.parent.glob(f"*{pdf_file.stem}*.md"))
    for md_candidate in sorted(md_candidates, key=lambda x: x.stat().st_mtime, reverse=True):
        if md_candidate.stat().st_size > 100:
            print(f"[恢复] 找到MD文件: {md_candidate}")
            return str(md_candidate)

    print(f"[失败] PDF总结失败")
    return None


if __name__ == "__main__":
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