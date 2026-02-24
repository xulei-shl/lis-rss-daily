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
export type UserRole = 'admin' | 'guest';

/**
 * Role hierarchy for permission checking
 */
const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 2,
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
  // Set effectiveUserId: guest users read admin's data (user_id=1), others use their own
  req.effectiveUserId = payload.role === 'guest' ? 1 : (payload.userId || 1);
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
      req.effectiveUserId = payload.role === 'guest' ? 1 : (payload.userId || 1);
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
 * Login handler
 */
export async function handleLogin(
  username: string,
  password: string,
  res: Response
): Promise<LoginResult> {
  const { getDb } = await import('../db.js');
  const db = getDb();

  // Get user from database
  const user = await db
    .selectFrom('users')
    .where('username', '=', username)
    .selectAll()
    .executeTakeFirst();

  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }

  // Get the role
  const role = (user as any).role || 'admin';

  // Verify password
  const passwordValid = await verifyPassword(password, user.password_hash);
  
  if (!passwordValid) {
    return { success: false, error: 'Invalid username or password' };
  }

  const token = createToken(user.id, user.username, role);
  setSessionCookie(res, token);

  return { success: true, role };
}

/**
 * Logout handler
 */
export function handleLogout(res: Response): void {
  clearSessionCookie(res);
}

/**
 * CLI authentication middleware
 */
export async function requireCliAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const cliApiKey = process.env.CLI_API_KEY;

  if (!cliApiKey) {
    res.status(500).json({ status: 'error', error: 'CLI_API_KEY not configured on server' });
    return;
  }

  const userIdStr = req.query.user_id as string;
  if (!userIdStr) {
    res.status(400).json({ status: 'error', error: 'Missing user_id parameter' });
    return;
  }

  const userId = parseInt(userIdStr, 10);
  if (isNaN(userId)) {
    res.status(400).json({ status: 'error', error: 'Invalid user_id parameter' });
    return;
  }

  const apiKeyQuery = req.query.api_key as string;
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const providedApiKey = apiKeyQuery || apiKeyHeader;

  if (!providedApiKey) {
    res.status(401).json({ status: 'error', error: 'Missing api_key' });
    return;
  }

  if (providedApiKey !== cliApiKey) {
    res.status(401).json({ status: 'error', error: 'Invalid api_key' });
    return;
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
      res.status(404).json({ status: 'error', error: 'User not found' });
      return;
    }

    req.userId = userId;
    req.user = { id: userId, username: user.username };
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database error';
    res.status(500).json({ status: 'error', error: message });
  }
}
