# 修复 hiagent gateway 的 system prompt 传递问题

## Context

lis-rss-daily 项目中文章总结功能调用 OpenAI API 时，将文章列表嵌入到 **system prompt** 中：

```typescript
const summary = await llm.chat(
  [
    { role: 'system', content: promptTemplate },  // 文章列表在这里
    { role: 'user', content: `请生成 ${today} 的当日总结。` },
  ],
  { temperature: 0.3 }
);
```

但当前 hiagent-api 实现（`/opt/hiagent-api/hiagent_openai_gateway.py`）只取最后一条消息，导致 system prompt 被丢弃，文章内容无法传递给 HiAgent API。

## 问题根源

**当前代码（第174-179行）**：
```python
messages = data.get('messages', [])
query = messages[-1].get('content', '')  # 只取最后一条
```

这导致：
- system prompt 完全丢失
- 文章列表没有被发送给 HiAgent
- HiAgent 返回"没有传递文章内容"的错误

## 解决方案

### 修改文件：`/opt/hiagent-api/hiagent_openai_gateway.py`

**修改 `chat_completions()` 函数中的 messages 处理逻辑**：

将第174-179行替换为：

```python
# 提取并拼接所有消息
messages = data.get('messages', [])
if not messages:
    return jsonify({"error": "messages required"}), 400

# 构建 query：将所有 messages 拼接为一个完整字符串
query_parts = []
for msg in messages:
    role = msg.get('role', 'user')
    content = msg.get('content', '')
    if content:
        # 添加角色前缀以区分不同类型的消息
        if role == 'system':
            query_parts.append(f"[System]\n{content}")
        elif role == 'user':
            query_parts.append(f"[User]\n{content}")
        elif role == 'assistant':
            query_parts.append(f"[Assistant]\n{content}")
        else:
            query_parts.append(f"[{role}]\n{content}")

query = '\n\n'.join(query_parts)
if not query:
    return jsonify({"error": "No message content"}), 400
```

## 验证方法

### 1. 启动 hiagent gateway
```bash
cd /opt/hiagent-api
python hiagent_openai_gateway.py
```

### 2. 运行测试脚本
创建测试脚本 `/opt/hiagent-api/test_summary.py`：

```python
import requests
import json

API_URL = "http://127.0.0.1:8800/v1/chat/completions"
API_KEY = "sk-xulei0527"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

data = {
    "model": "hiagent-chat",
    "messages": [
        {
            "role": "system",
            "content": """你是专业的内容总结助手，请根据以下文章列表生成当日总结。

## 文章列表：
1. **深度学习在图像识别中的应用**
   来源：深度学习期刊
   预览：本文介绍了卷积神经网络在图像识别领域的最新进展...

2. **自然语言处理的发展趋势**
   来源：AI 通讯
   预览：本文探讨了大语言模型在自然语言处理中的应用前景...

## 输出要求：
生成 500-800 字的中文总结，突出核心观点。
"""
        },
        {
            "role": "user",
            "content": "请生成今日的 AI 领域文章总结。"
        }
    ],
    "temperature": 0.3
}

response = requests.post(API_URL, headers=headers, json=data)
print("Status:", response.status_code)
print("Response:", json.dumps(response.json(), ensure_ascii=False, indent=2))
```

### 3. 预期结果
- Status: 200
- Response 包含基于文章列表的总结内容
- 不再返回"没有传递文章内容"的错误

### 4. 端到端测试
在 lis-rss-daily 项目中配置使用 hiagent gateway：
1. 在数据库 llm_configs 表中添加配置
2. 设置 baseURL 为 `http://127.0.0.1:8800`
3. 触发每日总结任务
4. 验证总结结果是否包含文章内容
