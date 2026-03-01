/**
 * Auth Routes
 * 
 * Note: Login is handled in web.ts at POST /login
 * This file only handles /api/logout
 */

import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { handleLogout } from '../../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/logout
 * Logout and clear session
 */
router.post('/logout', (req: AuthRequest, res) => {
  handleLogout(res);
  res.json({ success: true });
});

// Test route added to working file
router.get('/test-in-auth', (req, res) => {
  console.log('[auth.routes.ts] /test-in-auth called!');
  res.json({ message: 'test in auth works!' });
});

export default router;
