# src 目录旧 JS 编译产物清理操作日志

- 操作日期：2026-04-02
- 操作人：Claude Code
- 操作范围：`/opt/lis-rss-daily/src`
- 操作目标：清理 `src` 目录下与同路径 `.ts` 文件重复存在的旧 `.js` 编译产物，降低运行歧义与排查成本。

## 一、操作背景

此前已确认项目当前主开发入口与 TypeScript 配置如下：

- `package.json`
  - `dev: "tsx src/index.ts"`
- `tsconfig.json`
  - `outDir: "dist"`

基于以上配置，项目当前的标准运行/开发方式应当以 `src/**/*.ts` 为源码，以 `dist/` 为编译输出目录。

但实际仓库中存在一批位于 `src/` 下、且与 `.ts` 同路径配对存在的 `.js` 文件。这类文件更符合“历史编译产物残留”的特征，而不是当前应继续保留的源码。

## 二、操作原因

本次清理的原因如下：

1. 避免源码目录中同时存在 `xxx.ts` 与 `xxx.js`，导致阅读和排查时误判真实执行逻辑。
2. 降低运行时误用旧 `.js` 文件的风险，避免出现“TypeScript 已修改，但实际行为仍像旧版本”的问题。
3. 与当前项目约定保持一致：源码放在 `src/`，编译输出应进入 `dist/`，而不是混在 `src/`。
4. 配合本次提示词调用修复，消除旧编译产物对调试和回归验证的干扰。

## 三、清理原则

本次清理严格遵循以下原则：

1. **只删除与同路径 `.ts` 配对存在的 `.js` 文件**。
2. **不删除 `src/public/js/**`**，因为该目录属于前端静态资源，不属于 TypeScript 编译残留。
3. **不删除 `src/scripts/build-css.js`**，因为该文件被 `package.json` 直接通过 Node 执行，且没有对应 `.ts` 文件，不属于重复编译产物。
4. **不修改任何 TypeScript 源码逻辑**，仅清理重复旧产物并记录日志。

## 四、实际执行的删除操作

本次共删除 36 个文件：

```text
src/api/articles.js
src/api/daily-summary.js
src/api/llm-configs.js
src/api/settings.js
src/api/system-prompts.js
src/api/telegram-chats.js
src/api/timezone.js
src/config/system-prompt-variables.js
src/config/types-config.js
src/config/wechat-config.js
src/config.js
src/constants/source-types.js
src/db.js
src/llm-logger.js
src/llm.js
src/logger.js
src/rss-parser.js
src/telegram/client.js
src/telegram/formatters.js
src/telegram/index.js
src/telegram/types.js
src/utils/crypto.js
src/utils/datetime.js
src/utils/markdown.js
src/utils/rate-limiter.js
src/utils/title.js
src/vector/chroma-client.js
src/vector/embedding-client.js
src/vector/reranker.js
src/vector/search-service.js
src/vector/search.js
src/vector/text-builder.js
src/vector/vector-store.js
src/wechat/client.js
src/wechat/formatters.js
src/wechat/index.js
```

## 五、本次修改内容说明

### 1. 删除了什么

删除了 `src/` 目录下与 `.ts` 文件成对存在的旧 `.js` 文件，共 36 个。

### 2. 修改了什么

除文件删除外，本次还新增了本日志文件：

- `js-artifact-cleanup-log-2026-04-02.md`

本次**未修改任何业务源码逻辑**，包括但不限于：

- 未修改 `src/api/daily-summary.ts`
- 未修改 `src/api/system-prompts.ts`
- 未修改 `src/agent.ts`
- 未修改任何配置文件逻辑

### 3. 为什么这样改

原因是这些 `.js` 文件与 `.ts` 文件同路径重复存在，且当前项目标准运行方式已经以 TypeScript 源码和 `dist/` 输出为准；继续保留这些旧 `.js` 文件只会增加歧义和误用风险。

## 六、保留未删除的内容

以下内容明确未纳入本次删除范围：

### 1. `src/public/js/**`

保留原因：该目录属于前端静态资源目录，不是 TypeScript 编译残留。

### 2. `src/scripts/build-css.js`

保留原因：该脚本由 `package.json` 中的 `build:css` 直接执行：

```json
"build:css": "node src/scripts/build-css.js"
```

它不是与 `.ts` 配对重复存在的旧编译产物，因此不应按本次规则删除。

## 七、执行后核验结果

执行删除后，已再次检查 `src/` 目录下“与同路径 `.ts` 配对存在的 `.js` 文件”数量：

- 删除前：36
- 删除后：0

这表明本次目标范围内的旧 `.js` 编译产物已清理完成。

## 八、风险说明

本次删除的是与 `.ts` 源文件重复存在的旧 `.js` 文件，理论上应不会影响当前标准开发路径：

- `tsx src/index.ts`
- `tsc` 输出到 `dist/`

但仍需注意：

1. 如果某些未梳理的外部脚本、部署脚本或手工命令依赖 `src/` 下旧 `.js` 文件，可能需要同步调整。
2. 当前仓库存在大量与本次操作无关的其他变更和未跟踪文件，本次未触碰这些内容。
3. 本次未进行全量运行验证或类型检查，因此本日志只证明“删除动作已完成”，不等同于“项目全量验证已完成”。

## 九、建议的后续动作

1. 检查部署脚本、服务启动脚本、CI 配置，确认不会再直接引用 `src/**/*.js`。
2. 如需进一步稳固，可补做一次最小验证：
   - 启动主入口
   - 检查关键总结/提示词链路是否正常
3. 后续如再有编译输出需求，应确保统一输出到 `dist/`，不要重新写回 `src/`。

## 十、结论

本次已完成对 `src/` 目录下旧 `.js` 编译残留的定向清理。

- 已删除：36 个与 `.ts` 配对的旧 `.js` 文件
- 已保留：`src/public/js/**`、`src/scripts/build-css.js` 及其他不属于本次规则的文件
- 已新增：本操作日志文件

本次操作的核心收益是：

- 减少源码目录歧义
- 降低误用旧编译产物的风险
- 为后续继续验证提示词修复提供更干净的代码状态
