#!/usr/bin/env python3
"""
论文PDF摘要工作流 - 主入口

功能：
1. 从数据库获取待处理数据
2. 下载PDF
3. 验证PDF文件名匹配
4. 生成PDF总结（MD）
5. 并行上传到三个子系统
6. 生成每日处理报告
"""

import re
import sys
import os
import asyncio
import argparse
import json
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# 添加项目根目录到Python路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# 导入工具模块
from utils.database import (
    load_journals_list,
    fetch_pending_articles,
    get_source_name,
    get_connection
)
from utils.pdf_downloader import load_config, create_download_directory, download_pdf
from utils.pdf_validator import validate_and_cleanup, get_pdf_info
from utils.pdf_summarizer import summarize_pdf
from utils.summary_uploader import upload_all as parallel_upload, load_env, get_env_bool
from utils.logger import DailyLogger
import yaml


def load_workflow_config(config_path: str = "config/config.yaml") -> Dict:
    """
    加载工作流配置
    
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


def print_section(title: str):
    """打印分节标题"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


def print_article_info(article: Dict):
    """打印文章基本信息"""
    print(f"\n[文章信息]")
    print(f"  ID: {article.get('id')}")
    print(f"  标题: {article.get('title', '')[:50]}...")
    print(f"  来源: {article.get('source_name', '未知')}")


def process_direct_article(title: str, article_id: Optional[int], config: Dict, logger: DailyLogger, today: str, skip_wechat: bool = False, stop_after_summary: bool = False) -> Optional[Dict]:
    """
    直接处理指定的文章（跳过数据库查询）

    Args:
        title: 论文题名（PDF下载检索词）
        article_id: 文章ID（可选），如果未提供则跳过LIS-RSS上传
        config: 配置字典
        logger: 日志记录器
        today: 当日日期字符串
        skip_wechat: 是否跳过企业微信推送
        stop_after_summary: 步骤3成功后立即返回，不执行步骤4

    Returns:
        如果 stop_after_summary=True，返回包含md_content等信息的字典；否则返回None
    """
    # 创建当日工作目录
    download_root = config['storage']['download_root']
    daily_dir = create_download_directory(download_root, today)
    print(f"  工作目录: {daily_dir}")

    # 构造文章数据
    article = {
        'id': article_id if article_id else 0,
        'title': title,
        'source_name': '手动指定'
    }

    # 决定是否跳过LIS-RSS上传
    skip_lis_rss = article_id is None

    print(f"\n{'#'*60}")
    print(f"# 处理直接指定的文章")
    print('#'*60)

    # 如果只需要步骤3，立即执行并返回
    if stop_after_summary:
        return process_article_summary_only(article, config, daily_dir, skip_wechat)

    result = process_article(article, config, daily_dir, logger, skip_lis_rss=skip_lis_rss, skip_wechat=skip_wechat)

    if result['success']:
        print(f"\n[进度] 成功: 1, 失败: 0")
    else:
        print(f"\n[进度] 成功: 0, 失败: 1")

    # 生成最终报告
    print_section("生成每日报告")
    report_path = logger.generate_report()

    # 输出摘要
    print(f"\n{'='*60}")
    print(f"  处理完成")
    print('='*60)
    print(f"  成功: {1 if result['success'] else 0}")
    print(f"  失败: {1 if not result['success'] else 0}")
    print(f"  报告: {report_path}")
    print('='*60)


def process_article_summary_only(article: Dict, config: Dict, daily_dir: Path, skip_wechat: bool = False) -> Dict:
    """
    仅执行步骤1-3，返回MD内容用于立即推送

    Args:
        article: 文章数据
        config: 配置字典
        daily_dir: 当日工作目录
        skip_wechat: 是否跳过企业微信推送

    Returns:
        包含 md_path, md_content, article_id, title 等信息的字典
    """
    article_id = article['id']
    title = article['title']

    print_article_info(article)

    result = {
        'article_id': article_id,
        'title': title,
        'success': False,
        'md_path': None,
        'md_content': None,
        'skip_wechat': skip_wechat,
        'stages': {}
    }

    # ===== 步骤1: PDF下载 =====
    print_section("步骤1: PDF下载")

    pdf_path = download_pdf(
        title=title,
        output_dir=str(daily_dir),
        config=config
    )

    if not pdf_path:
        reason = "PDF下载失败（所有脚本均失败）"
        print(f"[失败] {reason}")
        result['reason'] = reason
        return result

    result['stages']['pdf_download'] = 'success'
    print(f"[成功] PDF已下载: {pdf_path}")

    # ===== 步骤2: 验证PDF文件名匹配 =====
    print_section("步骤2: 验证PDF文件名匹配")

    threshold = config.get('pdf_download', {}).get('match_threshold', 0)
    matched, match_reason = validate_and_cleanup(
        pdf_path=pdf_path,
        original_title=title,
        threshold=threshold,
        delete_on_mismatch=True
    )

    if not matched:
        reason = f"PDF文件名不匹配: {match_reason}"
        print(f"[失败] {reason}")
        result['stages']['pdf_validate'] = 'failed'
        result['reason'] = reason
        return result

    result['stages']['pdf_validate'] = 'success'
    print(f"[成功] PDF验证通过")

    # ===== 步骤3: PDF总结 =====
    print_section("步骤3: PDF总结")

    md_path = summarize_pdf(pdf_path, config)

    if not md_path:
        reason = "PDF总结失败"
        print(f"[失败] {reason}")
        result['stages']['pdf_summary'] = 'failed'
        result['reason'] = reason
        return result

    md_content = ""
    if Path(md_path).exists():
        md_content = Path(md_path).read_text(encoding='utf-8')

    error_patterns = [
        r'无法完成',
        r'无法正常',
        r'No /Root object',
        r'Is this really a PDF',
        r'文件链接无法正常访问',
        r'文件格式异常',
        r'链接无效',
        r'格式异常',
        r'PDF.*?异常',
        r'处理失败',
        r'调用失败',
        r'抱歉.*?无法.*?',
        r'对不起.*?无法.*?',
        r'请求异常',
        r'稍后重试',
        r'请稍后重试'
    ]
    has_error = any(re.search(p, md_content, re.IGNORECASE) for p in error_patterns)
    if has_error:
        reason = "PDF总结失败（生成的摘要包含错误信息，可能是PDF损坏或无法读取）"
        print(f"[失败] {reason}")
        print(f"[删除] 删除无效MD文件: {md_path}")
        Path(md_path).unlink(missing_ok=True)
        result['stages']['pdf_summary'] = 'failed'
        result['reason'] = reason
        return result

    result['stages']['pdf_summary'] = 'success'
    result['md_path'] = str(md_path)
    print(f"[成功] MD文件已生成: {md_path}")

    result['md_content'] = md_content
    result['success'] = True

    print(f"[完成] 步骤3成功，MD内容已准备好（{len(md_content)} 字符）")
    print(f"[提示] 步骤4上传将在后台继续执行...")

    return result


def _is_all_upload_failed(upload_results: Optional[Dict]) -> bool:
    """
    判断并行上传是否全部失败
    
    个别并行任务失败无所谓，但如果全部任务都失败则返回True
    注意：被跳过的任务不计入失败判断
    
    Args:
        upload_results: 上传结果字典，包含 hiagent_rag, lis_rss, memos, wechat 的布尔值，
                       以及 _skipped 列表记录被跳过的子系统
        
    Returns:
        如果全部实际执行的任务都失败，返回True；否则返回False
    """
    if not upload_results:
        return True
    
    # 获取被跳过的子系统列表
    skipped = upload_results.get('_skipped', [])
    
    # 统计实际执行的任务中成功的数量
    success_count = 0
    
    # HiAgent RAG - 总是执行
    if 'hiagent_rag' not in skipped and upload_results.get('hiagent_rag', False):
        success_count += 1
    
    # LIS-RSS
    if 'lis_rss' not in skipped and upload_results.get('lis_rss', False):
        success_count += 1
    
    # Memos - 总是执行
    if 'memos' not in skipped and upload_results.get('memos', False):
        success_count += 1
    
    # WeChat
    if 'wechat' not in skipped and upload_results.get('wechat', False):
        success_count += 1
    
    # 如果没有任何任务成功，才算全部失败
    return success_count == 0


def notify_main_app_pdf_summary(
    article_id: int,
    title: str,
    source_name: Optional[str],
    summary: str
) -> bool:
    """
    调用主项目统一推送接口发送 PDF 总结通知

    说明：
    - 历史上脚本侧只负责企业微信推送，因此沿用 skip_wechat 参数控制“是否跳过通知”
    - 现在实际发送由主项目统一负责，包括 Telegram 和企业微信
    """
    load_env()

    cli_api_key = os.getenv('CLI_API_KEY')
    if not cli_api_key:
        print("[跳过] 未配置 CLI_API_KEY，无法调用主项目统一推送接口")
        return False

    user_id = (
        os.getenv('PDF_SUMMARY_NOTIFY_USER_ID')
        or os.getenv('DAILY_SUMMARY_USER_ID')
        or os.getenv('USER_ID')
        or '1'
    )
    base_url = (
        os.getenv('BASE_URL')
        or os.getenv('LIS_RSS_API_URL')
        or 'http://localhost:8007'
    ).rstrip('/')

    url = (
        f"{base_url}/api/pdf-summary/notify/cli?"
        f"{urllib.parse.urlencode({'user_id': user_id})}"
    )
    payload = {
        'articleId': article_id if article_id > 0 else None,
        'title': title,
        'sourceName': source_name or '未知',
        'summary': summary,
        'success': True
    }

    try:
        data = json.dumps(payload).encode('utf-8')
        request = urllib.request.Request(
            url,
            data=data,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': cli_api_key
            },
            method='POST'
        )

        print_section("步骤5: 调用主项目统一推送")
        print(f"[信息] 接口地址: {base_url}/api/pdf-summary/notify/cli")
        print(f"[信息] 用户ID: {user_id}")
        print(f"[信息] 文章ID: {article_id}")

        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode('utf-8')
            result = json.loads(body)

        notified = bool(result.get('notified'))
        telegram = bool(result.get('telegram'))
        wechat = bool(result.get('wechat'))

        print(f"[结果] 主项目推送结果: telegram={telegram}, wechat={wechat}, notified={notified}")
        return notified
    except Exception as e:
        print(f"[错误] 调用主项目统一推送失败: {e}")
        return False


def process_article(article: Dict, config: Dict, daily_dir: Path, logger: DailyLogger, skip_lis_rss: bool = False, skip_wechat: bool = False) -> Dict:
    """
    处理单篇文章
    
    处理流程：
    1. 下载PDF（按优先级尝试多个脚本）
    2. 验证PDF文件名匹配
    3. 生成PDF总结（MD）
    4. 并行上传到三个子系统（包含LIS-RSS数据库更新，可跳过）
    5. 调用主项目统一推送渠道发送 PDF 总结通知
    
    Args:
        article: 文章数据
        config: 配置字典
        daily_dir: 当日工作目录
        logger: 日志记录器
        
    Returns:
        处理结果字典
    """
    article_id = article['id']
    title = article['title']
    push_wechat_via_webhook = get_env_bool('PDF_SUMMARY_PUSH_WECHAT', False)
    
    print_article_info(article)
    
    result = {
        'article_id': article_id,
        'title': title,
        'success': False,
        'stages': {}
    }
    
    # ===== 步骤1: PDF下载 =====
    print_section("步骤1: PDF下载")
    
    pdf_path = download_pdf(
        title=title,
        output_dir=str(daily_dir),
        config=config
    )
    
    if not pdf_path:
        reason = "PDF下载失败（所有脚本均失败）"
        print(f"[失败] {reason}")
        logger.log_failure(article, reason)
        result['reason'] = reason
        return result
    
    result['stages']['pdf_download'] = 'success'
    print(f"[成功] PDF已下载: {pdf_path}")
    
    # ===== 步骤2: 验证PDF文件名匹配 =====
    print_section("步骤2: 验证PDF文件名匹配")
    
    threshold = config.get('pdf_download', {}).get('match_threshold', 0)
    matched, match_reason = validate_and_cleanup(
        pdf_path=pdf_path,
        original_title=title,
        threshold=threshold,
        delete_on_mismatch=True
    )
    
    if not matched:
        reason = f"PDF文件名不匹配: {match_reason}"
        print(f"[失败] {reason}")
        logger.log_failure(article, reason)
        result['stages']['pdf_validate'] = 'failed'
        result['reason'] = reason
        return result
    
    result['stages']['pdf_validate'] = 'success'
    print(f"[成功] PDF验证通过")
    
    # ===== 步骤3: PDF总结 =====
    print_section("步骤3: PDF总结")
    
    md_path = summarize_pdf(pdf_path, config)
    
    if not md_path:
        reason = "PDF总结失败"
        print(f"[失败] {reason}")
        logger.log_failure(article, reason)
        result['stages']['pdf_summary'] = 'failed'
        result['reason'] = reason
        return result
    
    md_content = ""
    if Path(md_path).exists():
        md_content = Path(md_path).read_text(encoding='utf-8')
    
    error_patterns = [
        r'无法完成',
        r'无法正常',
        r'No /Root object',
        r'Is this really a PDF',
        r'文件链接无法正常访问',
        r'文件格式异常',
        r'链接无效',
        r'格式异常',
        r'PDF.*?异常',
        r'处理失败',
        r'调用失败',
        r'抱歉.*?无法.*?',
        r'对不起.*?无法.*?',
        r'请求异常',
        r'稍后重试',
        r'请稍后重试'
    ]
    has_error = any(re.search(p, md_content, re.IGNORECASE) for p in error_patterns)
    if has_error:
        reason = "PDF总结失败（生成的摘要包含错误信息，可能是PDF损坏或无法读取）"
        print(f"[失败] {reason}")
        print(f"[删除] 删除无效MD文件: {md_path}")
        Path(md_path).unlink(missing_ok=True)
        logger.log_failure(article, reason)
        result['stages']['pdf_summary'] = 'failed'
        result['reason'] = reason
        return result
    
    result['stages']['pdf_summary'] = 'success'
    result['md_path'] = md_path
    print(f"[成功] MD文件已生成: {md_path}")
    
    # ===== 步骤4: 并行上传 =====
    print_section("步骤4: 并行上传到三个子系统")

    try:
        source_name = article.get('source_name')
        upload_results = asyncio.run(parallel_upload(
            md_path=md_path,
            article_id=article_id,
            article_title=title,
            source_name=source_name,
            config=config,
            skip_lis_rss=skip_lis_rss,
            skip_wechat=not push_wechat_via_webhook
        ))
        
        result['stages']['upload'] = upload_results
        print(f"[结果] 上传结果: {upload_results}")
        
    except Exception as e:
        reason = f"上传过程异常: {e}"
        print(f"[失败] {reason}")
        logger.log_failure(article, reason)
        result['stages']['upload'] = {'error': str(e)}
        result['reason'] = reason
        return result

    if skip_wechat:
        result['stages']['notify'] = 'skipped'
        print("[跳过] 已按参数跳过统一推送通知")
    elif _is_all_upload_failed(upload_results):
        result['stages']['notify'] = 'skipped'
        print("[跳过] 所有上传任务均失败，跳过统一推送通知")
    else:
        notify_success = notify_main_app_pdf_summary(
            article_id=article_id,
            title=title,
            source_name=source_name,
            summary=md_content
        )
        result['stages']['notify'] = 'success' if notify_success else 'failed'

    # ===== 完成 =====
    result['success'] = True
    print_section("处理完成")
    logger.log_success(article)
    
    return result


def main():
    """主入口函数"""
    # 解析命令行参数
    parser = argparse.ArgumentParser(description='论文PDF摘要工作流')
    parser.add_argument('--title', help='论文题名（PDF下载检索词）')
    parser.add_argument('--id', type=int, help='文章ID（可选，跳过LIS-RSS上传如果未提供）')
    parser.add_argument('--skip-wechat', action='store_true', help='跳过企业微信推送')
    parser.add_argument('--stop-after-summary', action='store_true', help='步骤3成功后立即返回，不执行步骤4上传')
    args = parser.parse_args()

    print_section("论文PDF摘要工作流启动")

    # 加载配置
    print("[加载配置...]")
    config = load_workflow_config()
    print(f"  数据库: {config['database']['path']}")
    print(f"  每日处理限制: {config['daily_process_limit']}")

    # 获取当日日期
    today = datetime.now().strftime("%Y-%m-%d")
    print(f"  处理日期: {today}")

    # 初始化日志
    logs_root = config['storage']['logs_root']
    logger = DailyLogger(today, logs_root)
    print(f"  日志文件: {logger.log_file}")

    # 直接处理模式
    if args.title:
        print(f"\n[模式] 直接处理模式")
        print(f"  题名: {args.title}")
        print(f"  文章ID: {args.id if args.id else '未提供（将跳过LIS-RSS上传）'}")
        print(f"  跳过微信: {'是' if args.skip_wechat else '否'}")
        print(f"  立即返回（步骤3后）: {'是' if args.stop_after_summary else '否'}")
        
        summary_result = process_direct_article(
            args.title, args.id, config, logger, today,
            skip_wechat=args.skip_wechat,
            stop_after_summary=args.stop_after_summary
        )
        
        # 如果是 stop_after_summary 模式，步骤3成功后立即返回
        if args.stop_after_summary and summary_result:
            if summary_result.get('success'):
                md_path = summary_result.get('md_path')
                if md_path:
                    md_path = str(Path(md_path).resolve())
                print("\n" + "="*60)
                print(f"SUMMARY_SUCCESS|{md_path}|{summary_result.get('article_id')}|{summary_result.get('title')}")
                print("="*60)
            return

        return

    # 加载期刊白名单
    journals_path = config['data_sources']['journals_list']
    journals = load_journals_list(journals_path)
    print(f"  期刊白名单: {len(journals)}个")
    
    # 获取待处理数据
    print_section("获取待处理数据")
    
    db_path = config['database']['path']
    limit = config['daily_process_limit']
    
    # 创建当日工作目录
    download_root = config['storage']['download_root']
    daily_dir = create_download_directory(download_root, today)
    print(f"  工作目录: {daily_dir}")
    
    # 获取数据库连接（用于获取来源名称）
    conn = get_connection(db_path)
    
    # 逐条处理 - 失败不计数，必须全部流程走完才算一条
    print_section("开始处理数据")
    
    success_count = 0
    failure_count = 0
    processed_article_ids = set()  # 记录已处理的文章ID，避免重复处理
    
    while success_count < limit:
        # 每次获取一条数据
        articles = fetch_pending_articles(
            db_path=db_path,
            journals=journals,
            limit=1,  # 每次只获取一条
            use_priority=True
        )
        
        if not articles:
            print("[信息] 没有更多待处理的数据")
            break
        
        # 跳过已处理的文章
        article = articles[0]
        article_id = article.get('id')
        if article_id in processed_article_ids:
            print(f"[跳过] 文章ID {article_id} 已处理过，跳过")
            continue
        
        # 获取来源名称
        article['source_name'] = get_source_name(article, conn)
        
        print(f"\n{'#'*60}")
        print(f"# 处理第 {success_count + failure_count + 1} 条 (成功: {success_count}, 失败: {failure_count})")
        print('#'*60)
        
        result = process_article(article, config, daily_dir, logger)
        
        # 判断是否为成功：必须 PDF下载成功 + 总结成功 + 并行上传不是全部失败
        is_fully_successful = (
            result.get('stages', {}).get('pdf_download') == 'success' and
            result.get('stages', {}).get('pdf_summary') == 'success' and
            not _is_all_upload_failed(result.get('stages', {}).get('upload'))
        )
        
        if is_fully_successful:
            success_count += 1
            processed_article_ids.add(article_id)
            print(f"\n[进度] 成功: {success_count}, 失败: {failure_count} (此条成功计入)")
        else:
            failure_count += 1
            print(f"\n[进度] 成功: {success_count}, 失败: {failure_count} (此条失败不计入，继续处理)")
        
        # 检查是否达到每日处理上限
        if success_count >= limit:
            print(f"\n[信息] 已达到每日处理上限 ({limit})，停止处理")
            break
    
    conn.close()
    
    # 生成最终报告
    print_section("生成每日报告")
    report_path = logger.generate_report()
    
    # 输出摘要
    print(f"\n{'='*60}")
    print(f"  处理完成")
    print('='*60)
    print(f"  成功: {success_count}")
    print(f"  失败: {failure_count}")
    print(f"  报告: {report_path}")
    print('='*60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[中断] 用户取消执行")
        sys.exit(1)
    except Exception as e:
        print(f"\n[错误] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
