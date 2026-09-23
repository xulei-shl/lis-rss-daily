/**
 * 用户管理路由
 *
 * 所有接口需要 admin 权限。
 */

import { Router } from 'express';
import { requireAuth, requireAdmin, type AuthRequest } from '../../middleware/auth.js';
import { getUsers, createUser, updateUser, deleteUser } from '../users.js';

const router = Router();

// 获取用户列表
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await getUsers();
    res.json({ users });
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取用户列表失败';
    res.status(500).json({ error: message });
  }
});

// 创建用户
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' });
      return;
    }
    const user = await createUser(username, password, role || 'user');
    res.json({ success: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建用户失败';
    res.status(400).json({ error: message });
  }
});

// 更新用户
router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(String(req.params.id), 10);
    await updateUser(userId, req.body);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新用户失败';
    res.status(400).json({ error: message });
  }
});

// 删除用户
router.delete('/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const userId = parseInt(String(req.params.id), 10);
    await deleteUser(userId, req.userId!);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除用户失败';
    res.status(400).json({ error: message });
  }
});

export default router;
