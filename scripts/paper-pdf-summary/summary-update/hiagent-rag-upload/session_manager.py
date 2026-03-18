#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Playwright 登录状态管理脚本
用于导出和导入浏览器登录状态，支持跨平台使用
"""

import argparse
import os
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path


# 默认的 Playwright 用户数据目录
DEFAULT_USER_DATA_DIR = Path(__file__).parent / "playwright_user_data"


def get_user_data_dir(custom_path: str = None) -> Path:
    """获取用户数据目录路径"""
    if custom_path:
        return Path(custom_path)
    return DEFAULT_USER_DATA_DIR


def export_session(output_path: str = None, user_data_dir: str = None):
    """
    导出登录状态到压缩包
    
    Args:
        output_path: 输出压缩包路径，默认使用时间戳命名
        user_data_dir: 用户数据目录路径
    """
    source_dir = get_user_data_dir(user_data_dir)
    
    if not source_dir.exists():
        raise FileNotFoundError(f"登录状态目录不存在: {source_dir}")
    
    # 确定输出路径
    if output_path:
        output_path = Path(output_path)
    else:
        # 默认使用时间戳命名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = Path(__file__).parent / f"playwright_session_{timestamp}.zip"
    
    print(f"正在导出登录状态...")
    print(f"源目录: {source_dir}")
    print(f"目标文件: {output_path}")
    
    # 创建压缩包
    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(source_dir):
                # 排除不需要的目录
                dirs[:] = [d for d in dirs if d not in ['Cache', 'Cache_Data', 'Code Cache', 'GPUCache', 'Logs', 'Network']]
                
                for file in files:
                    # 排除缓存和日志文件
                    if file.endswith(('.log', '.log.old', 'journal', 'LOCK', 'tmp')):
                        continue
                    if file.startswith('chrome_debug'):
                        continue
                    
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(source_dir)
                    
                    # 跳过被锁定的文件（如浏览器正在使用的 Cookie 文件）
                    try:
                        zipf.write(file_path, arcname)
                    except (PermissionError, IOError) as e:
                        print(f"  跳过被锁定的文件: {file}")
                        continue
        
        # 显示输出文件大小
        size_mb = output_path.stat().st_size / (1024 * 1024)
        print(f"✅ 导出成功! 文件大小: {size_mb:.2f} MB")
        print(f"   保存位置: {output_path}")
        
        return str(output_path)
        
    except Exception as e:
        print(f"❌ 导出失败: {e}")
        raise


def import_session(archive_path: str, user_data_dir: str = None):
    """
    从压缩包导入登录状态
    
    Args:
        archive_path: 压缩包路径
        user_data_dir: 目标用户数据目录路径
    """
    archive_path = Path(archive_path)
    
    if not archive_path.exists():
        raise FileNotFoundError(f"压缩包不存在: {archive_path}")
    
    target_dir = get_user_data_dir(user_data_dir)
    
    print(f"正在导入登录状态...")
    print(f"压缩包: {archive_path}")
    print(f"目标目录: {target_dir}")
    
    # 备份现有数据（如果存在）
    if target_dir.exists():
        backup_dir = target_dir.parent / f"playwright_user_data_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        print(f"正在备份现有数据到: {backup_dir}")
        shutil.move(str(target_dir), str(backup_dir))
    
    # 创建目标目录
    target_dir.mkdir(parents=True, exist_ok=True)
    
    # 解压压缩包
    try:
        with zipfile.ZipFile(archive_path, 'r') as zipf:
            zipf.extractall(target_dir)
        
        print(f"✅ 导入成功!")
        print(f"   登录状态已恢复到: {target_dir}")
        
        return str(target_dir)
        
    except Exception as e:
        print(f"❌ 导入失败: {e}")
        raise


def auto_export(user_data_dir: str = None):
    """
    自动导出登录状态（用于脚本自动调用）
    
    Args:
        user_data_dir: 用户数据目录路径
    
    Returns:
        导出的压缩包路径，如果无需导出则返回 None
    """
    source_dir = get_user_data_dir(user_data_dir)
    
    if not source_dir.exists():
        print("⚠️ 登录状态目录不存在，跳过导出")
        return None
    
    # 使用固定名称，方便后续导入
    output_path = Path(__file__).parent / "playwright_session_latest.zip"
    
    try:
        # 如果已存在同名文件，先删除
        if output_path.exists():
            output_path.unlink()
        
        export_session(str(output_path), str(source_dir))
        return str(output_path)
        
    except Exception as e:
        print(f"⚠️ 自动导出失败: {e}")
        return None


def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description='Playwright 登录状态管理工具 - 导出/导入浏览器登录状态'
    )
    
    # 子命令
    subparsers = parser.add_subparsers(dest='command', help='可用命令')
    
    # 导出命令
    export_parser = subparsers.add_parser('export', help='导出登录状态到压缩包')
    export_parser.add_argument(
        '-o', '--output',
        type=str,
        default=None,
        help='输出压缩包路径，默认使用时间戳自动命名'
    )
    export_parser.add_argument(
        '-d', '--dir',
        type=str,
        default=None,
        help='用户数据目录路径，默认使用脚本同目录下的 playwright_user_data'
    )
    
    # 导入命令
    import_parser = subparsers.add_parser('import', help='从压缩包导入登录状态')
    import_parser.add_argument(
        'archive',
        type=str,
        help='要导入的压缩包路径'
    )
    import_parser.add_argument(
        '-d', '--dir',
        type=str,
        default=None,
        help='目标用户数据目录路径，默认使用脚本同目录下的 playwright_user_data'
    )
    
    # 自动导出命令（供其他脚本调用）
    auto_parser = subparsers.add_parser('auto-export', help='自动导出登录状态（供脚本内部使用）')
    auto_parser.add_argument(
        '-d', '--dir',
        type=str,
        default=None,
        help='用户数据目录路径，默认使用脚本同目录下的 playwright_user_data'
    )
    
    return parser.parse_args()


def main():
    """主函数"""
    args = parse_args()
    
    if not args.command:
        parser = argparse.ArgumentParser(
            description='Playwright 登录状态管理工具'
        )
        parser.print_help()
        print("\n示例:")
        print("  python session_manager.py export                    # 导出登录状态")
        print("  python session_manager.py export -o my_session.zip  # 导出到指定文件")
        print("  python session_manager.py import my_session.zip      # 导入登录状态")
        return
    
    try:
        if args.command == 'export':
            export_session(args.output, args.dir)
            
        elif args.command == 'import':
            import_session(args.archive, args.dir)
            
        elif args.command == 'auto-export':
            result = auto_export(args.dir)
            if result:
                sys.exit(0)
            else:
                sys.exit(1)
                
    except Exception as e:
        print(f"\n❌ 错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
