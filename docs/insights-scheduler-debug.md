# 洞察报告定时任务分析

## 问题描述

用户反馈：定时洞察报告在 4月27日没有执行，但按配置（间隔10天）应该执行。

> 上次运行：`2026-04-16T23:16:30.760Z`
> 当前日期：`2026-04-27`
> 预期执行：4月27日 7:15（北京时间）

## 代码逻辑分析

### 定时触发机制

根据提交 `119400689b6e544c2a02c286e41d5feb2a5f64e5`：

1. **Cron 配置**：`15 7 * * *`（每天 7:15 检查）
2. **间隔配置**：`INSIGHTS_INTERVAL_DAYS = 10`
3. **触发条件**：距离上次成功执行已满 10 天

### 日期记录位置

- **表名**：`settings`
- **键名**：`insights_last_success_at`
- **存储方式**：通过 `setUserSetting` API 存入数据库

```typescript
// src/insights-scheduler.ts:223-228
await setUserSetting(
  this.config.userId,
  INSIGHTS_LAST_SUCCESS_AT_KEY,
  new Date().toISOString()
);
```

### 判断逻辑

```typescript
// src/insights-scheduler.ts:284-285
const elapsedMs = Date.now() - lastSuccessAt.getTime();
return elapsedMs >= this.config.intervalDays * DAY_IN_MS;
```

## 问题根因

**后端服务未运行**

检查端口监听发现：
- 端口 3000：只有 Next.js 前端在运行（`next-server`）
- 后端 API 服务（`src/index.ts`）未启动

## 解决方案

重启后端服务：

```bash
cd /opt/lis-rss-daily
pnpm dev
```

或使用 PM2 管理：

```bash
pm2 start src/index.ts --name lis-rss
```

## 时间计算

| 上次执行 | 间隔 | 预期执行 |
|---------|------|---------|
| 2026-04-16 23:16 UTC | 10天 | 2026-04-26 23:16 UTC 之后 |
| 换算北京时间 | - | 2026-04-27 07:16 + |

Cron 在 4月27日 7:15 检查时，间隔已满足（>10天），应该触发执行。

## 相关文件

- `src/insights-scheduler.ts` - 定时任务核心逻辑
- `src/config.ts` - 配置定义（`insightsIntervalDays`）
- `src/api/settings.ts` - 设置存储（`getUserSetting`/`setUserSetting`）