# LLM JSON 解析工具使用指南

## 概述

`src/utils/llm-json-parser.ts` 提供了统一的工具函数来解析大模型返回的JSON响应，解决了以下常见问题：

- **响应被截断**：大模型返回的JSON可能因为长度限制被截断
- **Markdown代码块包裹**：大模型可能返回 ```json ... ``` 格式
- **不完整的JSON**：响应可能不完整导致解析失败
- **缺乏统一错误处理**：提供详细的错误信息和日志

## 主要功能

### 1. `parseLLMJSON<T>()` - 解析LLM JSON响应

这是主要的解析函数，提供完整的错误处理和日志记录。

```typescript
import { parseLLMJSON } from './utils/llm-json-parser.js';

interface MyResponseType {
  field1: string;
  field2: number;
}

const result = parseLLMJSON<MyResponseType>(llmResponse, {
  allowPartial: true,        // 允许部分解析（修复不完整的JSON）
  maxResponseLength: 2048,   // 最大响应长度（用于检测截断）
  errorPrefix: 'MyOperation' // 错误消息前缀
});

if (result.success) {
  console.log('解析成功:', result.data);
  console.log('是否使用了部分解析:', result.usedPartialParse);
} else {
  console.error('解析失败:', result.error);
  console.log('原始响应:', result.rawResponse);
  console.log('清理后的JSON:', result.cleanedJson);
}
```

### 2. `safeParseLLMJSON<T>()` - 安全解析（带默认值）

当解析失败时返回默认值，而不是抛出错误。

```typescript
import { safeParseLLMJSON } from './utils/llm-json-parser.js';

const defaultData = { field1: 'default', field2: 0 };
const data = safeParseLLMJSON<MyResponseType>(llmResponse, defaultData, {
  allowPartial: true
});
```

### 3. `validateJSONStructure()` - 验证JSON结构

验证解析后的数据是否包含必需的字段。

```typescript
import { validateJSONStructure } from './utils/llm-json-parser.js';

const validation = validateJSONStructure(data, ['field1', 'field2']);

if (!validation.valid) {
  console.error('缺少字段:', validation.missingFields);
}
```

## 使用示例

### 示例1：在 filter.ts 中使用

```typescript
import { parseLLMJSON } from './utils/llm-json-parser.js';

// 调用大模型
const response = await llm.chat(messages, {
  jsonMode: true,
  temperature: 0.3,
  label: 'article-filter',
  maxTokens: 2048,
});

// 解析响应
const parseResult = parseLLMJSON<LLMResponse>(response, {
  allowPartial: true,
  maxResponseLength: 2048,
  errorPrefix: 'Filter evaluation',
});

if (!parseResult.success) {
  log.warn(
    { error: parseResult.error, rawResponse: response },
    'LLM JSON parse failed'
  );
  return { results: new Map(), error: parseResult.error };
}

// 使用解析后的数据
const parsed = parseResult.data!;
for (const evaluation of parsed.evaluations) {
  // 处理评估结果
}
```

### 示例2：在 agent.ts 中使用

```typescript
import { parseLLMJSON } from './utils/llm-json-parser.js';

const text = await llm.chat(messages, {
  maxTokens: 1024,
  jsonMode: true,
  label: 'translation',
});

const parseResult = parseLLMJSON<{ title_zh?: string; summary_zh?: string }>(text, {
  allowPartial: true,
  maxResponseLength: 1024,
  errorPrefix: 'Translation',
});

if (!parseResult.success) {
  log.warn({ error: parseResult.error }, 'Translation JSON parse failed');
  return { usedFallback: true };
}

const parsed = parseResult.data!;
const titleZh = parsed.title_zh;
const summaryZh = parsed.summary_zh;
```

## 解析选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `allowPartial` | boolean | false | 是否允许部分解析（修复不完整的JSON） |
| `maxResponseLength` | number | 2048 | 最大响应长度（用于检测截断） |
| `errorPrefix` | string | 'JSON解析' | 错误消息前缀 |

## 解析结果

`ParseResult<T>` 接口包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 解析是否成功 |
| `data` | T \| undefined | 解析后的数据（成功时） |
| `error` | string \| undefined | 错误信息（失败时） |
| `rawResponse` | string | 原始响应文本 |
| `cleanedJson` | string \| undefined | 清理后的JSON文本 |
| `usedPartialParse` | boolean \| undefined | 是否使用了部分解析 |

## 自动处理的问题

### 1. Markdown代码块包裹

工具会自动提取 ```json ... ``` 中的JSON内容：

```json
```json
{
  "field": "value"
}
```
```

### 2. 响应截断

当响应长度超过 `maxResponseLength` 时，会记录警告日志。

### 3. 不完整的JSON

当 `allowPartial: true` 时，工具会尝试修复：
- 缺失的闭合括号 `}`
- 缺失的闭合方括号 `]`
- 尾随逗号 `,`

### 4. JSON格式错误

提供详细的错误信息，包括：
- 错误消息
- 响应长度
- JSON预览（前500字符）
- 是否被截断

## 日志记录

工具会自动记录以下日志：

- **成功解析**：debug级别，包含JSON长度和响应长度
- **部分解析**：warn级别，包含原始错误和部分数据
- **解析失败**：warn级别，包含详细错误信息和上下文
- **响应截断**：warn级别，包含响应长度和预览

## 最佳实践

1. **始终使用类型参数**：`parseLLMJSON<MyType>(response)`
2. **设置合理的最大长度**：根据你的maxTokens设置
3. **启用部分解析**：对于可能被截断的响应
4. **检查解析结果**：始终检查 `result.success`
5. **记录错误**：使用日志记录解析失败的情况
6. **提供有意义的错误前缀**：便于调试和追踪

## 迁移指南

### 从 `JSON.parse()` 迁移

**之前：**
```typescript
try {
  const parsed = JSON.parse(response) as MyType;
  // 使用 parsed
} catch (error) {
  console.error('解析失败:', error);
}
```

**之后：**
```typescript
const result = parseLLMJSON<MyType>(response, {
  allowPartial: true,
  errorPrefix: 'MyOperation'
});

if (result.success) {
  const parsed = result.data!;
  // 使用 parsed
} else {
  console.error('解析失败:', result.error);
}
```

## 相关文件

- `src/utils/llm-json-parser.ts` - JSON解析工具实现
- `src/filter.ts` - 文章过滤模块（使用示例）
- `src/agent.ts` - 翻译代理模块（使用示例）
