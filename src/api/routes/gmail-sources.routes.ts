import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import * as gmailSourceService from '../gmail-sources.js';
import { initGmailScheduler } from '../../gmail-scheduler.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/gmail-sources' });
const router = express.Router();

router.get('/email-sources', requireAuth, async (req: AuthRequest, res) => {
  try {
    const sources = await gmailSourceService.getEmailSources(req.userId!);
    res.json({ sources });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get email sources');
    res.status(500).json({ error: 'Failed to get email sources' });
  }
});

router.get('/email-sources/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid email source ID' });

    const source = await gmailSourceService.getEmailSourceById(id, req.userId!);
    if (!source) return res.status(404).json({ error: 'Email source not found' });

    res.json(source);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get email source');
    res.status(500).json({ error: 'Failed to get email source' });
  }
});

router.post('/email-sources', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { name, emailAddress, imapPassword, targetSenders, status } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!emailAddress || typeof emailAddress !== 'string' || !emailAddress.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    if (!imapPassword || typeof imapPassword !== 'string' || imapPassword.length < 8) {
      return res.status(400).json({ error: 'App password is required (min 8 characters)' });
    }

    const senders = Array.isArray(targetSenders) ? targetSenders : [];

    const result = await gmailSourceService.createEmailSource(req.userId!, {
      name: name.trim(),
      emailAddress: emailAddress.trim(),
      imapPassword: imapPassword.replace(/\s+/g, ''),
      targetSenders: senders,
      status,
    });

    res.status(201).json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to create email source');
    res.status(500).json({ error: 'Failed to create email source' });
  }
});

router.put('/email-sources/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid email source ID' });

    const { name, emailAddress, imapPassword, targetSenders, status } = req.body;
    const updateData: any = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      updateData.name = name.trim();
    }
    if (emailAddress !== undefined) {
      if (!emailAddress.includes('@')) {
        return res.status(400).json({ error: 'Valid email address is required' });
      }
      updateData.emailAddress = emailAddress.trim();
    }
    if (imapPassword !== undefined) {
      if (imapPassword.length < 8) {
        return res.status(400).json({ error: 'App password must be at least 8 characters' });
      }
      updateData.imapPassword = imapPassword.replace(/\s+/g, '');
    }
    if (targetSenders !== undefined) {
      updateData.targetSenders = Array.isArray(targetSenders) ? targetSenders : [];
    }
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ error: 'Status must be "active" or "inactive"' });
      }
      updateData.status = status;
    }

    await gmailSourceService.updateEmailSource(id, req.userId!, updateData);
    res.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Email source not found') {
      return res.status(404).json({ error: 'Email source not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to update email source');
    res.status(500).json({ error: 'Failed to update email source' });
  }
});

router.delete('/email-sources/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid email source ID' });

    await gmailSourceService.deleteEmailSource(id, req.userId!);
    res.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Email source not found') {
      return res.status(404).json({ error: 'Email source not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete email source');
    res.status(500).json({ error: 'Failed to delete email source' });
  }
});

router.post('/email-sources/test', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { emailAddress, imapPassword: rawPassword } = req.body;
    const imapPassword = rawPassword.replace(/\s+/g, '');

    if (!emailAddress || !imapPassword) {
      return res.status(400).json({ error: 'Email address and password are required' });
    }

    const result = await gmailSourceService.testEmailSourceConnection(emailAddress, imapPassword);
    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to test email connection');
    res.status(500).json({ error: 'Failed to test connection' });
  }
});

router.post('/email-sources/:id/fetch', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid email source ID' });

    const scheduler = initGmailScheduler();
    scheduler.fetchOneNow(id).catch(err => {
      log.error({ error: err, sourceId: id }, 'Manual Gmail fetch error');
    });
    res.json({ success: true, message: 'Gmail fetch triggered' });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to trigger Gmail fetch');
    res.status(500).json({ error: 'Failed to trigger fetch' });
  }
});

router.post('/email-sources/fetch-now', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const scheduler = initGmailScheduler();
    scheduler.fetchAllNow().catch(err => {
      log.error({ error: err }, 'Manual Gmail fetch error');
    });
    res.json({ success: true, message: 'Gmail fetch triggered' });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to trigger Gmail fetch');
    res.status(500).json({ error: 'Failed to trigger fetch' });
  }
});

export default router;
