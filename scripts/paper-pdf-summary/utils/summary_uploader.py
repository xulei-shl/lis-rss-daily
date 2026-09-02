#!/usr/bin/env python3
"""
并行上传模块 - 并行执行五个子系统的MD文件上传

功能：
1. 并行上传MD到HiAgent RAG知识库
2. 并行上传MD内容到LIS-RSS系统更新ai_summary
3. 并行上传MD到Memos
4. 并行上传MD到Blinko
5. 推送摘要到企业微信
6. 汇总各子系统上传结果
"""

import asyncio
import subprocess
import sys
import os
import re
from pathlib import Path
from typing import Dict, Optional, List
import yaml

from utils.project_root import PROJECT_ROOT

# 添加 Blinko 和 Memos 客户端路径
blinko_client_path = PROJECT_ROOT / "summary-update" / "blinko-api" / "src"
if str(blinko_client_path) not in sys.path:
    sys.path.insert(0, str(blinko_client_path))

memos_client_path = PROJECT_ROOT / "summary-update" / "memos"
if str(memos_client_path) not in sys.path:
    sys.path.insert(0, str(memos_client_path))

# 导入企业微信推送模块
try:
    from wechat.client import WeChatClient
    from wechat.message_formatter import MessageFormatter
    WECHAT_AVAILABLE = True
except ImportError:
    WECHAT_AVAILABLE = False


def load_config(config_path: str = None) -> Dict:
    """加载配置文件"""
    if config_path is None:
        config_path = str(PROJECT_ROOT / "config" / "config.yaml")
    config_path = Path(config_path)
    if not config_path.exists():
        raise FileNotFoundError(f"配置文件不存在: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def load_env():
    """加载.env环境变量"""
    from dotenv import load_dotenv
    
    script_env_path = PROJECT_ROOT / ".env"
    project_env_path = PROJECT_ROOT.parent / ".env"

    if project_env_path.exists():
        load_dotenv(project_env_path, override=False)

    if script_env_path.exists():
        load_dotenv(script_env_path, override=True)


def get_env_bool(name: str, default: bool = False) -> bool:
    """读取布尔环境变量，支持常见真值写法"""
    load_env()

    value = os.getenv(name)
    if value is None:
        return default

    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


async def upload_to_hiagent_rag(md_path: str, config: Dict, delete_md: bool = True, enabled_override: Optional[bool] = None) -> bool:
    print(f"\n{'='*60}")
    print(f"  [子系统1/3] HiAgent RAG知识库上传")
    print(f"{'='*60}")

    summary_config = config.get('summary_upload', {}).get('hiagent_rag', {})
    enabled = summary_config.get('enabled', True) if enabled_override is None else enabled_override
    if not enabled:
        print("[跳过] HiAgent RAG上传已禁用")
        return True

    script = summary_config.get('script', 'summary-update/hiagent-rag-upload/upload_knowledge.py')
    script_path = PROJECT_ROOT / script

    if not script_path.exists():
        print(f"[错误] HiAgent RAG上传脚本不存在: {script_path}")
        return False

    delete_md = summary_config.get('delete_md', True)

    try:
        print(f"[信息] 脚本路径: {script_path}")
        print(f"[信息] MD文件: {md_path}")
        print(f"[信息] 删除MD: {'是' if delete_md else '否'}")

        cmd = [sys.executable, str(script_path), str(md_path)]
        # upload_knowledge.py 默认行为是不删除文件
        # 要删除文件需要显式传递 --delete true
        # 不删除文件可以什么都不传，或传递 --no-delete
        if delete_md:
            cmd.append("--delete")
            cmd.append("true")
        else:
            cmd.append("--no-delete")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=180  # 3分钟超时
        )

        output = result.stdout + result.stderr
        return_code = result.returncode

        print(f"[信息] 返回码: {return_code}")

        if output:
            print(f"[输出] {output[:500]}")
            if len(output) > 500:
                print(f"[输出] ... (总计 {len(output)} 字符)")

        # 检查成功标志
        if re.search(r'成功|success|完成', output, re.IGNORECASE):
            print(f"[成功] HiAgent RAG上传完成")
            return True
        else:
            print(f"[失败] HiAgent RAG上传失败")
            return False

    except subprocess.TimeoutExpired:
        print(f"[错误] HiAgent RAG上传超时")
        return False
    except Exception as e:
        print(f"[错误] HiAgent RAG上传异常: {e}")
        import traceback
        traceback.print_exc()
        return False


async def upload_to_lis_rss(article_id: int, md_content: str, config: Dict) -> bool:
    """
    更新LIS-RSS系统的ai_summary

    Args:
        article_id: 文章ID
        md_content: MD文件内容
        config: 配置字典

    Returns:
        是否成功
    """
    print(f"\n{'='*60}")
    print(f"  [子系统2/3] LIS-RSS系统更新")
    print(f"{'='*60}")

    summary_config = config.get('summary_upload', {}).get('lis_rss', {})

    if not summary_config.get('enabled', True):
        print("[跳过] LIS-RSS更新已禁用")
        return True

    script = summary_config.get('script', 'summary-update/lis-rss-summary-update/update_summary.py')
    script_path = PROJECT_ROOT / script

    if not script_path.exists():
        print(f"[错误] LIS-RSS更新脚本不存在: {script_path}")
        return False

    # 读取.env配置
    load_env()

    api_url = os.getenv('LIS_RSS_API_URL')
    username = os.getenv('LIS_RSS_USERNAME')
    password = os.getenv('LIS_RSS_PASSWORD')

    if not api_url or not username or not password:
        print("[错误] LIS-RSS环境变量未配置")
        return False

    try:
        print(f"[信息] 脚本路径: {script_path}")
        print(f"[信息] 文章ID: {article_id}")
        print(f"[信息] API地址: {api_url}")
        print(f"[信息] MD内容长度: {len(md_content)} 字符")

        # 使用stdin传递内容
        result = subprocess.run(
            [sys.executable, str(script_path),
             "--id", str(article_id),
             "--api-url", api_url,
             "--username", username,
             "--password", password,
             "--stdin"],
            input=md_content,
            capture_output=True,
            text=True,
            timeout=60
        )

        output = result.stdout + result.stderr
        return_code = result.returncode

        print(f"[信息] 返回码: {return_code}")

        if output:
            print(f"[输出] {output[:500]}")
            if len(output) > 500:
                print(f"[输出] ... (总计 {len(output)} 字符)")

        # 检查成功标志
        if re.search(r'success|成功', output, re.IGNORECASE):
            print(f"[成功] LIS-RSS更新完成")
            return True
        else:
            print(f"[失败] LIS-RSS更新失败")
            return False

    except subprocess.TimeoutExpired:
        print(f"[错误] LIS-RSS更新超时")
        return False
    except Exception as e:
        print(f"[错误] LIS-RSS更新异常: {e}")
        import traceback
        traceback.print_exc()
        return False


# Memos 单条内容最大限制（按字节计算，Memos 服务端限制通常为 8192 字节）
MEMOS_MAX_CONTENT_BYTES = 6400


def _truncate_content_by_bytes(content: str, max_bytes: int = MEMOS_MAX_CONTENT_BYTES) -> str:
    """
    截断过长的内容，保留开头和结尾的关键信息。
    按字节长度（UTF-8）精确截断，确保最终内容不超过 max_bytes 字节。
    """
    if len(content.encode('utf-8')) <= max_bytes:
        return content

    marker = "\n\n...(截断)..."
    marker_bytes = marker.encode('utf-8')
    available_bytes = max_bytes - len(marker_bytes)

    if available_bytes <= 0:
        return marker

    # 按字节安全地截取前半部分
    raw_head = content.encode('utf-8')[:available_bytes * 3 // 4]
    head = raw_head.decode('utf-8', errors='ignore')

    # 如果头部内容极少，说明内容以 ASCII 为主，直接全用头部
    remaining = available_bytes - len(head.encode('utf-8'))
    if remaining < 20:
        # 不够尾部空间，直接截取到头
        head = content.encode('utf-8')[:available_bytes].decode('utf-8', errors='ignore')
        return head + marker

    # 从尾部安全截取
    tail_bytes_len = remaining
    raw_tail = content.encode('utf-8')[-tail_bytes_len:]
    tail = raw_tail.decode('utf-8', errors='ignore')

    # 再次微调：确保组合后不超标（decode 过程中可能因多字节字符边界导致实际长度变化）
    result = head + marker + tail
    result_bytes = result.encode('utf-8')
    if len(result_bytes) <= max_bytes:
        return result

    # 超标时，从尾部按比例缩减直到达标（二分法减半效率更高）
    while len(result_bytes) > max_bytes and len(tail) > 0:
        # 每次减少尾部的一半，快速逼近目标
        tail = tail[:len(tail) // 2]
        result = head + marker + tail
        result_bytes = result.encode('utf-8')

    return result


def _strip_diagram_section(content: str) -> str:
    """
    去掉内容中 '二、核心逻辑图谱'（含）到 '三、结构与逻辑精简' 之间的文本。
    仅 Memos 使用此精简逻辑，其他渠道保留完整内容。
    """
    start_marker = "二、核心逻辑图谱"
    end_marker = "三、结构与逻辑精简"

    start_idx = content.find(start_marker)
    if start_idx == -1:
        return content  # 未找到起始标记，不做处理

    end_idx = content.find(end_marker, start_idx)
    if end_idx == -1:
        # 找到了起始标记但未找到结束标记，只去掉起始标记之后的部分
        return content[:start_idx].rstrip()

    # 保留起始标记之前的内容 + 结束标记及之后的内容
    return content[:start_idx].rstrip() + "\n\n" + content[end_idx:]


async def upload_to_memos(title: str, md_content: str, config: Dict, enabled_override: Optional[bool] = None) -> bool:
    print(f"\n{'='*60}")
    print(f"  [子系统3/3] Memos上传")
    print(f"{'='*60}")

    summary_config = config.get('summary_upload', {}).get('memos', {})
    enabled = summary_config.get('enabled', True) if enabled_override is None else enabled_override
    if not enabled:
        print("[跳过] Memos上传已禁用")
        return True

    # 读取.env配置
    load_env()

    base_url = os.getenv("MEMOS_BASE_URL")
    access_token = os.getenv("MEMOS_ACCESS_TOKEN")

    if not base_url or not access_token:
        print("[错误] MEMOS_BASE_URL 或 MEMOS_ACCESS_TOKEN 未配置")
        return False

    # Memos 专用精简：去掉"二、核心逻辑图谱"到"三、结构与逻辑精简"之间的文本，节省空间
    stripped_content = _strip_diagram_section(md_content)
    if len(stripped_content) != len(md_content):
        stripped_len = len(md_content) - len(stripped_content)
        print(f"[信息] 已精简内容（去掉核心逻辑图谱章节），减少 {stripped_len} 字符")

    # 构建内容：标题 + 标签 + 内容（使用精简后的内容）
    content = f"#bot #AI速读\n\n**{title}**\n\n---\n\n{stripped_content}"

    # 按字节长度检查并截断（Memos 服务端限制为字节数）
    content_bytes = content.encode('utf-8')
    if len(content_bytes) > MEMOS_MAX_CONTENT_BYTES:
        print(f"[警告] 内容过长 ({len(content_bytes)} 字节)，已截断至 {MEMOS_MAX_CONTENT_BYTES} 字节")
        content = _truncate_content_by_bytes(content)

    try:
        print(f"[信息] 文章标题: {title}")
        print(f"[信息] 最终内容: {len(content)} 字符 / {len(content.encode('utf-8'))} 字节")

        from memos_client import MemosClient
        client = MemosClient(base_url, access_token)
        result = client.create_memo(content)

        memo_name = result.get('name', 'unknown')
        print(f"[成功] Memos上传完成")
        print(f"  Memo名称: {memo_name}")
        return True

    except ImportError as e:
        print(f"[错误] 导入MemosClient失败: {e}")
        return False
    except Exception as e:
        print(f"[错误] Memos上传异常: {e}")
        import traceback
        traceback.print_exc()
        return False


async def upload_to_blinko(title: str, md_content: str, config: Dict, enabled_override: Optional[bool] = None) -> bool:
    print(f"\n{'='*60}")
    print(f"  [子系统4/4] Blinko上传")
    print(f"{'='*60}")

    summary_config = config.get('summary_upload', {}).get('blinko', {})
    enabled = summary_config.get('enabled', True) if enabled_override is None else enabled_override
    if not enabled:
        print("[跳过] Blinko上传已禁用")
        return True

    # 读取.env配置
    load_env()

    try:
        print(f"[信息] 文章标题: {title}")
        print(f"[信息] 内容长度: {len(md_content)} 字符")

        from blinko_client import BlinkoClient
        client = BlinkoClient()

        content = f"#bot #AI速读\n\n**{title}**\n\n---\n\n{md_content}"

        result = client.notes.upsert(
            content=content,
            note_type=1,
            tags=["bot", "AI速读"]
        )

        note_id = result.get('id')
        print(f"[成功] Blinko上传完成")
        print(f"  笔记ID: {note_id}")
        return True

    except Exception as e:
        print(f"[错误] Blinko上传异常: {e}")
        import traceback
        traceback.print_exc()
        return False


async def upload_to_wechat(
    md_content: str,
    article_id: int,
    article_title: str,
    source_name: Optional[str],
    config: Dict
) -> bool:
    """
    推送到企业微信

    Args:
        md_content: MD文件内容
        article_id: 文章ID
        article_title: 文章标题
        source_name: 来源名称
        config: 配置字典

    Returns:
        是否成功
    """
    print(f"\n{'='*60}")
    print(f"  [子系统4/4] 企业微信推送")
    print(f"{'='*60}")

    # 检查模块是否可用
    if not WECHAT_AVAILABLE:
        print("[跳过] 企业微信模块不可用（需要安装 aiohttp）")
        return True

    wechat_config = config.get('summary_upload', {}).get('wechat', {})

    if not wechat_config.get('enabled', False):
        print("[跳过] 企业微信推送已禁用")
        return True

    # 从环境变量获取 webhook key 并组装完整 URL
    webhook_key = os.getenv('WECHAT_WEBHOOK_KEY')
    if not webhook_key:
        print("[错误] 未配置 WECHATCHAT_WEBHOOK_KEY 环境变量")
        return False

    webhook_url = f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={webhook_key}"

    timeout = wechat_config.get('timeout', 30)
    max_retries = wechat_config.get('max_retries', 2)

    try:
        print(f"[信息] Webhook URL: {webhook_url[:50]}...")
        print(f"[信息] 文章ID: {article_id}")
        print(f"[信息] 文章标题: {article_title[:50]}...")

        # 创建客户端
        client = WeChatClient(
            webhook_url=webhook_url,
            timeout=timeout,
            max_retries=max_retries
        )

        # 格式化消息
        formatter = MessageFormatter()
        message = formatter.format_paper_summary(
            title=article_title,
            summary=md_content,
            article_id=article_id,
            source_name=source_name
        )

        print(f"[信息] 消息大小: {len(message.encode('utf-8'))} 字节")

        # 发送消息
        success = await client.send_markdown(message)

        if success:
            print(f"[成功] 企业微信推送完成")
        else:
            print(f"[失败] 企业微信推送失败")

        return success

    except Exception as e:
        print(f"[错误] 企业微信推送异常: {e}")
        import traceback
        traceback.print_exc()
        return False


def _sync_upload_hiagent_rag(md_path: str, config: Dict, delete_md: bool, enabled_override: Optional[bool]) -> bool:
    """同步包装：HiAgent RAG 上传"""
    import asyncio as _aio
    return _aio.run(upload_to_hiagent_rag(md_path, config, delete_md=delete_md, enabled_override=enabled_override))


def _sync_upload_lis_rss(article_id: int, md_content: str, config: Dict) -> bool:
    """同步包装：LIS-RSS 上传"""
    import asyncio as _aio
    return _aio.run(upload_to_lis_rss(article_id, md_content, config))


def _sync_upload_memos(article_title: str, md_content: str, config: Dict, enabled_override: Optional[bool]) -> bool:
    """同步包装：Memos 上传"""
    import asyncio as _aio
    return _aio.run(upload_to_memos(article_title, md_content, config, enabled_override=enabled_override))


def _sync_upload_blinko(article_title: str, md_content: str, config: Dict, enabled_override: Optional[bool]) -> bool:
    """同步包装：Blinko 上传"""
    import asyncio as _aio
    return _aio.run(upload_to_blinko(article_title, md_content, config, enabled_override=enabled_override))


def _sync_upload_wechat(md_content: str, article_id: int, article_title: str, source_name: Optional[str], config: Dict) -> bool:
    """同步包装：企业微信推送"""
    import asyncio as _aio
    return _aio.run(upload_to_wechat(md_content, article_id, article_title, source_name, config))


async def upload_all(
    md_path: str,
    article_id: int,
    article_title: str,
    config: Dict,
    source_name: Optional[str] = None,
    skip_lis_rss: bool = False,
    skip_wechat: bool = False,
    push_hiagent: Optional[bool] = None,
    push_memos: Optional[bool] = None,
    push_blinko: Optional[bool] = None,
) -> Dict[str, bool]:
    print(f"\n{'='*60}")
    print(f"  并行上传到五个子系统")
    print(f"{'='*60}")
    print(f"[信息] MD文件: {md_path}")
    print(f"[信息] 文章ID: {article_id}")
    print(f"[信息] 文章标题: {article_title}")
    print(f"[信息] 来源: {source_name or '未知'}")

    md_file = Path(md_path)
    if not md_file.exists():
        print(f"[错误] MD文件不存在: {md_path}")
        return {
            'hiagent_rag': False,
            'lis_rss': False,
            'memos': False,
            'blinko': False,
            'wechat': False
        }

    md_content = md_file.read_text(encoding='utf-8')
    print(f"[信息] MD文件大小: {len(md_content)} 字符")

    summary_config = config.get('summary_upload', {}).get('hiagent_rag', {})
    delete_md = summary_config.get('delete_md', True)

    hiagent_cfg = config.get('summary_upload', {}).get('hiagent_rag', {}).get('enabled', True)
    skip_hiagent_rag = not (push_hiagent if push_hiagent is not None else hiagent_cfg)

    memos_cfg = config.get('summary_upload', {}).get('memos', {}).get('enabled', True)
    skip_memos = not (push_memos if push_memos is not None else memos_cfg)

    blinko_cfg = config.get('summary_upload', {}).get('blinko', {}).get('enabled', True)
    skip_blinko = not (push_blinko if push_blinko is not None else blinko_cfg)

    tasks = []

    if skip_hiagent_rag:
        print(f"[跳过] HiAgent RAG上传已禁用")
        tasks.append(asyncio.sleep(0))
    else:
        print(f"[信息] HiAgent RAG上传已启用")
        tasks.append(asyncio.to_thread(_sync_upload_hiagent_rag, md_path, config, delete_md, push_hiagent))

    if skip_lis_rss:
        print(f"[跳过] LIS-RSS上传已禁用（直接处理模式且未提供文章ID）")
        tasks.append(asyncio.sleep(0))
    else:
        print(f"[信息] LIS-RSS上传已启用")
        tasks.append(asyncio.to_thread(_sync_upload_lis_rss, article_id, md_content, config))

    if skip_memos:
        print(f"[跳过] Memos上传已禁用")
        tasks.append(asyncio.sleep(0))
    else:
        print(f"[信息] Memos上传已启用")
        tasks.append(asyncio.to_thread(_sync_upload_memos, article_title, md_content, config, push_memos))

    if skip_blinko:
        print(f"[跳过] Blinko上传已禁用")
        tasks.append(asyncio.sleep(0))
    else:
        print(f"[信息] Blinko上传已启用")
        tasks.append(asyncio.to_thread(_sync_upload_blinko, article_title, md_content, config, push_blinko))

    if skip_wechat:
        print(f"[跳过] WeChat推送已禁用")
        tasks.append(asyncio.sleep(0))
    else:
        print(f"[信息] WeChat推送已启用")
        tasks.append(asyncio.to_thread(_sync_upload_wechat, md_content, article_id, article_title, source_name, config))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    upload_results = {
        'hiagent_rag': results[0] if isinstance(results[0], bool) else False,
        'lis_rss': results[1] if isinstance(results[1], bool) else False,
        'memos': results[2] if isinstance(results[2], bool) else False,
        'blinko': results[3] if isinstance(results[3], bool) else False,
        'wechat': results[4] if isinstance(results[4], bool) else False
    }
    
    upload_results['_skipped'] = []
    if skip_hiagent_rag:
        upload_results['_skipped'].append('hiagent_rag')
    if skip_lis_rss:
        upload_results['_skipped'].append('lis_rss')
    if skip_memos:
        upload_results['_skipped'].append('memos')
    if skip_blinko:
        upload_results['_skipped'].append('blinko')
    if skip_wechat:
        upload_results['_skipped'].append('wechat')
    if not config.get('summary_upload', {}).get('wechat', {}).get('enabled', False):
        if 'wechat' not in upload_results['_skipped']:
            upload_results['_skipped'].append('wechat')

    # 处理异常
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"[错误] 子系统{i+1}执行异常: {result}")
            import traceback
            traceback.print_exception(type(result), result, result.__traceback__)

    # 输出汇总
    print(f"\n{'='*60}")
    print(f"  上传结果汇总")
    print(f"{'='*60}")
    print(f"  HiAgent RAG: {'✅ 成功' if upload_results['hiagent_rag'] else '❌ 失败'}")
    print(f"  LIS-RSS:     {'✅ 成功' if upload_results['lis_rss'] else '❌ 失败'}")
    print(f"  Memos:       {'✅ 成功' if upload_results['memos'] else '❌ 失败'}")
    print(f"  Blinko:      {'✅ 成功' if upload_results['blinko'] else '❌ 失败'}")
    print(f"  WeChat:      {'✅ 成功' if upload_results['wechat'] else '❌ 失败'}")
    print(f"{'='*60}")

    return upload_results


def sync_upload_all(md_path: str, article_id: int, article_title: str, config: Dict) -> Dict[str, bool]:
    """
    同步版本的上传（用于非异步环境）
    
    Args:
        md_path: MD文件路径
        article_id: 文章ID
        article_title: 文章标题
        config: 配置字典
        
    Returns:
        各子系统上传结果字典
    """
    return asyncio.run(upload_all(md_path, article_id, article_title, config))


def is_all_upload_failed(upload_results: Optional[Dict]) -> bool:
    """
    判断是否所有上传均失败（排除被跳过的子系统）

    Args:
        upload_results: upload_all() 或 upload_all_from_text() 返回的结果字典

    Returns:
        所有非跳过的子系统均失败时返回 True
    """
    if not upload_results:
        return True
    skipped = upload_results.get('_skipped', [])
    for key in ('hiagent_rag', 'lis_rss', 'memos', 'blinko', 'wechat'):
        if key not in skipped and upload_results.get(key, False):
            return False
    return True


async def upload_all_from_text(
    md_content: str,
    article_id: int,
    article_title: str,
    config: Dict,
    source_name: Optional[str] = None,
    skip_lis_rss: bool = False,
    skip_wechat: bool = False,
    push_hiagent: Optional[bool] = None,
    push_memos: Optional[bool] = None,
    push_blinko: Optional[bool] = None,
) -> Dict[str, bool]:
    import tempfile

    print(f"\n{'='*60}")
    print(f"  直接上传文本到五个子系统（无文件模式）")
    print(f"{'='*60}")
    print(f"[信息] 文章ID: {article_id}")
    print(f"[信息] 文章标题: {article_title}")
    print(f"[信息] 来源: {source_name or '未知'}")
    print(f"[信息] 文本大小: {len(md_content)} 字符")

    hiagent_cfg = config.get('summary_upload', {}).get('hiagent_rag', {}).get('enabled', True)
    skip_hiagent_rag = not (push_hiagent if push_hiagent is not None else hiagent_cfg)

    memos_cfg = config.get('summary_upload', {}).get('memos', {}).get('enabled', True)
    skip_memos = not (push_memos if push_memos is not None else memos_cfg)

    blinko_cfg = config.get('summary_upload', {}).get('blinko', {}).get('enabled', True)
    skip_blinko = not (push_blinko if push_blinko is not None else blinko_cfg)

    tmp_file_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.md', mode='w', encoding='utf-8', delete=False) as f:
            f.write(md_content)
            tmp_file_path = f.name

        tasks = []

        if skip_hiagent_rag:
            print(f"[跳过] HiAgent RAG上传已禁用")
            tasks.append(asyncio.sleep(0))
        else:
            print(f"[信息] HiAgent RAG上传已启用")
            tasks.append(asyncio.to_thread(_sync_upload_hiagent_rag, tmp_file_path, config, False, push_hiagent))

        if skip_lis_rss:
            tasks.append(asyncio.sleep(0))
        else:
            tasks.append(asyncio.to_thread(_sync_upload_lis_rss, article_id, md_content, config))

        if skip_memos:
            print(f"[跳过] Memos上传已禁用")
            tasks.append(asyncio.sleep(0))
        else:
            print(f"[信息] Memos上传已启用")
            tasks.append(asyncio.to_thread(_sync_upload_memos, article_title, md_content, config, push_memos))

        if skip_blinko:
            print(f"[跳过] Blinko上传已禁用")
            tasks.append(asyncio.sleep(0))
        else:
            print(f"[信息] Blinko上传已启用")
            tasks.append(asyncio.to_thread(_sync_upload_blinko, article_title, md_content, config, push_blinko))

        if skip_wechat:
            tasks.append(asyncio.sleep(0))
        else:
            tasks.append(asyncio.to_thread(_sync_upload_wechat, md_content, article_id, article_title, source_name, config))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        upload_results = {
            'hiagent_rag': results[0] if isinstance(results[0], bool) else False,
            'lis_rss': results[1] if isinstance(results[1], bool) else False,
            'memos': results[2] if isinstance(results[2], bool) else False,
            'blinko': results[3] if isinstance(results[3], bool) else False,
            'wechat': results[4] if isinstance(results[4], bool) else False
        }

        upload_results['_skipped'] = []
        if skip_hiagent_rag:
            upload_results['_skipped'].append('hiagent_rag')
        if skip_lis_rss:
            upload_results['_skipped'].append('lis_rss')
        if skip_memos:
            upload_results['_skipped'].append('memos')
        if skip_blinko:
            upload_results['_skipped'].append('blinko')
        if skip_wechat:
            upload_results['_skipped'].append('wechat')
        if not config.get('summary_upload', {}).get('wechat', {}).get('enabled', False):
            if 'wechat' not in upload_results['_skipped']:
                upload_results['_skipped'].append('wechat')

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                print(f"[错误] 子系统{i+1}执行异常: {result}")

        print(f"\n{'='*60}")
        print(f"  上传结果汇总")
        print(f"{'='*60}")
        print(f"  HiAgent RAG: {'✅ 成功' if upload_results['hiagent_rag'] else '❌ 失败'}")
        print(f"  LIS-RSS:     {'✅ 成功' if upload_results['lis_rss'] else '❌ 失败'}")
        print(f"  Memos:       {'✅ 成功' if upload_results['memos'] else '❌ 失败'}")
        print(f"  Blinko:      {'✅ 成功' if upload_results['blinko'] else '❌ 失败'}")
        print(f"  WeChat:      {'✅ 成功' if upload_results['wechat'] else '❌ 失败'}")
        print(f"{'='*60}")

        return upload_results
    finally:
        if tmp_file_path and Path(tmp_file_path).exists():
            Path(tmp_file_path).unlink()
            print(f"[清理] 临时文件已删除: {tmp_file_path}")


# 测试入口
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        md_path = sys.argv[1]
    else:
        md_path = "test.md"
    
    # 测试
    try:
        config = load_config()
        print(f"[OK] 配置加载成功")
        
        # 测试上传
        print(f"\n[测试] 上传文件: {md_path}")
        
    except Exception as e:
        print(f"[ERROR] {e}")
