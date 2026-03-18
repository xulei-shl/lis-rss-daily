#!/usr/bin/env python3
import sys
sys.path.insert(0, '.')
from utils.summary_uploader import sync_upload_all
from utils.database import update_ai_summary
import yaml
from pathlib import Path

config = yaml.safe_load(open('config/config.yaml', 'r', encoding='utf-8'))
md_path = 'download/2026-03-18/面向学术评价的成果数据分析智能体构建研究_邓启平.md'
article_id = 2128
article_title = '面向学术评价的成果数据分析智能体构建研究'

print('='*60)
print('  断点续传')
print('='*60)
print(f'MD: {md_path}')
print(f'ID: {article_id}')
print(f'Title: {article_title}')

print('\n' + '='*60)
print('  步骤1: 并行上传到三个子系统')
print('='*60)
results = sync_upload_all(md_path, article_id, article_title, config)
print(f'上传结果: {results}')

print('\n' + '='*60)
print('  步骤2: 更新数据库')
print('='*60)
md_content = Path(md_path).read_text(encoding='utf-8')
if update_ai_summary(article_id, md_content, config['database']['path']):
    print('[成功] 数据库更新成功')
else:
    print('[失败] 数据库更新失败')

print('\n' + '='*60)
print('  完成')
print('='*60)
