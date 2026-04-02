# 提示词调用修复与编译产物清理问题总结

## 背景

本次排查起因是 `src/api/daily-summary.ts` 的每日总结调用失败。期望逻辑是：

1. 按任务类型从 `system_prompts` 表中读取模板
2. 用运行时变量渲染模板
3. 将渲染后的完整提示词作为最终用户提示词发送给 LLM

`src/filter.ts` 已经实现了这套逻辑，但每日总结、洞察、翻译并没有完全保持一致。

## 排查中发现的主要问题

## 1. 各类 LLM 调用的提示词组装逻辑不一致

- `filter.ts`
  - 逻辑正确
  - 从 DB 读取模板并渲染后，直接作为完整 `user` 提示词发送
- `daily-summary.ts`
  - 原逻辑错误
  - 将 DB 中的 `daily_summary` 模板放进 `system` 消息
  - 又在代码里额外硬编码了一份 `user` 提示词
  - 导致文章列表和指令重复，容易冲突
- `agent.ts` 中的 `translation`
  - 原逻辑与 `filter.ts` 不一致
  - DB 模板放在 `system`
  - 业务代码另拼接一份 `user` 提示词
- `daily-summary.ts` 中的 `insights`
  - 原逻辑也与 `filter.ts` 不一致
  - DB 模板放在 `system`
  - `user` 只传一条简短指令

## 2. 共享模块只做了“半统一”

当前项目虽然已经有一些共享基础模块：

- `src/api/system-prompts.ts`
- `src/api/prompt-variable-builder.ts`
- `src/llm.ts`

但这些模块只统一了：

- 按类型读取模板
- 模板变量渲染
- 按任务类型选择 LLM 配置

没有统一“最终消息如何组装并发送”的约定，导致各个业务模块各写各的，最终出现调用方式不一致。

## 3. `resolveSystemPrompt` 的 fallback 行为不完整

原实现中：

- 如果 DB 中没有可用模板，会直接返回原始 `fallback`
- 但 `fallback` 本身可能包含 `{{ARTICLE_TITLE}}`、`{{ARTICLE_CONTENT}}` 这类变量
- 这些变量不会被替换

这会导致某些类型在没有 DB 配置时，最终发给模型的是未渲染的模板文本。

## 4. `insights` 默认模板未注册

`src/config/default-prompts/insights.md` 已经存在，但 `src/api/system-prompts.ts` 的默认模板配置里原先没有注册 `insights`：

- 新用户初始化默认 prompt 时，`insights` 不会被自动创建
- 这会让 `insights` 更容易落到 fallback 逻辑

## 5. 仓库中存在大量 `src/**/*.js` 编译产物

在 `src` 目录下发现大量与 `.ts` 同路径共存的 `.js` 文件，例如：

- `src/api/daily-summary.js`
- `src/api/system-prompts.js`
- `src/llm.js`
- `src/logger.js`

这些文件明显是旧编译产物，但它们仍然留在源码目录中。

风险：

- 排查时容易误读旧逻辑
- 如果运行环境或导入路径异常，可能误用旧 `.js`
- 会造成“TS 已修复，但运行行为仍像旧版本”的错觉

## 6. 本次清理尝试未完成

本次尝试删除 `src` 下与 `.ts` 成对存在的旧 `.js` 产物，但命令执行被中断，最终状态确认如下：

- 旧 `.js` 文件仍然存在
- 本次没有实际删除成功

因此，编译产物清理目前仍是待办项。

## 已完成修复

## 1. 统一了提示词调用逻辑

目前 `src` 下实际的 TS 调用链已统一为：

1. 根据任务类型读取 DB 模板
2. 使用变量渲染模板
3. 将渲染后的完整文本作为单条 `user` 消息发送给 LLM

已调整的文件：

- `src/api/daily-summary.ts`
- `src/agent.ts`
- `src/api/system-prompts.ts`

## 2. `daily_summary` 系列已改为统一逻辑

以下场景已统一为“完整 `userPrompt`”模式：

- `generateDailySummary`
- `generateSearchSummary`
- `generateJournalAllSummary`
- `generateInsightsSummary`

## 3. `translation` 已改为统一逻辑

`src/agent.ts` 中翻译调用现在也改为：

- 从 DB 读取 `translation` 类型模板
- 渲染变量
- 只发送一条完整 `user` 消息

## 4. `resolveSystemPrompt` 已增强

现在无论是否命中 DB 模板：

- 都会先对 fallback 模板执行变量渲染
- 从而保证 fallback 行为和 DB 模板行为一致

## 5. 已补上 `insights` 默认模板注册

现在 `insights.md` 已被纳入默认模板配置，后续初始化用户默认 prompt 时可以正常创建。

## 当前未完成事项

## 1. 清理 `src` 下旧 `.js` 编译产物

建议后续只删除“与同路径 `.ts` 配对存在”的 `.js` 文件，不处理：

- `src/public/js/**`
- 其他没有对应 `.ts` 的前端或构建脚本

## 2. 明确项目运行入口只使用 TS 源码

当前 `package.json` 的 `dev` 命令是：

```json
"dev": "tsx src/index.ts"
```

按此配置，开发环境理论上应以 TS 为准。但如果后续还有其他运行脚本、部署脚本或工具链直接引用 `src/**/*.js`，仍可能导致旧逻辑被使用，需要继续核对。

## 3. 仓库仍存在一批与本次修改无关的历史 TypeScript 报错

执行 `npm run typecheck` 时，仍存在多个既有报错，主要分布在：

- `scripts/*`
- 若干 API 日志模块
- 若干调试/测试脚本
- `src/scraper.ts` 的依赖声明

这些问题不是本次提示词修复引入的，但会影响全量类型检查通过。

## 建议的后续动作

1. 删除 `src` 下与 `.ts` 配对存在的旧 `.js` 编译产物
2. 检查部署/运行脚本，确保不会误引用 `src/**/*.js`
3. 如果后续还要继续规范化，可新增一个统一的 prompt 构造器，让所有任务类型都通过同一入口构造最终 `userPrompt`
4. 单独清理现有 TypeScript 历史报错，恢复 `npm run typecheck` 可用性
