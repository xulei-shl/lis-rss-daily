import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import * as topicDomainService from '../topic-domains.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/topic-domains' });

const router = express.Router();

// ============================================================================
// Topic Domains Routes
// ============================================================================

/**
 * GET /api/topic-domains
 * Get user's topic domains (paginated)
 */
router.get('/topic-domains', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const result = await topicDomainService.getUserTopicDomains(req.userId!, {
      page,
      limit,
      isActive,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get topic domains');
    res.status(500).json({ error: 'Failed to get topic domains' });
  }
});

/**
 * GET /api/topic-domains/with-keyword-count
 * Get user's topic domains with keyword count
 */
router.get('/topic-domains/with-keyword-count', requireAuth, async (req: AuthRequest, res) => {
  try {
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const domains = await topicDomainService.getUserTopicDomainsWithKeywordCount(req.userId!, {
      isActive,
    });

    res.json(domains);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get topic domains with keyword count');
    res.status(500).json({ error: 'Failed to get topic domains' });
  }
});

/**
 * GET /api/topic-domains/:id
 * Get single topic domain by ID
 */
router.get('/topic-domains/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid topic domain ID' });
    }

    const domain = await topicDomainService.getTopicDomainById(id, req.userId!);

    if (!domain) {
      return res.status(404).json({ error: 'Topic domain not found' });
    }

    res.json(domain);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get topic domain');
    res.status(500).json({ error: 'Failed to get topic domain' });
  }
});

/**
 * POST /api/topic-domains
 * Create a new topic domain
 */
router.post('/topic-domains', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, description, priority, isActive } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check if name already exists
    const exists = await topicDomainService.checkNameExists(req.userId!, name.trim());
    if (exists) {
      return res.status(400).json({ error: 'Name already exists' });
    }

    const result = await topicDomainService.createTopicDomain(req.userId!, {
      name: name.trim(),
      description: description?.trim() || undefined,
      priority: priority !== undefined ? parseInt(priority) : undefined,
      isActive,
    });

    res.status(201).json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to create topic domain');
    res.status(500).json({ error: 'Failed to create topic domain' });
  }
});

/**
 * PUT /api/topic-domains/:id
 * Update topic domain
 */
router.put('/topic-domains/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid topic domain ID' });
    }

    const { name, description, priority, isActive } = req.body;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }

      // Check if new name already exists (excluding current domain)
      const exists = await topicDomainService.checkNameExists(req.userId!, name.trim(), id);
      if (exists) {
        return res.status(400).json({ error: 'Name already exists' });
      }

      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description.trim() || null;
    }

    if (priority !== undefined) {
      const priorityNum = parseInt(priority);
      if (isNaN(priorityNum)) {
        return res.status(400).json({ error: 'Priority must be a number' });
      }
      updateData.priority = priorityNum;
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be a boolean' });
      }
      updateData.isActive = isActive;
    }

    await topicDomainService.updateTopicDomain(id, req.userId!, updateData);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Topic domain not found') {
      return res.status(404).json({ error: 'Topic domain not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to update topic domain');
    res.status(500).json({ error: 'Failed to update topic domain' });
  }
});

/**
 * DELETE /api/topic-domains/:id
 * Delete topic domain
 */
router.delete('/topic-domains/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid topic domain ID' });
    }

    await topicDomainService.deleteTopicDomain(id, req.userId!);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Topic domain not found') {
      return res.status(404).json({ error: 'Topic domain not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete topic domain');
    res.status(500).json({ error: 'Failed to delete topic domain' });
  }
});

export default router;
