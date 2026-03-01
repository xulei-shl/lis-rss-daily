/**
 * Ping route for testing
 */

import express from 'express';

console.log('[ping.routes.ts] Module loaded!');

const router = express.Router();

router.get('/ping', (req, res) => {
  console.log('[ping.routes.ts] /ping called!');
  res.json({ message: 'pong' });
});

router.get('/test-xyz-123', (req, res) => {
  console.log('[ping.routes.ts] /test-xyz-123 called!');
  res.json({ message: 'test works!' });
});

export default router;
