# Todo

## [ ] Paper PDF Summary API 契约正交化（Agent 友好升级）

> 依据 `scripts/paper-pdf-summary/docs/api-agent友好升级/` 的 4 原则 + 5 项 Checklist，
> 对齐评估报告对 `paper-summary` 的 C- 评级（契约倒错 / 语义污染）。

### 现状核对（已逐条读码确认，非推测）

| # | 代码位置 | 事实 |
|---|---------|------|
| A | `utils/api_queue.py:314-320` | `result["success"]` 由 `_is_all_upload_failed()` 决定 → 五平台全跳过时**恒为 false**，摘要已成功也报失败 |
| B | `utils/api_queue.py:321-322` | 推送全被跳过时仍写 `reason="部分上传任务失败"`，文案与事实相反 |
| C | `utils/api_queue.py:197-198`、`api.py:158-159` | `final_push_wechat = push_wechat or default_push_wechat` → 客户端传 `push_wechat=false` 仍会被环境变量翻转成推送；与 `push_hiagent/memos/blinko` 的三态语义不一致 |
| D | `utils/api_queue.py:344-355` | 业务失败的务也被置 `status="completed"`，`failed` 只表示抛异常 → `status` 与业务成败解耦 |
| E | `api.py:125-126` | 阻塞模式把业务失败转成 HTTP 500，异步模式却是 200+`success:false` → 同一失败两套语义 |
| F | `api.py:176` | `/upload-text` 同样用 `is_all_upload_failed()` 判 `success`，同一缺陷 |
| G | 全链路 | 失败原因只有中文 `reason`/`detail`，无稳定 `error_code`；客户端被迫做子串匹配（`paper_client.py:57-60`） |
| H | `api.py:120`、`summary_uploader.py:619-632` | `duplicate` / `queue_size` / `_skipped` 等内部调度状态混在业务实体里 |
| I | `api_queue.py:75-89`、`api.py:128-135` | `md_content` 无条件全量随响应与每次轮询返回，无 `fields`/`format`，长摘要撑爆 CLI stdout 风险 |
| J | `utils/api_queue.py:18-19` | 结果仅内存 TTL 300s，重启即丢，重启后 404 与"任务不存在"不可区分 |

### 调用方清单（改动影响面）

- `F:\Github\skill-creator\.opencode\skills\paper-summary\scripts\paper_client.py`（异步轮询，自算成败，字符串匹配 error_kind）
- `src/api/routes/pdf-summary.routes.ts:184-246`（异步轮询，只看 `result.success`，不看 HTTP 码）
- `scripts/paper-pdf-summary/telegram-bot/index.ts:304-383`（异步轮询，看 `result.success` + `stages.*`）
- CLI `main.py --title`（走 `process_direct_article`，**不经过 API**，不受影响）

### 实施步骤

- [x] **P0-1 `success` 正交化**：`utils/api_queue.py` 中 `success` 只由 `pdf_download && pdf_validate && pdf_summary && md_content 非空` 决定（`pipeline_succeeded()`）；推送结果移入新字段 `distribution`，不影响 `success`
      -> verify: 五平台全 `push_*=false` 时 `success=true`（冒烟 + E2E 均通过）
- [x] **P0-2 `distribution` 结构化**：`build_distribution()` 以 `{requested, ok[], failed[], skipped[], error}` 取代对 `_skipped` 的解析；`stages.upload` 仅作兼容保留
      -> verify: 跳过与失败在响应里可区分，SKILL 台账 `distribution.ok=[] / skipped=5 项`
- [x] **P0-3 修 `reason` 文案**：全跳过时不再写"部分上传任务失败"；`reason` 仅描述核心流水线失败 -> verify: 成功路径 `reason is None`
- [x] **P0-4 `push_wechat` 三态化**：`Optional[bool]`，`false` = 强制不推（`api_queue.py:198` 与 `api.py:157` 同款修正）-> verify: `PDF_SUMMARY_PUSH_WECHAT=true` 且传 `push_wechat=false` 时 `skipped` 含 `wechat`
- [x] **P0-5 错误码枚举**：`error_code` ∈ {`pdf_unavailable`,`title_mismatch`,`summary_failed`,`summary_empty`,`distribution_failed`,`internal_error`}，五个失败分支全部覆盖 -> verify: 每条失败路径 `error_code` 非空
- [x] **P0-6 状态语义收敛**：`status` 仅表达任务执行终态，业务成败一律看 `result.success`；文档明确 `completed ≠ 成功` -> verify: 阻塞/异步两模式对同一失败给出同一 `success`/`error_code`
- [x] **P1-1 阻塞模式状态码**：业务失败返回 200 + `success:false` + `error_code`，404 仅表示任务不存在/过期，500 仅留给内部异常 -> verify: 冒烟「下载失败仍返回 200」
- [x] **P1-2 双轨输出**：`GET /process/status/{task_id}?include=meta` 只回进度与 `error_code`（<1KB），`include=full` 回完整结果；`POST /process` 支持 `include_summary=false` 只给 `md_path` + `md_bytes`
      -> verify: meta 响应 200 字节级；轮询全程不搬运摘要正文
- [x] **P1-3 内部状态出参降级**：`queue_size` / `duplicate` 移出响应体到 `X-Queue-Size` / `X-Deduplicated` 响应头，响应体只留 `task_id` + `status_url` -> verify: 冒烟断言响应体无这两个字段
- [x] **P1-4 `/health` 能力发现**：新增 `api_version` 与 `capabilities[]`（6 项）-> verify: 客户端可据此判断服务端能力
- [x] **P2-1 结果落盘**：`logs/tasks/<task_id>.json` 落盘 + 启动回载（内存 5 分钟 / 落盘 24 小时，两把尺子独立计量，文件按落盘 TTL 清理）
      -> verify: 清空内存后回载仍可查；内存到期不误删仍有 24h 效力的文件
- [x] **P2-2 文档升级 v2.0**：`API文档.md` 重写「契约约定 / 错误码表 / `include` 双轨 / 推送目标矩阵 / v1→v2 迁移对照」，修正 `push_wechat` 与 `success` 的错误表述
      -> verify: 文档每个字段都能在代码里找到对应实现
- [x] **P2-3 同步调用方**（跨仓库）
      - `skill-creator/.../paper_client.py`：`error_code` 直连映射（弃用中文子串匹配）、`include=meta` 轻量轮询、`distribution` 台账、响应头读去重
      - `skill-creator/.../SKILL.md` + `paper_summary.py`：17 处 v1.x 表述更新（v1.x「顶层 success 不作数」「wechat 客户端关不掉」「结果重启即丢」等已全部失效）
      - `lis-rss-daily/src/api/routes/pdf-summary.routes.ts`：轮询改 `include=meta`，终态再取 full；去重标记读响应头
      - `paper-pdf-summary/telegram-bot/index.ts`：展示改用 `distribution` 三段式（跳过不再显示为 ❌），失败分支显示 `error_code`
      -> verify: `tsc --noEmit` 我的改动文件零错误；客户端契约单测 + 真实 uvicorn E2E 全通过

### 清理

- 删除 `utils/summary_uploader.py` 中已无引用的 `is_all_upload_failed()`（被 `build_distribution` / `pipeline_succeeded` 取代）
- `main.py` 的 CLI 链路与 `_is_all_upload_failed` **保持原样**：CLI 走 `process_article`，不经过 API 层，语义独立于本次契约升级

### 不做的（明确排除）

- 不新增端点集合（`/summaries` 之类）：端点正交化用"语义正交 + `distribution` 子对象"即可达成报告目标，新增端点会扩大维护面。
- 不改 `utils/summary_uploader.py` 的五平台实现与 `main.py` CLI 链路。
- 不引入鉴权/限流等本报告未要求的能力。
- 不做强制 breaking change：`stages.upload` / `_skipped` 保留为兼容字段，新字段为增量。

### 评审

- **改动文件**：`api.py`、`utils/api_queue.py`、`utils/summary_uploader.py`、`API文档.md`、`telegram-bot/index.ts`、`src/api/routes/pdf-summary.routes.ts`（本仓）+ `paper_client.py`、`paper_summary.py`、`SKILL.md`（skill-creator 仓，跨仓改动需你确认）
- **验证**：31 项契约冒烟（桩掉子进程）+ 19 项真实 uvicorn ↔ 真实客户端 E2E，全部通过；`tsc --noEmit` 我的文件零错误（仓内 20 处报错全为既有问题，19处在 `backup/`、1 处为缺失的 `cluster-topics.routes`）。
- **行为变更（需部署时留意）**：
  1. 业务失败从 500 改为 200 —— 若有调用方按「非 2xx 即失败」判断，需改为读 `success`。
  2. `push_wechat=false` 现在一定生效 —— `PDF_SUMMARY_PUSH_WECHAT=true` 的部署将不再外发企业微信。
  3. 响应体不再有 `queue_size` / `duplicate`，改读响应头。
- **未验证**：真实 PDF 下载与 HiAgent 摘要链路（依赖外网与凭据）、Memos/Blinko/企业微信真实分发、systemd 部署与 24 小时 TTL 的真实跨重启行为。
- **偏差**：原计划 P1-3 考虑移除 `_skipped`，实际改为保留 `stages.upload` 兼容并新增 `distribution`——直接移除会打断 telegram-bot 等既有消费方，属于不必要的破坏性变更。

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
