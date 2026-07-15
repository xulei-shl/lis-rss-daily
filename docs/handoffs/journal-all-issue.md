# journal_all（全部期刊总结）生成失败 — 根因与优化建议

## 问题链路

```
LIS 应用 (OpenAI SDK, timeout=300s, maxRetries=1)
  → POST http://127.0.0.1:8800/v1/chat/completions
    → hiagent-gateway (Flask, requests timeout=300s)
      → create_conversation
      → chat_query (POST https://hiagent.library.sh.cn/api/proxy/api/v1/chat_query, ResponseMode=blocking)
        → HiAgent API 代理  ← 超时瓶颈在这里
          → DeepSeek / Doubao（实际耗时 ~113s / 33篇）
```

## 最终成功日志

```
13:37:35  DeepSeek (configId=19, priority=70) → 500 (Werkzeug/Flask)
          ↓ failover 到 Doubao
13:43:19  Doubao (configId=15, priority=75) → attempt=2 成功 ✅
13:43:19  Journal all summary generated (33篇)
13:43:19  Daily summary saved (id=348)
13:43:19  Pushed to Telegram + WeChat
```

## 根因

**hiagent.library.sh.cn 代理的 blocking 模式超时 < DeepSeek 处理耗时。**

- DeepSeek 处理 33 篇文章需要 ~113 秒
- hiagent 代理在 ~60-120 秒后返回 500（HTML 错误页）
- 网关收到 500 后传给 LIS，LIS 触发 failover
- Doubao 处理速度更快或在重试时上游已恢复，最终成功

不是网关代码问题，也不是 LIS 代码问题——是上游代理 **hiagent.library.sh.cn** 对 blocking 长请求的超时设得太短。

## 优化方案

### 方案一（推荐）：改 upstream 代理超时

联系 hiagent.library.sh.cn 的管理方，将 blocking 模式的超时阈值从当前值（推测 60-120s）提高到 **>180s**。这是最彻底的修复。

### 方案二：网关改为 streaming 模式

`/opt/hiagent-api/hiagent_openai_gateway.py` 中 `chat_query()` 的 `data["ResponseMode"]` 从 `"blocking"` 改为 `"streaming"`。代理对 SSE 长流通常有更长的超时阈值。

风险：需要验证 HiAgent API 的 streaming 响应格式，当前代码已有 SSE 解析逻辑（`is_streaming` 分支），但测试覆盖不足。

### 方案三：LIS 侧减少文章数

`/opt/lis-rss-daily/src/api/daily-summary-repository.ts:341` 的 `JOURNAL_ALL_LIMIT` 从 50 降到 20。输入 token 减少 → LLM 处理更快 → 降低超时概率。

### 方案四：LIS 侧调高 Doubao 优先级

`llm_configs` 表中 Doubao（configId=15）的 priority 从 75 调到 69（比 DeepSeek 的 70 高），让 Doubao 优先被选中。Doubao 处理速度更快，超时概率更低。

### 方案五：网关调大 retry 间隔

当前网关重试间隔 5s 太短，upstream 代理的超时状态不会这么快恢复。改为 15-30s，给上游更多缓冲时间。

## 改动汇总

| 文件 | 改动 | 状态 |
|------|------|------|
| `/opt/hiagent-api/hiagent_openai_gateway.py` | `requests.post()` 加 `timeout=300` | ✅ 已上线 |
| `/opt/hiagent-api/hiagent_openai_gateway.py` | `chat_completions` 加 5xx 重试 ×2，间隔 5s | ✅ 已上线 |
| `/opt/lis-rss-daily/scripts/trigger-journal-all-summary.sh` | 手动触发脚本 | ✅ 已创建 |