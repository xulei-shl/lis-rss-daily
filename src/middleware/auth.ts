/**
 * Authentication Middleware
 *
 * JWT-based authentication using cookie sessions.
 * Provides authentication for both API routes and page routes.
 */

import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

/**
 * Auth request interface with user info
 */
export interface AuthRequest extends Request {
  userId?: number;
  user?: { id: number; username?: string };
}

const COOKIE_NAME = 'rss_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * JWT payload structure
 */
interface JWTPayload {
  userId: number;
  username?: string;
}

/**
 * Create JWT token for user
 * @param userId - User ID
 * @param username - Username (optional)
 * @returns JWT token
 */
export function createToken(userId: number, username?: string): string {
  const payload: JWTPayload = { userId, username };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Verify JWT token
 * @param token - JWT token string
 * @returns Decoded payload or null
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
 * @param res - Express response
 * @param token - JWT token
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
 * @param res - Express response
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    path: '/',
  });
}

/**
 * Send unauthorized response
 * Returns 401 for API routes, redirects to login for page routes
 */
function sendUnauthorized(req: Request, res: Response): void {
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
  } else {
    res.redirect('/login');
  }
}

/**
 * Require authentication middleware
 * Validates JWT token from cookie and attaches user info to request
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];

  if (!token) {
    return sendUnauthorized(req, res);
  }

  const payload = verifyToken(token);

  if (!payload) {
    return sendUnauthorized(req, res);
  }

  req.userId = payload.userId;
  req.user = { id: payload.userId, username: payload.username };
  next();
}

/**
 * Optional authentication middleware
 * Attaches user info if token is valid, but doesn't require it
 */
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
      req.user = { id: payload.userId, username: payload.username };
    }
  }

  next();
}

/**
 * Login handler
 * @param username - Username
 * @param password - Password
 * @param res - Express response
 * @returns Login result
 */
export async function handleLogin(
  username: string,
  password: string,
  res: Response
): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement actual password verification
  // For now, we'll use a simple check against the database
  // This will be implemented when we add the users table query

  const { getDb } = await import('../db.js');
  const db = getDb();

  const user = await db
    .selectFrom('users')
    .where('username', '=', username)
    .selectAll()
    .executeTakeFirst();

  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }

  // TODO: Add bcrypt password verification
  // For now, we'll do a simple comparison (INSECURE - for development only)
  // if (user.password_hash !== password) {
  //   return { success: false, error: 'Invalid username or password' };
  // }

  const token = createToken(user.id, user.username);
  setSessionCookie(res, token);

  return { success: true };
}

/**
 * Logout handler
 * @param res - Express response
 */
export function handleLogout(res: Response): void {
  clearSessionCookie(res);
}

/**
 * CLI authentication middleware
 * Validates user_id and api_key from query parameters or headers
 * Designed for CLI/script access without cookie-based auth
 */
export async function requireCliAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // Get CLI_API_KEY from environment
  const cliApiKey = process.env.CLI_API_KEY;

  if (!cliApiKey) {
    res.status(500).json({ status: 'error', error: 'CLI_API_KEY not configured on server' });
    return;
  }

  // Get user_id from query parameter
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

  // Get api_key from query parameter or header
  const apiKeyQuery = req.query.api_key as string;
  const apiKeyHeader = req.headers['x-api-key'] as string;
  const providedApiKey = apiKeyQuery || apiKeyHeader;

  if (!providedApiKey) {
    res.status(401).json({ status: 'error', error: 'Missing api_key' });
    return;
  }

  // Verify API key
  if (providedApiKey !== cliApiKey) {
    res.status(401).json({ status: 'error', error: 'Invalid api_key' });
    return;
  }

  // Verify user exists
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

    // Attach user info to request
    req.userId = userId;
    req.user = { id: userId, username: user.username };
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database error';
    res.status(500).json({ status: 'error', error: message });
  }
}
