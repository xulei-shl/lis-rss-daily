# Telegram 推送问题排查交接

## 1. 当前任务目标
- **问题**: 2026-3-16 的"全部期刊总结"推送到了企业微信，但没有推送到 Telegram
- **预期**: 找到推送失败的根本原因并修复
- **完成标准**: Telegram 推送恢复正常，后续定时推送能成功发送

## 2. 当前进展

### 已完成的分析
- 确认 3-15 的日志显示 Telegram 推送实际上也是失败的，只是之前没注意到
- 确认代码逻辑正确，generateJournalAllSummary 确实调用了 getTelegramNotifier().sendJournalAllSummary()
- 确认 Telegram Bot 配置正确（token有效、频道配置正确、journal_all推送开关已开启）
- 用 curl 通过代理向频道发送消息成功，说明代理、token、权限都没问题
- 确认 /getarticles 命令命令能正常返回，说明 Bot 轮询机制正常
- 发现日志中有多个 Bot 实例冲突的错误
- **找到根本原因**: 直接执行 generateJournalAllSummary 时发现 undici assertion 错误

### 已完成的修改
- 重启了应用服务，清理了冲突的 Bot 实例

## 3. 关键上下文

### 重要背景信息
- 项目使用 tsx 直接运行源代码（pnpm dev），dist/ 编译文件是过期的（3月12日），不影响运行
- 推送使用 TelegramClient 实例，Bot 轮询使用 Bot 持有的 client 实例
- 系统使用 undici 库的 ProxyAgent 处理代理，代理地址为 http://127.0.0.1:7890

### 用户的明确要求
- 用户确认需要通过代理才能访问 Telegram API
- 用户确认频道 @lisrsstracker 需要接收全部期刊总结
- 用户说 3-15 是正常的（实际上日志显示也是失败的）

### 已知约束
- Telegram 频道消息长度限制：4096 字符
- Telegram API 请求超时：30 秒
- 最大重试次数：3 次

## 4. 关键发现

### 最重要的结论
**根本原因**: undici ProxyAgent 在独立脚本执行时为 null/undefined

错误信息：The expression evaluated to a falsy value: assert(dispatcher)

这是 undici 内部的 assertion 错误，说明 dispatcher 参数（ProxyAgent）传递失败。

### 关键验证结果
| 测试方法 | 结果 | 说明 |
|---------|------|------|
| curl 发送消息 | 成功 | 代理、token、权限正常 |
| Node.js 单独测试 ProxyAgent | 成功 | ProxyAgent 本身没问题 |
| 应用内 Bot 轮询 | 正常 | Bot 的 client 正常工作 |
| 推送时创建新 TelegramClient | 失败 | ProxyAgent 传递有问题 |

### 值得注意的信息
1. **环境变量问题**: 独立运行脚本时，.env 文件可能没有被正确加载
2. **模块级共享变量**: httpProxyAgent 是模块级变量，可能存在初始化时序问题
3. **多个实例冲突**: 日志中确实存在多个 Bot 实例同时运行的情况

## 5. 未完成事项

### 高优先级
1. **修复 ProxyAgent 初始化问题** - 这是根本原因
2. **确保环境变量正确加载** - HTTP_PROXY 需要在所有上下文中可用
3. **清理多个 Bot 实例** - 防止轮询冲突

### 中优先级
1. 验证修复后的推送功能
2. 检查是否有其他类型推送也存在同样问题

## 6. 建议接手

### 应优先查看
1. **环境配置加载逻辑**
   - 文件: src/config.ts
   - 检查 dotenv 是否正确配置

2. **Telegram client 的 ProxyAgent 初始化**
   - 文件: src/telegram/client.ts 第 23-33 行
   - 检查 HTTP_PROXY 环境变量的获取方式

3. **应用启动时的环境变量**
   - 文件: src/index.ts
   - 检查启动时是否正确加载了 .env

### 应先验证
1. 检查应用运行时 process.env.HTTP_PROXY 的值
2. 对比 Bot 轮询的 client 和推送时创建的 client 的 ProxyAgent 状态

### 推荐的下一步动作
1. 修改 src/telegram/client.ts，在模块加载时添加调试日志，输出 HTTP_PROXY 的值和 ProxyAgent 的状态
2. 如果环境变量未加载，确保在 src/index.ts 启动时调用 dotenv.config()
3. 重新启动服务，观察日志中 httpProxyAgent 的初始化信息

## 7. 风险与注意事项

### 容易误判的点
- 不要认为是 Telegram API 频率限制（错误信息明确是 assertion 错误）
- 不要认为是代码逻辑错误（curl 和单测都成功）
- 不要认为是代理配置错误（curl 通过代理发送成功）

### 不建议继续的方向
- 不要检查 Telegram Bot 权限（已验证正常）
- 不要检查频道 ID 正确性（已验证正常）
- 不要检查消息长度（已确认在 4096 字符限制内）

---

## 下一位 Agent 的第一步建议

**建议先执行以下操作确认环境变量问题：**

# 1. 检查当前应用进程的环境变量
cat /proc/$(pgrep -f "tsx src/index" | head -1)/environ | tr '\0' '\n' | grep HTTP_PROXY

# 2. 检查 .env 文件内容
cat /opt/lis-rss-daily/.env | grep HTTP_PROXY

# 3. 在应用日志中搜索 ProxyAgent 初始化信息
tail -100 /tmp/app.log | grep "proxy\|Proxy"

根据结果：
- 如果环境变量存在但 ProxyAgent 初始化日志缺失 → 修复 client.ts 的初始化逻辑
- 如果环境变量不存在 → 修复 index.ts 的 dotenv 加载
