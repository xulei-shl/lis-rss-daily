# Todo

## [x] Win11 启动主程序并编写最佳实践文档

1. [x] 探查环境与项目启动链路 -> verify: Node 24.13.0 / pnpm 10.6.1 / chroma 1.5.5 已就绪
2. [x] 实测启动，定位失败根因 -> verify: `pnpm install` 补齐缺失的 `imapflow` 后 `pnpm run dev` 返回 HTTP 200
3. [x] 编写 `Windows启动最佳实践.md` -> verify: 文档内命令均在本机实测
4. [x] 按文档启动服务 -> verify: `scripts\start.bat` 启动，HTTP 200，监听实例数 = 1（PID 13764）
5. [x] 验证防重复启动保护 -> verify: 二次执行输出 `[SKIP]`，实例数仍为 1
6. [x] 记录经验 -> verify: `tasks/lessons.md` 已写入 10 条

### 评审

- 主程序已在后台运行：`http://localhost:8007`，日志 `logs/app.log`。
- 本次未启动 ChromaDB（按用户要求跳过），未改 `.env`，未在真实数据库上跑迁移（在临时副本上验证通过）。
- 偏差：`.bat` 首版含中文导致 cmd 解析失败，已改为 ASCII 并同步更新文档。
- 待办（未执行）：`schtasks` 登录自启、防火墙放行 8007、admin 默认密码修改。
