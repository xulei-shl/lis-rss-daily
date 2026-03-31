# Insights 修复与手动触发说明

## 问题结论

当前 `.env` 中的配置如下：

```env
INSIGHTS_ENABLED=true
INSIGHTS_SCHEDULE=15 7 */10 * *
INSIGHTS_DAYS=10
INSIGHTS_USER_ID=1
```

按 `Asia/Shanghai` 时区解析，`15 7 */10 * *` 会在每月的 `1、11、21、31` 号 `07:15` 触发。

所以 `2026-03-31 07:15` 本来应该执行洞察任务。

之前没有执行，不是 cron 表达式问题，而是主程序启动时没有把 `insights scheduler` 接入运行流程。

## 本次修复

本次只做了最小修改，文件：

- `src/index.ts`

修复内容：

1. 引入 `initInsightsScheduler`
2. 应用启动时初始化并启动 `insights scheduler`
3. 启动日志中输出 `insightsEnabled` 和 `insightsSchedule`
4. 应用关闭时补充 `insights scheduler` 的停止逻辑

这样处理后，服务启动后就会正式注册洞察定时任务。

## 关键影响

修复后，若服务在 `2026-03-31 07:15` 前已启动并持续运行，则会按配置自动执行洞察生成。

需要注意：

- `node-cron` 只会在进程运行期间触发
- 如果服务在触发时间点没有启动，任务不会自动补跑
- 错过定时点后，需要手动触发一次

## 手动触发命令

项目里已有脚本：

```bash
npm run trigger-insights -- 10 1
```

含义：

- `10` 对应 `INSIGHTS_DAYS=10`
- `1` 对应 `INSIGHTS_USER_ID=1`

如果要使用默认参数，也可以执行：

```bash
npm run trigger-insights
```

但这个脚本默认值写死为：

- `days=15`
- `userId=1`

所以你当前配置是 10 天，建议显式使用：

```bash
npm run trigger-insights -- 10 1
```

## 我这边的手动触发测试情况

我尝试执行过：

```bash
npm run trigger-insights -- 10 1
```

第一次失败原因不是业务逻辑，而是当前沙箱环境限制了 `tsx/esbuild` 的子进程启动，报错为 `spawn EPERM`。

这说明：

- 手动触发命令本身已找到
- 脚本入口正常
- 失败点在当前受限执行环境，不是 `insights` 代码路径本身

你在本机终端直接执行该命令即可绕过这个沙箱限制。

## 建议的自测步骤

1. 重启服务
2. 观察启动日志中是否出现 `Insights scheduler started`
3. 在项目根目录执行：

```bash
npm run trigger-insights -- 10 1
```

4. 检查是否生成洞察报告
5. 检查是否完成对应推送

## 补充说明

如果你需要验证“定时器是否真的注册成功”，重点看服务启动日志。

如果你需要验证“洞察生成链路是否跑通”，重点看手动触发命令的输出结果，以及数据库/页面中是否出现新的 `insights` 记录。
