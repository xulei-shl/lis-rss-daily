/**
 * 用户管理 API
 *
 * 提供用户的 CRUD 操作，仅 admin 可访问。
 */

import { getDb } from '../db.js';
import { hashPassword } from '../middleware/auth.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'users-api' });

/**
 * 获取所有用户列表
 */
export async function getUsers() {
  const db = getDb();
  const users = await db
    .selectFrom('users')
    .select(['id', 'username', 'role', 'created_at', 'updated_at'])
    .orderBy('id', 'asc')
    .execute();
  return users;
}

/**
 * 创建用户
 */
export async function createUser(
  username: string,
  password: string,
  role: 'admin' | 'user' | 'guest' = 'user'
) {
  const db = getDb();

  // 检查用户名是否已存在
  const existing = await db
    .selectFrom('users')
    .where('username', '=', username)
    .selectAll()
    .executeTakeFirst();

  if (existing) {
    throw new Error('用户名已存在');
  }

  const passwordHash = hashPassword(password);

  const result = await db
    .insertInto('users')
    .values({
      username,
      password_hash: passwordHash,
      role,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .executeTakeFirst();

  const userId = Number(result.insertId);
  log.info({ userId, username, role }, '用户创建成功');

  return { id: userId, username, role };
}

/**
 * 更新用户信息
 */
export async function updateUser(
  userId: number,
  data: { username?: string; password?: string; role?: 'admin' | 'user' | 'guest' }
) {
  const db = getDb();

  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (data.username) {
    // 检查用户名是否被其他人使用
    const existing = await db
      .selectFrom('users')
      .where('username', '=', data.username)
      .where('id', '!=', userId)
      .selectAll()
      .executeTakeFirst();

    if (existing) {
      throw new Error('用户名已被占用');
    }
    updateData.username = data.username;
  }

  if (data.password) {
    updateData.password_hash = hashPassword(data.password);
  }

  if (data.role) {
    updateData.role = data.role;
  }

  await db
    .updateTable('users')
    .set(updateData)
    .where('id', '=', userId)
    .execute();

  log.info({ userId }, '用户更新成功');
}

/**
 * 删除用户
 */
export async function deleteUser(userId: number, currentUserId: number) {
  if (userId === currentUserId) {
    throw new Error('不能删除自己的账号');
  }

  // 不允许删除 id=1 的 admin
  if (userId === 1) {
    throw new Error('不能删除默认管理员账号');
  }

  const db = getDb();
  await db
    .deleteFrom('users')
    .where('id', '=', userId)
    .execute();

  log.info({ userId }, '用户删除成功');
}
