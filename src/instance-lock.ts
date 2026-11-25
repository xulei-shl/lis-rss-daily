/**
 * 主应用跨进程单实例锁
 *
 * 用于保证同一时间只有一个 LIS-RSS 主应用实例在运行。多个实例同时轮询
 * 同一个 Telegram bot token 会让 Telegram 返回 409 Conflict 并踢断长轮询，
 * 表现为 getUpdates 持续 fetch failed / aborted，命令（/getarticles）收不到。
 *
 * 实现：在共享的 data 目录里 bind 一个 Unix domain socket 作为锁。
 * - 唯一性由内核保证：同一路径只能被一个进程 bind 成功（EADDRINUSE）。
 * - 进程退出（含 SIGKILL）后 socket 不再监听；下次启动探测到连接被拒，
 *   清理残留文件后接管，因此不会出现「崩溃即死锁」。
 * - 相比 pid 文件，不依赖 PID 命名空间/pid 复用判断，容器与手动启动混跑时依然有效。
 *
 * Windows 或无法创建 Unix socket 的文件系统上会记录错误并放行启动（不阻塞应用），
 * 此时不具备重复实例保护。
 */

import fs from 'fs';
import net from 'net';
import path from 'path';
import { logger } from './logger.js';

const log = logger.child({ module: 'instance-lock' });

const ACQUIRE_ATTEMPTS = 40;
const ACQUIRE_RETRY_MS = 100;
// 刚创建的 socket 可能是并发启动的竞争者，未被监听时也要等一会才判定为残留
const STALE_SOCKET_MS = 2000;

export interface InstanceLock {
  acquired: true;
  lockPath: string;
  release: () => void;
}

export interface InstanceLockConflict {
  acquired: false;
  lockPath: string;
}

export type InstanceLockResult = InstanceLock | InstanceLockConflict;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 有实例在监听这个 socket 时连接会成功；残留 socket 会直接 ECONNREFUSED */
function isLockedByLiveProcess(lockPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(lockPath);
    const finish = (alive: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

function bindLockSocket(lockPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((connection) => connection.destroy());

    const onError = (error: Error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(lockPath);
  });
}

/**
 * 尝试获取单实例锁。
 *
 * acquired=true 表示拿到锁，调用方应在进程退出前调用 release()；
 * acquired=false 表示已有存活的同应用实例持锁，调用方应退出。
 */
export async function acquireInstanceLock(lockPath: string): Promise<InstanceLockResult> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt++) {
    try {
      const server = await bindLockSocket(lockPath);

      server.on('error', (error) => {
        log.error({ lockPath, error }, '单实例锁监听出错');
      });

      let released = false;
      const release = () => {
        if (released) {
          return;
        }
        released = true;
        // 先删文件再关闭监听：避免关闭后、删除前被新实例 bind 成功后误删它的锁
        try {
          fs.unlinkSync(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            log.warn({ lockPath, error }, '删除单实例锁文件失败');
          }
        }
        server.close();
      };

      log.info({ lockPath, pid: process.pid }, '已获取单实例锁');
      return { acquired: true, lockPath, release };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== 'EADDRINUSE') {
        // 锁基础设施不可用（例如平台不支持 Unix socket）时不能阻塞应用启动
        log.error(
          { lockPath, code, error: (error as Error).message },
          '无法建立单实例锁，继续启动（本次不具备重复实例保护）'
        );
        return { acquired: true, lockPath, release: () => {} };
      }
    }

    if (await isLockedByLiveProcess(lockPath)) {
      return { acquired: false, lockPath };
    }

    // 连不上 => 持有者已退出，留下的是残留 socket
    let socketAgeMs: number;
    try {
      socketAgeMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch {
      // 已被其他进程清理，直接重试
      continue;
    }

    if (socketAgeMs < STALE_SOCKET_MS) {
      await sleep(ACQUIRE_RETRY_MS);
      continue;
    }

    log.warn({ lockPath, socketAgeMs }, '发现残留的单实例锁（持有进程已退出），接管');
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn({ lockPath, error }, '清理残留锁文件失败');
        await sleep(ACQUIRE_RETRY_MS);
      }
    }
  }

  return { acquired: false, lockPath };
}
