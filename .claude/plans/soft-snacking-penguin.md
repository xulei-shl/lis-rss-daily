# 计划：为搜索页AI总结功能添加配置项控制Guest权限

## Context

当前搜索页面(`/search`)中的"勾选并AI总结"功能仅对 admin 用户开放。Guest 用户无法使用此功能。
用户希望通过配置项来控制是否允许 guest 用户使用此功能，以便灵活管理权限。

## 実现方案

### 1. 配置文件修改 (`src/config.ts`)

**位置**: `src/config.ts`

**修改内容**:
- 在 `Config` 接口中添加配置项属性：`searchAiSummaryGuestEnabled: boolean`
- 在 `getConfig()` 函数中添加配置加载逻辑：
  ```typescript
  searchAiSummaryGuestEnabled: process.env.SEARCH_AI_SUMMARY_GUEST_ENABLED === 'true',
  ```

### 2. 环境变量示例文件修改 (`.env.example`)

**位置**: `.env.example`

**修改内容**: 添加环境变量说明：
```bash
# 是否允许 guest 用户使用搜索 AI 总结功能
SEARCH_AI_SUMMARY_GUEST_ENABLED=false
```

### 3. 认证中间件添加 (`src/middleware/auth.ts`)

**位置**: `src/middleware/auth.ts`

**修改内容**: 添加新的中间件函数 `requireSearchSummaryAccess`：
```typescript
/**
 * Require search summary access middleware
 * Allows guest access if config permits, otherwise requires admin
 */
export function requireSearchSummaryAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  // If config allows guest access, skip permission check
  if (config.searchAiSummaryGuestEnabled) {
    return next();
  }

  // Otherwise, require admin access
  if (!hasRole(req.user?.role, 'admin')) {
    if (req.path.startsWith('/api/')) {
      res.status(403).json({ error: '权限不足，需要管理员权限' });
      return;
    }
    res.status(403).render('error', {
      pageTitle: '权限不足',
      error: '您没有权限访问此页面',
    });
    return;
  }
  next();
}
```

### 4. 搜索路由修改 (`src/api/routes/search.routes.ts`)

**位置**: `src/api/routes/search.routes.ts`

**修改内容**:
- 修改 import：添加 `requireSearchSummaryAccess`
- 修改第80行的中间件：从 `requireWriteAccess` 改为 `requireSearchSummaryAccess`

### 5. 搜索页面修改 (`src/views/search.ejs`)

**位置**: `src/views/search.ejs`

**修改内容**:
- 第112行：将 `const isAdmin = window.userRole !== 'guest';` 改为：
  ```javascript
  const isAdmin = window.userRole !== 'guest';
  const hasSummaryAccess = isAdmin || window.guestSummaryEnabled;
  ```
- 第154-157行：将 `if (isAdmin)` 改为 `if (hasSummaryAccess)`
- 第209行：将 `&& isAdmin` 改为 `&& hasSummaryAccess`
- 第484-486行：将 `if (isAdmin)` 改为 `if (hasSummaryAccess)`
- 第535行：将 `const checkboxHtml = isAdmin` 改为 `const checkboxHtml = hasSummaryAccess`

### 6. 搜索页面路由修改 (`src/api/web.ts`)

**位置**: `src/api/web.ts` 第197行

**修改内容**: 添加 `guestSummaryEnabled` 配置到渲染参数：
```typescript
res.render('search', {
  pageTitle: '语义搜索 - LIS-RSS Literature Tracker',
  user: req.user,
  guestSummaryEnabled: config.searchAiSummaryGuestEnabled
});
```

### 7. 布局模板修改 (`src/views/layout.ejs`)

**位置**: `src/views/layout.ejs` 第52-54行之后

**修改内容**: 添加 guestSummaryEnabled 配置到 window 对象：
```javascript
window.userRole = <%- user ? `"${user.role}"` : '"guest"' %>;
window.guestSummaryEnabled = <%- (typeof guestSummaryEnabled !== 'undefined') ? guestSummaryEnabled : 'false' %>;
```

## 关键文件路径

- `/opt/lis-rss-daily/src/config.ts` - 配置定义和加载
- `/opt/lis-rss-daily/.env.example` - 环境变量示例
- `/opt/lis-rss-daily/src/middleware/auth.ts` - 认证中间件
- `/opt/lis-rss-daily/src/api/routes/search.routes.ts` - 搜索API路由
- `/opt/lis-rss-daily/src/api/web.ts` - Web页面路由（第193-201行）
- `/opt/lis-rss-daily/src/views/layout.ejs` - 布局模板（第52-54行）
- `/opt/lis-rss-daily/src/views/search.ejs` - 搜索页面

## 验证步骤

1. 测试默认情况（`SEARCH_AI_SUMMARY_GUEST_ENABLED=false`）：
   - 以 guest 用户登录，复选框和AI总结按钮应隐藏
   - 以 admin 用户登录，功能应正常工作

2. 测试启用配置（`SEARCH_AI_SUMMARY_GUEST_ENABLED=true`）：
   - 设置环境变量并重启服务
   - 以 guest 用户登录，复选框和AI总结按钮应显示
   - guest 用户应能正常使用AI总结功能

3. 测试后端权限：
   - 配置为 false 时，guest 直接调用 `/api/search/summary` 应返回 403
   - 配置为 true 时，guest 调用 `/api/search/summary` 应成功
