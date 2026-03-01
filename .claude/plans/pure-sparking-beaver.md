# 关键词黑名单功能实现计划

## Context

用户需要在文章过滤流程中增加关键词黑名单功能。当文章的 `title` 字段匹配黑名单关键词时，自动标记为 `拒绝`，跳过 LLM 过滤和后续处理流程。关键词通过 settings 页面新增的 tab 进行管理，使用逗号分隔（支持中英文逗号），配置存储在 YAML 文件中。

## 实现方案

### 1. 新建文件

#### 1.1 配置文件：`config/blacklist.yaml`
```yaml
version: "1.0"
metadata:
  updated_at: "2025-03-01"

title_keywords:
  enabled: true
  keywords: ""
```

#### 1.2 配置加载器：`src/config/blacklist-config.ts`
- `getTitleBlacklistKeywords()` - 解析关键词字符串，返回数组
- `getBlacklistConfig()` - 获取完整配置
- `reloadBlacklistConfig()` - 重新加载配置
- 参考 `src/config/types-config.ts` 的模式

#### 1.3 过滤服务：`src/config/blacklist-filter.ts`
- `checkTitleBlacklist(title: string)` - 检查标题是否匹配黑名单
- 返回 `{ isBlacklisted, matchedKeywords, reason }`

#### 1.4 API 路由：`src/api/routes/blacklist.routes.ts`
- `GET /api/blacklist` - 获取配置
- `PUT /api/blacklist` - 更新配置（需要 admin 权限）

#### 1.5 前端面板：`src/views/settings/panel-blacklist.ejs`
- 启用/禁用开关（checkbox）
- 关键词输入区域（textarea）
- 保存和重置按钮

### 2. 修改文件

#### 2.1 `src/filter.ts`
在 `filterArticle()` 函数开头（第 360 行附近）添加黑名单检查：

```typescript
// 黑名单检查（Stage 0）
const { checkTitleBlacklist } = await import('./config/blacklist-filter.js');
const blacklistResult = checkTitleBlacklist(input.title);

if (blacklistResult.isBlacklisted) {
  await updateArticleFilterStatus(input.articleId, 'rejected', 0);
  await recordFilterLog(input.articleId, null, false, null, blacklistResult.reason, null);
  return {
    passed: false,
    domainMatches: [],
    filterReason: blacklistResult.reason,
    usedFallback: false,
  };
}
```

#### 2.2 `src/api/routes.ts`
- 导入 `blacklist.routes.ts`
- 注册路由：`router.use(blacklistRoutes)`

#### 2.3 `src/views/settings/body.ejs`
- 添加新 tab 按钮：`<button class="settings-tab" data-tab="blacklist">黑名单</button>`
- 添加 panel 引用：`<%- include('panel-blacklist') %>`

#### 2.4 `src/public/js/settings.js`
添加黑名单相关函数：
- `loadBlacklistConfig()` - 加载配置
- `saveBlacklistConfig(e)` - 保存配置
- `resetBlacklistForm()` - 重置表单
- `showBlacklistStatus(message, type)` - 显示状态消息

### 3. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储方式 | YAML 文件 | 与现有 `types.yaml` 模式一致 |
| 匹配规则 | 不区分大小写包含匹配 | 更宽松的过滤，避免遗漏 |
| 分隔符 | 中英文逗号 | 用户体验友好 |
| 权限控制 | 管理员才能修改 | 避免误配置 |
| 过滤位置 | LLM 之前 | 作为第一道防线，节省成本 |

### 4. 验证步骤

1. 创建配置文件并启动服务
2. 在 settings 页面添加测试关键词（如 "招聘"）
3. 用包含关键词的标题测试过滤，验证：
   - 文章被标记为 `rejected`
   - `article_filter_logs` 表有记录
   - 没有调用 LLM API
4. 用不含关键词的标题验证正常过滤流程
5. 测试禁用黑名单后正常流程恢复

### 5. 关键文件路径

**新建：**
- `config/blacklist.yaml`
- `src/config/blacklist-config.ts`
- `src/config/blacklist-filter.ts`
- `src/api/routes/blacklist.routes.ts`
- `src/views/settings/panel-blacklist.ejs`

**修改：**
- `src/filter.ts` - 添加黑名单检查逻辑
- `src/api/routes.ts` - 注册黑名单路由
- `src/views/settings/body.ejs` - 添加黑名单 tab
- `src/public/js/settings.js` - 添加黑名单管理逻辑
