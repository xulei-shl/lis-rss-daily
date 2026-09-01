"""
项目根目录解析模块

所有模块应通过此文件获取项目根目录，避免 sys.path hack。
使用方法：from utils.project_root import PROJECT_ROOT
"""

from pathlib import Path

# utils/ 位于项目根目录下，所以 parent.parent 就是项目根
PROJECT_ROOT = Path(__file__).resolve().parent.parent
