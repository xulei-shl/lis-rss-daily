import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { handleLogin, handleLogout } from '../../middleware/auth.js';

const router = express.Router();

// ============================================================================
// Auth Routes
// ============================================================================

/**
 * POST /login
 * Login with username and password
 */
router.post('/login', async (req: AuthRequest, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const result = await handleLogin(username, password, res);

  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: result.error });
  }
});

/**
 * POST /logout
 * Logout and clear session
 */
router.post('/logout', (req: AuthRequest, res) => {
  handleLogout(res);
  res.json({ success: true });
});

export default router;
