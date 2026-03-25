# DeepSearch better-sqlite3 ABI 兼容问题

## 问题描述

DeepSearch CLI 执行时报错：
```
Error: The module '/opt/lis-rss-daily/node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires
NODE_MODULE_VERSION 109.
```

## 根因分析

- 项目使用 pnpm 管理依赖，better-sqlite3 是原生模块
- pnpm 的 monorepo 结构将依赖安装到 `.pnpm` 目录
- 之前用 root 用户执行过 `pnpm install`，导致二进制文件由 root 编译
- 系统实际运行的用户是 xulei，Node 版本不同导致 ABI 不兼容

## 修复方法

```bash
# 使用当前运行服务的同一用户重新编译 better-sqlite3
cd /opt/lis-rss-daily
pnpm rebuild better-sqlite3
```

## 预防措施

1. 确保所有依赖安装和编译使用相同的用户（xulei）
2. 避免用 root 用户执行 pnpm install/rebuild
3. 可以考虑在 package.json 中添加 postinstall 脚本自动处理

## 相关配置

- DeepSearch API 地址：`/opt/lis-rss-daily/src/config.ts`
- 环境变量：`DEEPSEARCH_API_URL`