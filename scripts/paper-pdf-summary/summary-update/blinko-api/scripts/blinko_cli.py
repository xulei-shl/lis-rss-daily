#!/usr/bin/env python3
"""
Blinko API CLI - 命令行接口
"""

import sys
import argparse
import json
from pathlib import Path

from blinko_client import BlinkoClient, load_config
from blinko_client.base import BlinkoConfig


def cmd_create(args):
    """创建笔记命令"""
    client = BlinkoClient()

    if args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"❌ 文件不存在: {args.file}")
            sys.exit(1)
        content = file_path.read_text(encoding='utf-8')
        print(f"📄 已加载文件: {args.file}")
    else:
        content = args.content

    if not content:
        print("❌ 错误: 需要提供内容 (content 参数或 --file)")
        sys.exit(1)

    note_type = 0
    if args.type:
        note_type_map = {'flash': 0, 'normal': 1, 'daily': 2}
        note_type = note_type_map.get(args.type, 0)

    result = client.notes.upsert(
        content=content,
        note_type=note_type,
        is_share=args.shared,
        is_top=args.top,
    )
    print(f"✅ 笔记创建成功")
    print(f"   ID: {result.get('id')}")


def cmd_list(args):
    """列出笔记命令"""
    client = BlinkoClient()

    note_type = -1
    if args.type:
        note_type_map = {'flash': 0, 'normal': 1, 'daily': 2, 'all': -1}
        note_type = note_type_map.get(args.type, -1)

    notes = client.notes.list(
        page=args.page,
        size=args.limit,
        note_type=note_type,
        search_text=args.search,
        order_by=args.order,
    )

    if args.json:
        print(json.dumps(notes, indent=2, ensure_ascii=False))
    else:
        print(f"共 {len(notes)} 条笔记:")
        for i, note in enumerate(notes, 1):
            content = note.get('content', '')[:60].replace('\n', ' ')
            print(f"  {i}. [ID:{note.get('id')}] {content}...")


def cmd_get(args):
    """获取笔记详情命令"""
    client = BlinkoClient()
    note = client.notes.get_detail(args.id)

    if args.json:
        print(json.dumps(note, indent=2, ensure_ascii=False))
    else:
        print(f"笔记 ID: {note.get('id')}")
        print(f"内容:\n{note.get('content')}")
        print(f"类型: {note.get('type')}")
        print(f"创建时间: {note.get('createdAt')}")


def cmd_delete(args):
    """删除笔记命令"""
    client = BlinkoClient()
    client.notes.delete(args.id)
    print(f"✅ 笔记已删除: {args.id}")


def cmd_tag(args):
    """标签管理命令"""
    client = BlinkoClient()

    if args.subcommand == 'list':
        tags = client.tags.list()
        if args.json:
            print(json.dumps(tags, indent=2, ensure_ascii=False))
        else:
            print(f"共 {len(tags)} 个标签:")
            for tag in tags:
                print(f"  - {tag.get('name')} (ID: {tag.get('id')})")


def main():
    parser = argparse.ArgumentParser(
        description="Blinko API CLI - 管理你的 Blinko 笔记",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s create "#inbox 今日会议记录"
  %(prog)s list --limit 10
  %(prog)s get 123
  %(prog)s delete 123
  %(prog)s tag list
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='可用命令')

    create_parser = subparsers.add_parser('create', help='创建笔记')
    create_parser.add_argument('content', nargs='?', help='笔记内容 (支持 Markdown)')
    create_parser.add_argument('--file', '-f', help='从文件读取内容')
    create_parser.add_argument('--type', '-t', choices=['flash', 'normal', 'daily'],
                               default='flash', help='笔记类型 (默认: flash)')
    create_parser.add_argument('--shared', action='store_true', help='公开分享')
    create_parser.add_argument('--top', action='store_true', help='置顶')

    list_parser = subparsers.add_parser('list', help='列出笔记')
    list_parser.add_argument('--limit', type=int, default=10, help='数量 (默认: 10)')
    list_parser.add_argument('--page', type=int, default=1, help='页码 (默认: 1)')
    list_parser.add_argument('--type', choices=['all', 'flash', 'normal', 'daily'],
                             default='all', help='笔记类型')
    list_parser.add_argument('--search', '-s', default='', help='搜索关键词')
    list_parser.add_argument('--order', choices=['asc', 'desc'], default='desc', help='排序')
    list_parser.add_argument('--json', action='store_true', help='JSON 输出')

    get_parser = subparsers.add_parser('get', help='获取笔记详情')
    get_parser.add_argument('id', type=int, help='笔记 ID')
    get_parser.add_argument('--json', action='store_true', help='JSON 输出')

    delete_parser = subparsers.add_parser('delete', help='删除笔记')
    delete_parser.add_argument('id', type=int, help='笔记 ID')

    tag_parser = subparsers.add_parser('tag', help='标签管理')
    tag_subparsers = tag_parser.add_subparsers(dest='subcommand')
    tag_list_parser = tag_subparsers.add_parser('list', help='列出标签')
    tag_list_parser.add_argument('--json', action='store_true', help='JSON 输出')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    try:
        if args.command == 'create':
            cmd_create(args)
        elif args.command == 'list':
            cmd_list(args)
        elif args.command == 'get':
            cmd_get(args)
        elif args.command == 'delete':
            cmd_delete(args)
        elif args.command == 'tag':
            cmd_tag(args)
    except Exception as e:
        print(f"❌ 错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()