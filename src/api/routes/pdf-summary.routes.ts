import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

const PDF_API_URL = process.env.PDF_SUMMARY_API_URL || 'http://localhost:8081';

router.post('/pdf-summary', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { title, id, push_wechat } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const response = await fetch(`${PDF_API_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, id, push_wechat })
    });

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('PDF summary proxy error:', error);
    res.status(500).json({ error: 'Failed to call PDF summary service' });
  }
});

export default router;
