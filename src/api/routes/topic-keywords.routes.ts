import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import * as topicKeywordService from '../topic-keywords.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/topic-keywords' });

const router = express.Router();

// ============================================================================
// Topic Keywords Routes
// ============================================================================

/**
 * GET /api/topic-domains/:domainId/keywords
 * Get keywords for a domain (paginated)
 */
router.get('/topic-domains/:domainId/keywords', requireAuth, async (req: AuthRequest, res) => {
  try {
    const domainId = parseInt(req.params.domainId);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    if (isNaN(domainId)) {
      return res.status(400).json({ error: 'Invalid domain ID' });
    }

    const result = await topicKeywordService.getDomainKeywords(domainId, req.userId!, {
      page,
      limit,
      isActive,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Topic domain not found or access denied') {
      return res.status(404).json({ error: 'Topic domain not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to get topic keywords');
    res.status(500).json({ error: 'Failed to get topic keywords' });
  }
});

/**
 * GET /api/topic-keywords/all
 * Get all keywords with domain names
 */
router.get('/topic-keywords/all', requireAuth, async (req: AuthRequest, res) => {
  try {
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const keywords = await topicKeywordService.getAllKeywordsWithDomain(req.userId!, {
      isActive,
    });

    res.json(keywords);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get all topic keywords');
    res.status(500).json({ error: 'Failed to get topic keywords' });
  }
});

/**
 * GET /api/topic-keywords/:id
 * Get single topic keyword by ID
 */
router.get('/topic-keywords/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid topic keyword ID' });
    }

    const keyword = await topicKeywordService.getTopicKeywordWithDomain(id, req.userId!);

    if (!keyword) {
      return res.status(404).json({ error: 'Topic keyword not found' });
    }

    res.json(keyword);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get topic keyword');
    res.status(500).json({ error: 'Failed to get topic keyword' });
  }
});

/**
 * POST /api/topic-keywords
 * Create a new topic keyword
 */
router.post('/topic-keywords', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { domainId, keyword, description, weight, isActive } = req.body;

    // Validation
    if (!domainId || isNaN(parseInt(domainId))) {
      return res.status(400).json({ error: 'Domain ID is required' });
    }

    if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
      return res.status(400).json({ error: 'Keyword is required' });
    }

    const domainIdNum = parseInt(domainId);

    // Check if keyword already exists for this domain
    const exists = await topicKeywordService.checkKeywordExists(domainIdNum, keyword.trim());
    if (exists) {
      return res.status(400).json({ error: 'Keyword already exists for this domain' });
    }

    const result = await topicKeywordService.createTopicKeyword(req.userId!, {
      domainId: domainIdNum,
      keyword: keyword.trim(),
      description: description?.trim() || undefined,
      weight: weight !== undefined ? parseFloat(weight) : undefined,
      isActive,
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Topic domain not found or access denied') {
      return res.status(404).json({ error: 'Topic domain not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to create topic keyword');
    res.status(500).json({ error: 'Failed to create topic keyword' });
  }
});

/**
 * PUT /api/topic-keywords/:id
 * Update topic keyword
 */
router.put('/topic-keywords/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid topic keyword ID' });
    }

    const { keyword, description, weight, isActive } = req.body;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (keyword !== undefined) {
      if (typeof keyword !== 'string' || keyword.trim().length === 0) {
        return res.status(400).json({ error: 'Keyword cannot be empty' });
      }

      // Get current keyword to check domain
      const current = await topicKeywordService.getTopicKeywordById(id, req.userId!);
      if (!current) {
        return res.status(404).json({ error: 'Topic keyword not found' });
      }

      // Check if new keyword already exists for this domain (excluding current keyword)
      const exists = await topicKeywordService.checkKeywordExists(current.domain_id, keyword.trim(), id);
      if (exists) {
        return res.status(400).json({ error: 'Keyword already exists for this domain' });
      }

      updateData.keyword = keyword.trim();
    }

    if (description !== undefined) {
      updateData.description = description.trim() || null;
    }

    if (weight !== undefined) {
      const weightNum = parseFloat(weight);
      if (isNaN(weightNum) || weightNum < 0 || weightNum > 10) {
        return res.status(400).json({ error: 'Weight must be a number between 0 and 10' });
      }
      updateData.weight = weightNum;
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive must be a boolean' });
      }
      updateData.isActive = isActive;
    }

    await topicKeywordService.updateTopicKeyword(id, req.userId!, updateData);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Topic keyword not found or access denied') {
      return res.status(404).json({ error: 'Topic keyword not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to update topic keyword');
    res.status(500).json({ error: 'Failed to update topic keyword' });
  }
});

/**
 * DELETE /api/topic-keywords/:id
 * Delete topic keyword
 */
router.delete('/topic-keywords/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid topic keyword ID' });
    }

    await topicKeywordService.deleteTopicKeyword(id, req.userId!);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Topic keyword not found or access denied') {
      return res.status(404).json({ error: 'Topic keyword not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete topic keyword');
    res.status(500).json({ error: 'Failed to delete topic keyword' });
  }
});

export default router;
