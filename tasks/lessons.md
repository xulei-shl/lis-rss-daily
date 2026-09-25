# Lessons

## Windows 脚本 / 文档

1. **`.bat` 文件不要写中文**：cmd 按系统 ANSI 代码页（GBK）解析批处理文件，`chcp 65001` 在运行时才生效，救不了前面行的解析。UTF-8 中文会被拆成乱码命令（报 `'xxx' is not recognized`）。`.bat` 消息一律用 ASCII；需要中文输出时用 PowerShell（`.ps1`）。
2. **`findstr` 用 `/C:` 匹配含空格的字面量**：`findstr /r ":8007 .*LISTENING"` 中的空格会被当成多个搜索词的分隔符，应写成 `findstr /C:"LISTENING" | findstr /C:":8007 "`。
3. **后台启动必须脱离控制台**：`start /b` 的子进程随父控制台关闭被杀。用 `powershell Start-Process ... -WindowStyle Hidden` 才能在调用方 shell 退出后存活。
4. **杀 Node 服务用 `taskkill /PID <pid> /T /F`**：`pnpm` → `cmd` → `node` 是多层进程树，只杀监听进程会残留父进程占用句柄。

## 本项目启动

5. **启动前先 `pnpm install`**：`node_modules` 缺包时 `pnpm run dev` 报 `ERR_MODULE_NOT_FOUND`（如 `imapflow`）并立即退出，症状像"服务起不来"，根因是依赖不完整。
6. **主端口是 `8007`**：README 中的 `3000` 已过时，以 `.env` 的 `PORT` 为准。
7. **主程序不依赖 ChromaDB**：向量库未启动也能正常起服务（实测 HTTP 200），只有语义检索受影响。
8. **绝对不能起第二个实例**：会触发 SQLite `SQLITE_ERROR` 和 Telegram `Conflict: terminated by other getUpdates request`。启动脚本必须做端口占用检查。
9. **Chroma 1.x 心跳接口是 `/api/v2/heartbeat`**：`/api/v1/heartbeat` 返回 410，排查时别误判为服务未起。
10. **改密钥类 `.env` 配置后必须重启**才生效；数值类非法值会回退默认值，不影响启动。
