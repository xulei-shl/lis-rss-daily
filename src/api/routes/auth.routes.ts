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

export default router;
