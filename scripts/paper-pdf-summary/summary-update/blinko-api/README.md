# Blinko API Client

Blinko 笔记平台的 Python API 客户端，支持 CLI 和编程调用。

## 功能

- 笔记 CRUD（创建、读取、更新、删除）
- 标签管理
- 文件管理
- 配置获取
- 模块化设计，便于扩展

## 安装

```bash
pip install requests python-dotenv
```

## 配置

在项目根目录或 `src/blinko_client/` 目录创建 `.env` 文件：

```env
BLINKO_BASE_URL=http://47.103.50.106:1111
BLINKO_API_KEY=your_api_key_here
```

API 密钥在 Blinko 设置页面生成。

## 使用方式

### CLI

```bash
# 创建笔记
python scripts/blinko_cli.py create "#inbox 今日计划"

# 列出笔记
python scripts/blinko_cli.py list --limit 20

# 获取笔记详情
python scripts/blinko_cli.py get 123

# 删除笔记
python scripts/blinko_cli.py delete 123

# 列出标签
python scripts/blinko_cli.py tag list
```

### Python

```python
from blinko_client import BlinkoClient

client = BlinkoClient()

# 创建笔记
result = client.notes.upsert(
    content="#tag 内容正文",
    note_type=0  # 0: flash, 1: normal, 2: daily
)

# 获取列表
notes = client.notes.list(page=1, size=10)

# 获取详情
note = client.notes.get_detail(123)

# 删除笔记
client.notes.delete(123)
```

## 项目结构

```
blinko-api/
├── src/blinko_client/
│   ├── __init__.py      # 统一入口
│   ├── base.py          # 基础客户端
│   ├── note.py          # 笔记模块
│   └── resource.py      # Tag/File/Config 模块
├── scripts/
│   └── blinko_cli.py    # CLI
└── .env                 # 配置文件
```

## License

MIT