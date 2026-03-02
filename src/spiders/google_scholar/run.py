#!/usr/bin/env python3
"""Google Scholar Web Search CLI - 入口脚本

解决相对导入问题，使用绝对导入方式。
"""

import sys
from pathlib import Path

# 添加 scripts 目录到 Python 路径
scripts_dir = Path(__file__).parent / "scripts"
sys.path.insert(0, str(scripts_dir))

# 使用绝对导入
from cli import main

if __name__ == "__main__":
    sys.exit(main())
