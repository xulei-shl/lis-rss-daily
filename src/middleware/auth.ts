/**
 * Authentication Middleware
 *
 * JWT-based authentication using cookie sessions.
 * Provides authentication for both API routes and page routes.
 * Supports role-based access control (admin/guest).
 * 
 * Note: Password verification uses a simple comparison for development.
 * For production, consider using proper bcrypt hashing.
 */

import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import crypto from 'crypto';

/**
 * Auth request interface with user info
 */
export interface AuthRequest extends Request {
  userId?: number;
  effectiveUserId?: number;
  user?: { id: number; username?: string; role?: string };
}

/**
 * User roles
 */
export type UserRole = 'admin' | 'user' | 'guest';

/**
 * Role hierarchy for permission checking
 */
const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 3,
  user: 2,
  guest: 1,
};

const COOKIE_NAME = 'rss_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * JWT payload structure
 */
interface JWTPayload {
  userId: number;
  username?: string;
  role?: string;
}

/**
 * Create JWT token for user
 */
export function createToken(userId: number, username?: string, role?: string): string {
  const payload: JWTPayload = { userId, username, role };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Set session cookie
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

/**
 * Clear session cookie
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Require authentication middleware
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  req.userId = payload.userId;
  req.user = { id: payload.userId, username: payload.username, role: payload.role };
  // guest 和 user 角色读取 admin 的数据源（user_id=1），admin 使用自己的 ID
  req.effectiveUserId = payload.role === 'admin' ? (payload.userId || 1) : 1;
  next();
}

/**
 * Optional authentication middleware
 */
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
      req.user = { id: payload.userId, username: payload.username, role: payload.role };
      req.effectiveUserId = payload.role === 'admin' ? (payload.userId || 1) : 1;
    }
  }

  next();
}

/**
 * Check if user has required role or higher
 */
export function hasRole(userRole: string | undefined, requiredRole: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY[userRole as UserRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return userLevel >= requiredLevel;
}

/**
 * Require admin role middleware
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req.user?.role, 'admin')) {
    if (req.path.startsWith('/api/')) {
      res.status(403).json({ error: '权限不足，需要管理员权限' });
      return;
    }
    res.status(403).render('error', {
      pageTitle: '权限不足',
      error: '您没有权限访问此页面',
    });
    return;
  }
  next();
}

/**
 * 要求登录用户角色中间件（user 或 admin 可访问）
 */
export function requireUser(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req.user?.role, 'user')) {
    if (req.path.startsWith('/api/')) {
      res.status(403).json({ error: '权限不足，需要用户权限' });
      return;
    }
    res.status(403).render('error', {
      pageTitle: '权限不足',
      error: '您没有权限访问此页面',
    });
    return;
  }
  next();
}

/**
 * Require write access middleware
 */
export function requireWriteAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req.user?.role, 'admin')) {
    if (req.path.startsWith('/api/')) {
      res.status(403).json({ error: '权限不足，访客用户只能读取数据' });
      return;
    }
    res.status(403).render('error', {
      pageTitle: '权限不足',
      error: '访客用户只能读取数据，无法执行此操作',
    });
    return;
  }
  next();
}

/**
 * Require search summary access middleware
 * Allows guest access if config permits, otherwise requires admin
 */
export function requireSearchSummaryAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  // If config allows guest access, skip permission check
  if (config.searchAiSummaryGuestEnabled) {
    return next();
  }

  // Otherwise, require admin access
  if (!hasRole(req.user?.role, 'admin')) {
    if (req.path.startsWith('/api/')) {
      res.status(403).json({ error: '权限不足，需要管理员权限' });
      return;
    }
    res.status(403).render('error', {
      pageTitle: '权限不足',
      error: '您没有权限访问此页面',
    });
    return;
  }
  next();
}

/**
 * Login result type
 */
export interface LoginResult {
  success: boolean;
  error?: string;
  role?: string;
}

/**
 * Hash password using SHA256 (for development/simple use)
 */
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Verify password against stored hash
 * Supports both bcrypt format ($2a$...) and SHA256 format
 */
async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // If the hash starts with $2a$, it's a bcrypt hash
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    try {
      // Dynamically load bcryptjs
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const bcrypt = require('bcryptjs');
      
      if (typeof bcrypt.compareSync === 'function') {
        return bcrypt.compareSync(password, storedHash);
      } else {
        console.error('[verifyPassword] bcrypt.compareSync is not a function');
        // Fallback: compare with SHA256 of the password
        const sha256Hash = hashPassword(password);
        return sha256Hash === storedHash;
      }
    } catch (error) {
      console.error('[verifyPassword] bcrypt error:', error);
      return false;
    }
  }
  
  // Otherwise, compare as SHA256
  const sha256Hash = hashPassword(password);
  return sha256Hash === storedHash;
}

/**
 * 已通过账号密码校验的用户信息
 */
export interface AuthenticatedUser {
  id: number;
  username: string;
  role: UserRole;
}

/**
 * 校验用户名密码并返回用户信息（不签发 Cookie）
 *
 * 供外部 API 的账号密码鉴权复用：这类调用需要以真实用户身份访问与其绑定的数据
 * （如「我的每日」评分），无法用共享的 CLI API Key 代替用户身份。
 */
export async function authenticateUser(
  username: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const { getDb } = await import('../db.js');
  const db = getDb();

  const user = await db
    .selectFrom('users')
    .where('username', '=', username)
    .selectAll()
    .executeTakeFirst();

  if (!user) return null;

  const role = ((user as any).role || 'admin') as UserRole;
  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) return null;

  return { id: user.id, username: user.username, role };
}

/**
 * Login handler
 */
export async function handleLogin(
  username: string,
  password: string,
  res: Response
): Promise<LoginResult> {
  const user = await authenticateUser(username, password);

  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }

  const token = createToken(user.id, user.username, user.role);
  setSessionCookie(res, token);

  return { success: true, role: user.role };
}

/**
 * Logout handler
 */
export function handleLogout(res: Response): void {
  clearSessionCookie(res);
}

/**
 * CLI / 外部 API 鉴权失败原因
 */
export type CliAuthFailureReason =
  | 'cli_api_key_not_configured'
  | 'missing_user_id'
  | 'invalid_user_id'
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'user_not_found'
  | 'database_error';

/**
 * CLI / 外部 API 鉴权结果
 */
export type CliAuthResult =
  | { ok: true; userId: number; username: string }
  | { ok: false; status: number; reason: CliAuthFailureReason; message: string };

/**
 * CLI / 外部 API 鉴权核心逻辑（user_id + api_key / x-api-key 对 CLI_API_KEY）
 *
 * 只做校验并返回结果，不写响应；由调用方决定错误响应格式：
 * - 站内 CLI 端点沿用 requireCliAuth 的 `{ status: 'error', error }`；
 * - 外部 API 使用统一响应信封（见 api/external-api-response.ts）。
 */
export async function verifyCliAuth(req: AuthRequest): Promise<CliAuthResult> {
  const cliApiKey = process.env.CLI_API_KEY;

  if (!cliApiKey) {
    return { ok: false, status: 500, reason: 'cli_api_key_not_configured', message: 'CLI_API_KEY not configured on server' };
  }

  const userIdStr = req.query.user_id as string;
  if (!userIdStr) {
    return { ok: false, status: 400, reason: 'missing_user_id', message: 'Missing user_id parameter' };
  }

  const userId = parseInt(userIdStr, 10);
  if (isNaN(userId)) {
    return { ok: false, status: 400, reason: 'invalid_user_id', message: 'Invalid user_id parameter' };
  }

  const apiKeyQuery = req.query.api_key as string;
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const providedApiKey = apiKeyQuery || apiKeyHeader;

  if (!providedApiKey) {
    return { ok: false, status: 401, reason: 'missing_api_key', message: 'Missing api_key' };
  }

  if (providedApiKey !== cliApiKey) {
    return { ok: false, status: 401, reason: 'invalid_api_key', message: 'Invalid api_key' };
  }

  try {
    const { getDb } = await import('../db.js');
    const db = getDb();
    const user = await db
      .selectFrom('users')
      .where('id', '=', userId)
      .selectAll()
      .executeTakeFirst();

    if (!user) {
      return { ok: false, status: 404, reason: 'user_not_found', message: 'User not found' };
    }

    return { ok: true, userId, username: user.username };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database error';
    return { ok: false, status: 500, reason: 'database_error', message };
  }
}

/**
 * CLI authentication middleware（保持既有响应格式不变）
 */
export async function requireCliAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const result = await verifyCliAuth(req);

  if (!result.ok) {
    res.status(result.status).json({ status: 'error', error: result.message });
    return;
  }

  req.userId = result.userId;
  req.user = { id: result.userId, username: result.username };
  next();
}
