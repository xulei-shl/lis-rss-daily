#!/usr/bin/env python3
"""
Memos API Client with CLI interface
复用现有 MemosClient 类，添加命令行接口

GitHub: https://github.com/usememos/memos
文档: https://usememos.com/docs/api
"""

import sys
import argparse
import os
import json
from pathlib import Path

import requests
from dotenv import load_dotenv
from typing import Optional, List, Dict
from datetime import datetime

# 配置文件路径（从 paper-pdf-summary 根目录加载）
ENV_FILE = Path(__file__).parent.parent.parent / ".env"
load_dotenv(ENV_FILE)


class MemosClient:
    """Memos API 客户端类"""

    def __init__(self, base_url: str, access_token: str):
        """
        初始化 Memos 客户端

        Args:
            base_url: Memos 实例的基础 URL (如: https://memos.example.com 或 http://47.103.50.106:5230)
            access_token: 访问令牌 (在设置中生成，以 memos_ 开头)
        """
        self.base_url = base_url.rstrip('/')
        self.api_base = f"{self.base_url}/api/v1"
        self.headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

    def create_memo(
        self,
        content: str,
        visibility: str = "PRIVATE",
        resource_id_list: Optional[List[int]] = None,
        relation_list: Optional[List[Dict]] = None
    ) -> Dict:
        """创建新备忘录"""
        url = f"{self.api_base}/memos"
        data = {
            "content": content,
            "visibility": visibility,
            "resourceIdList": resource_id_list or [],
            "relationList": relation_list or []
        }

        response = requests.post(url, headers=self.headers, json=data)
        response.raise_for_status()
        return response.json()

    def list_memos(
        self,
        page_size: int = 50,
        page_token: Optional[str] = None,
        filter_query: Optional[str] = None
    ) -> Dict:
        """获取备忘录列表"""
        url = f"{self.api_base}/memos"
        params = {"pageSize": page_size}

        if page_token:
            params["pageToken"] = page_token
        if filter_query:
            params["filter"] = filter_query

        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()

    def get_memo(self, memo_name: str) -> Dict:
        """获取单个备忘录详情"""
        url = f"{self.api_base}/{memo_name}"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()

    def update_memo(
        self,
        memo_name: str,
        content: Optional[str] = None,
        visibility: Optional[str] = None,
        update_mask: Optional[str] = None
    ) -> Dict:
        """更新备忘录"""
        url = f"{self.api_base}/{memo_name}"
        data = {}

        if content is not None:
            data["content"] = content
        if visibility is not None:
            data["visibility"] = visibility

        params = {}
        if update_mask:
            params["updateMask"] = update_mask

        response = requests.patch(
            url,
            headers=self.headers,
            params=params,
            json=data
        )
        response.raise_for_status()
        return response.json()

    def delete_memo(self, memo_name: str) -> Dict:
        """删除备忘录"""
        url = f"{self.api_base}/{memo_name}"
        response = requests.delete(url, headers=self.headers)
        response.raise_for_status()
        return response.json()

    def search_memos(
        self,
        query: str,
        page_size: int = 50
    ) -> List[Dict]:
        """搜索备忘录"""
        filter_query = f'content.contains("{query}")'
        result = self.list_memos(page_size=page_size, filter_query=filter_query)
        return result.get("memos", [])

    def get_all_memos(self, limit: Optional[int] = None) -> List[Dict]:
        """获取所有备忘录（自动分页）"""
        all_memos = []
        page_token = None

        while True:
            result = self.list_memos(page_size=100, page_token=page_token)
            memos = result.get("memos", [])
            all_memos.extend(memos)

            if limit and len(all_memos) >= limit:
                return all_memos[:limit]

            page_token = result.get("nextPageToken")
            if not page_token:
                break

        return all_memos

    def get_memos_by_tag(self, tag: str, limit: int = 10) -> List[Dict]:
        """按标签获取备忘录"""
        all_memos = self.get_all_memos()
        filtered = []
        tag_with_hash = f"#{tag}"

        for memo in all_memos:
            content = memo.get('content', '')
            if tag_with_hash in content or f" #{tag}" in content:
                filtered.append(memo)
                if len(filtered) >= limit:
                    break

        return filtered


def main():
    """CLI 主函数"""
    parser = argparse.ArgumentParser(
        description="Memos API CLI - Manage your Memos notes from command line",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s create "#inbox Today's meeting notes"
  %(prog)s search "Python"
  %(prog)s tag inbox
  %(prog)s list --limit 10
  %(prog)s get memos/AbCd123
  %(prog)s update memos/AbCd123 "Updated content"
  %(prog)s delete memos/AbCd123
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Create command
    create_parser = subparsers.add_parser('create', help='Create a new memo')
    create_parser.add_argument('content', nargs='?', help='Memo content (supports Markdown and #tags)')
    create_parser.add_argument('--file', '-f', help='Read content from file path')
    create_parser.add_argument('--tags', '-t', help='Comma-separated tags to add (e.g., "bot,AI速读")')
    create_parser.add_argument('--visibility', choices=['PRIVATE', 'PROTECTED', 'PUBLIC'],
                              default='PRIVATE', help='Memo visibility (default: PRIVATE)')

    # Search command
    search_parser = subparsers.add_parser('search', help='Search memos by keyword')
    search_parser.add_argument('query', help='Search keyword')
    search_parser.add_argument('--limit', type=int, default=10, help='Result limit (default: 10)')
    search_parser.add_argument('--json', action='store_true', help='Output as JSON')

    # List command
    list_parser = subparsers.add_parser('list', help='List recent memos')
    list_parser.add_argument('--limit', type=int, default=10, help='Number of memos (default: 10)')
    list_parser.add_argument('--json', action='store_true', help='Output as JSON')

    # Get command
    get_parser = subparsers.add_parser('get', help='Get memo details')
    get_parser.add_argument('name', help='Memo name (format: memos/xxx)')
    get_parser.add_argument('--json', action='store_true', help='Output as JSON')

    # Update command
    update_parser = subparsers.add_parser('update', help='Update a memo')
    update_parser.add_argument('name', help='Memo name (format: memos/xxx)')
    update_parser.add_argument('content', help='New content')
    update_parser.add_argument('--visibility', choices=['PRIVATE', 'PROTECTED', 'PUBLIC'],
                               help='New visibility')

    # Delete command
    delete_parser = subparsers.add_parser('delete', help='Delete a memo')
    delete_parser.add_argument('name', help='Memo name (format: memos/xxx)')

    # Tag command
    tag_parser = subparsers.add_parser('tag', help='Get memos by tag')
    tag_parser.add_argument('tag', help='Tag name (without #)')
    tag_parser.add_argument('--limit', type=int, default=10, help='Result limit (default: 10)')
    tag_parser.add_argument('--json', action='store_true', help='Output as JSON')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    # Load configuration
    base_url = os.getenv("MEMOS_BASE_URL")
    access_token = os.getenv("MEMOS_ACCESS_TOKEN")

    if not base_url or not access_token:
        print("❌ Configuration error: MEMOS_BASE_URL and MEMOS_ACCESS_TOKEN required in .env file")
        print(f"   Expected location: {ENV_FILE}")
        sys.exit(1)

    try:
        client = MemosClient(base_url, access_token)

        # Execute command
        if args.command == 'create':
            # Determine content source
            if args.file:
                # Read from file
                file_path = Path(args.file)
                if not file_path.exists():
                    print(f"❌ File not found: {args.file}")
                    sys.exit(1)
                content = file_path.read_text(encoding='utf-8')
                print(f"📄 Loaded content from: {args.file}")
            elif args.content:
                content = args.content
            else:
                print("❌ Error: Either content argument or --file is required")
                print("   Usage: create 'content' OR create --file /path/to/file.md")
                sys.exit(1)

            # Add tags if specified
            if args.tags:
                tag_list = [t.strip() for t in args.tags.split(',')]
                tag_str = ' '.join([f"#{t}" for t in tag_list])
                content = f"{tag_str}\n\n{content}"
                print(f"🏷️  Added tags: {', '.join(tag_list)}")

            result = client.create_memo(content, args.visibility)
            print(f"✅ Memo created successfully")
            print(f"   Name: {result.get('name')}")

        elif args.command == 'search':
            results = client.search_memos(args.query, args.limit)
            if args.json:
                print(json.dumps(results, indent=2, ensure_ascii=False))
            else:
                print(f"Found {len(results)} memo(s) matching '{args.query}':")
                for i, memo in enumerate(results, 1):
                    content = memo.get('content', '').replace('\n', ' ')[:60]
                    print(f"  {i}. {memo.get('name')}: {content}...")

        elif args.command == 'list':
            result = client.list_memos(page_size=args.limit)
            memos = result.get('memos', [])
            if args.json:
                print(json.dumps(memos, indent=2, ensure_ascii=False))
            else:
                print(f"Recent {len(memos)} memo(s):")
                for i, memo in enumerate(memos, 1):
                    content = memo.get('content', '').replace('\n', ' ')[:60]
                    print(f"  {i}. {memo.get('name')}: {content}...")

        elif args.command == 'get':
            memo = client.get_memo(args.name)
            if args.json:
                print(json.dumps(memo, indent=2, ensure_ascii=False))
            else:
                print(f"Memo: {memo.get('name')}")
                print(f"Content:\n{memo.get('content')}")
                print(f"Visibility: {memo.get('visibility')}")
                print(f"Created: {memo.get('createTime')}")

        elif args.command == 'update':
            update_mask = "content"
            if args.visibility:
                update_mask += ",visibility"
            result = client.update_memo(args.name, args.content, args.visibility, update_mask)
            print(f"✅ Memo updated successfully: {result.get('name')}")

        elif args.command == 'delete':
            client.delete_memo(args.name)
            print(f"✅ Memo deleted successfully: {args.name}")

        elif args.command == 'tag':
            results = client.get_memos_by_tag(args.tag, args.limit)
            if args.json:
                print(json.dumps(results, indent=2, ensure_ascii=False))
            else:
                print(f"Found {len(results)} memo(s) with tag '#{args.tag}':")
                for i, memo in enumerate(results, 1):
                    content = memo.get('content', '').replace('\n', ' ')[:60]
                    print(f"  {i}. {memo.get('name')}: {content}...")

    except requests.exceptions.ConnectionError:
        print(f"❌ Connection failed: Cannot reach {base_url}")
        print("   Verify your Memos instance is accessible")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            print("❌ Authentication failed: Invalid access token")
            print("   Check MEMOS_ACCESS_TOKEN in .env file")
        elif e.response.status_code == 404:
            print(f"❌ Not found: {args.name if hasattr(args, 'name') else 'Resource'}")
        else:
            print(f"❌ HTTP Error {e.response.status_code}: {e.response.text}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
