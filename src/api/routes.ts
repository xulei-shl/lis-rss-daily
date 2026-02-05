/**
 * API Routes
 *
 * Express router for all API endpoints.
 * Includes RSS sources management and authentication.
 */

import express from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, handleLogin, handleLogout } from '../middleware/auth.js';
import * as rssSourceService from './rss-sources.js';
import * as topicDomainService from './topic-domains.js';
import * as topicKeywordService from './topic-keywords.js';
import * as llmConfigService from './llm-configs.js';
import * as articleService from './articles.js';
import * as articleProcessService from './article-process.js';
import { getRSSParser } from '../rss-parser.js';
import { getDb } from '../db.js';
import { initRSSScheduler } from '../rss-scheduler.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'api-routes' });

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

// ============================================================================
// RSS Sources Routes
// ============================================================================

/**
 * GET /api/rss-sources
 * Get user's RSS sources (paginated)
 */
router.get('/rss-sources', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as 'active' | 'inactive' | undefined;

    const result = await rssSourceService.getUserRSSSources(req.userId!, {
      page,
      limit,
      status,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get RSS sources');
    res.status(500).json({ error: 'Failed to get RSS sources' });
  }
});

/**
 * GET /api/rss-sources/:id
 * Get single RSS source by ID
 */
router.get('/rss-sources/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }

    const source = await rssSourceService.getRSSSourceById(id, req.userId!);

    if (!source) {
      return res.status(404).json({ error: 'RSS source not found' });
    }

    res.json(source);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get RSS source');
    res.status(500).json({ error: 'Failed to get RSS source' });
  }
});

/**
 * POST /api/rss-sources
 * Create a new RSS source
 */
router.post('/rss-sources', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, url, fetchInterval, status } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Check if URL already exists
    const exists = await rssSourceService.checkURLExists(req.userId!, url.trim());
    if (exists) {
      return res.status(400).json({ error: 'URL already exists' });
    }

    const result = await rssSourceService.createRSSSource(req.userId!, {
      name: name.trim(),
      url: url.trim(),
      fetchInterval: fetchInterval ? parseInt(fetchInterval) : undefined,
      status,
    });

    res.status(201).json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to create RSS source');
    res.status(500).json({ error: 'Failed to create RSS source' });
  }
});

/**
 * PUT /api/rss-sources/:id
 * Update RSS source
 */
router.put('/rss-sources/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }

    const { name, url, fetchInterval, status } = req.body;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      updateData.name = name.trim();
    }

    if (url !== undefined) {
      if (typeof url !== 'string' || url.trim().length === 0) {
        return res.status(400).json({ error: 'URL cannot be empty' });
      }
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }

      // Check if new URL already exists (excluding current source)
      const exists = await rssSourceService.checkURLExists(req.userId!, url.trim(), id);
      if (exists) {
        return res.status(400).json({ error: 'URL already exists' });
      }

      updateData.url = url.trim();
    }

    if (fetchInterval !== undefined) {
      const interval = parseInt(fetchInterval);
      if (isNaN(interval) || interval < 60) {
        return res.status(400).json({ error: 'Fetch interval must be at least 60 seconds' });
      }
      updateData.fetchInterval = interval;
    }

    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ error: 'Status must be "active" or "inactive"' });
      }
      updateData.status = status;
    }

    await rssSourceService.updateRSSSource(id, req.userId!, updateData);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'RSS source not found') {
      return res.status(404).json({ error: 'RSS source not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to update RSS source');
    res.status(500).json({ error: 'Failed to update RSS source' });
  }
});

/**
 * DELETE /api/rss-sources/:id
 * Delete RSS source
 */
router.delete('/rss-sources/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }

    await rssSourceService.deleteRSSSource(id, req.userId!);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'RSS source not found') {
      return res.status(404).json({ error: 'RSS source not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete RSS source');
    res.status(500).json({ error: 'Failed to delete RSS source' });
  }
});

/**
 * POST /api/rss-sources/:id/fetch
 * Trigger immediate fetch of RSS source
 */
router.post('/rss-sources/:id/fetch', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid RSS source ID' });
    }

    const scheduler = initRSSScheduler();
    const result = await scheduler.fetchSourceNow(id, req.userId!);

    res.json({
      success: result.success,
      articlesCount: result.articlesCount,
      newArticlesCount: result.newArticlesCount,
      error: result.error,
      duration: result.duration,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'RSS source not found') {
      return res.status(404).json({ error: 'RSS source not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to fetch RSS source');
    res.status(500).json({ error: 'Failed to fetch RSS source' });
  }
});

/**
 * POST /api/rss-sources/validate
 * Validate RSS source URL
 */
router.post('/rss-sources/validate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const trimmedUrl = url.trim();

    try {
      new URL(trimmedUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const parser = getRSSParser();
    const result = await parser.validateSource(trimmedUrl);

    if (result.valid) {
      res.json({
        valid: true,
        feedTitle: result.feedTitle,
        itemCount: result.itemCount,
      });
    } else {
      res.json({
        valid: false,
        error: result.error,
      });
    }
  } catch (error) {
    log.error({ error }, 'Failed to validate RSS source');
    res.status(500).json({ error: 'Failed to validate RSS source' });
  }
});

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

// ============================================================================
// LLM Configs Routes
// ============================================================================

/**
 * GET /api/llm-configs
 * Get user's LLM configurations (paginated)
 */
router.get('/llm-configs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const provider = req.query.provider as string | undefined;

    const result = await llmConfigService.getUserLLMConfigs(req.userId!, {
      page,
      limit,
      provider,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get LLM configs');
    res.status(500).json({ error: 'Failed to get LLM configs' });
  }
});

/**
 * GET /api/llm-configs/default
 * Get default LLM configuration
 */
router.get('/llm-configs/default', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbConfig = await llmConfigService.getDefaultLLMConfig(req.userId!);

    if (!dbConfig) {
      return res.status(404).json({ error: 'No default LLM config found' });
    }

    // Return safe config without API key
    res.json({
      id: dbConfig.id,
      user_id: dbConfig.user_id,
      provider: dbConfig.provider,
      base_url: dbConfig.base_url,
      model: dbConfig.model,
      is_default: dbConfig.is_default,
      timeout: dbConfig.timeout,
      max_retries: dbConfig.max_retries,
      max_concurrent: dbConfig.max_concurrent,
      created_at: dbConfig.created_at,
      updated_at: dbConfig.updated_at,
      has_api_key: true,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get default LLM config');
    res.status(500).json({ error: 'Failed to get default LLM config' });
  }
});

/**
 * GET /api/llm-configs/:id
 * Get single LLM config by ID
 */
router.get('/llm-configs/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid LLM config ID' });
    }

    const config = await llmConfigService.getSafeLLMConfigById(id, req.userId!);

    if (!config) {
      return res.status(404).json({ error: 'LLM config not found' });
    }

    res.json(config);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get LLM config');
    res.status(500).json({ error: 'Failed to get LLM config' });
  }
});

/**
 * POST /api/llm-configs
 * Create a new LLM configuration
 */
router.post('/llm-configs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const {
      provider,
      baseURL,
      apiKey,
      model,
      isDefault,
      timeout,
      maxRetries,
      maxConcurrent,
    } = req.body;

    // Validation
    if (!provider || typeof provider !== 'string') {
      return res.status(400).json({ error: 'Provider is required' });
    }

    if (!['openai', 'gemini', 'custom'].includes(provider)) {
      return res.status(400).json({ error: 'Provider must be openai, gemini, or custom' });
    }

    if (!baseURL || typeof baseURL !== 'string' || baseURL.trim().length === 0) {
      return res.status(400).json({ error: 'Base URL is required' });
    }

    try {
      new URL(baseURL);
    } catch {
      return res.status(400).json({ error: 'Invalid base URL format' });
    }

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({ error: 'API key is required' });
    }

    if (!model || typeof model !== 'string' || model.trim().length === 0) {
      return res.status(400).json({ error: 'Model is required' });
    }

    if (timeout !== undefined && (isNaN(parseInt(timeout)) || parseInt(timeout) < 1000)) {
      return res.status(400).json({ error: 'Timeout must be at least 1000ms' });
    }

    if (maxRetries !== undefined && (isNaN(parseInt(maxRetries)) || parseInt(maxRetries) < 0)) {
      return res.status(400).json({ error: 'Max retries must be a non-negative number' });
    }

    if (maxConcurrent !== undefined && (isNaN(parseInt(maxConcurrent)) || parseInt(maxConcurrent) < 1)) {
      return res.status(400).json({ error: 'Max concurrent must be at least 1' });
    }

    const result = await llmConfigService.createLLMConfig(req.userId!, {
      provider: provider as 'openai' | 'gemini' | 'custom',
      baseURL: baseURL.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
      isDefault,
      timeout: timeout ? parseInt(timeout) : undefined,
      maxRetries: maxRetries ? parseInt(maxRetries) : undefined,
      maxConcurrent: maxConcurrent ? parseInt(maxConcurrent) : undefined,
    });

    res.status(201).json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to create LLM config');
    res.status(500).json({ error: 'Failed to create LLM config' });
  }
});

/**
 * PUT /api/llm-configs/:id
 * Update LLM configuration
 */
router.put('/llm-configs/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid LLM config ID' });
    }

    const {
      provider,
      baseURL,
      apiKey,
      model,
      isDefault,
      timeout,
      maxRetries,
      maxConcurrent,
    } = req.body;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};

    if (provider !== undefined) {
      if (typeof provider !== 'string' || !['openai', 'gemini', 'custom'].includes(provider)) {
        return res.status(400).json({ error: 'Provider must be openai, gemini, or custom' });
      }
      updateData.provider = provider;
    }

    if (baseURL !== undefined) {
      if (typeof baseURL !== 'string' || baseURL.trim().length === 0) {
        return res.status(400).json({ error: 'Base URL cannot be empty' });
      }
      try {
        new URL(baseURL);
      } catch {
        return res.status(400).json({ error: 'Invalid base URL format' });
      }
      updateData.baseURL = baseURL.trim();
    }

    if (apiKey !== undefined) {
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return res.status(400).json({ error: 'API key cannot be empty' });
      }
      updateData.apiKey = apiKey.trim();
    }

    if (model !== undefined) {
      if (typeof model !== 'string' || model.trim().length === 0) {
        return res.status(400).json({ error: 'Model cannot be empty' });
      }
      updateData.model = model.trim();
    }

    if (isDefault !== undefined) {
      if (typeof isDefault !== 'boolean') {
        return res.status(400).json({ error: 'isDefault must be a boolean' });
      }
      updateData.isDefault = isDefault;
    }

    if (timeout !== undefined) {
      const timeoutNum = parseInt(timeout);
      if (isNaN(timeoutNum) || timeoutNum < 1000) {
        return res.status(400).json({ error: 'Timeout must be at least 1000ms' });
      }
      updateData.timeout = timeoutNum;
    }

    if (maxRetries !== undefined) {
      const retriesNum = parseInt(maxRetries);
      if (isNaN(retriesNum) || retriesNum < 0) {
        return res.status(400).json({ error: 'Max retries must be a non-negative number' });
      }
      updateData.maxRetries = retriesNum;
    }

    if (maxConcurrent !== undefined) {
      const concurrentNum = parseInt(maxConcurrent);
      if (isNaN(concurrentNum) || concurrentNum < 1) {
        return res.status(400).json({ error: 'Max concurrent must be at least 1' });
      }
      updateData.maxConcurrent = concurrentNum;
    }

    await llmConfigService.updateLLMConfig(id, req.userId!, updateData);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'LLM config not found') {
      return res.status(404).json({ error: 'LLM config not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to update LLM config');
    res.status(500).json({ error: 'Failed to update LLM config' });
  }
});

/**
 * DELETE /api/llm-configs/:id
 * Delete LLM configuration
 */
router.delete('/llm-configs/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid LLM config ID' });
    }

    await llmConfigService.deleteLLMConfig(id, req.userId!);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'LLM config not found') {
      return res.status(404).json({ error: 'LLM config not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete LLM config');
    res.status(500).json({ error: 'Failed to delete LLM config' });
  }
});

/**
 * POST /api/llm-configs/:id/set-default
 * Set LLM config as default
 */
router.post('/llm-configs/:id/set-default', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid LLM config ID' });
    }

    await llmConfigService.setDefaultLLMConfig(id, req.userId!);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'LLM config not found') {
      return res.status(404).json({ error: 'LLM config not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to set default LLM config');
    res.status(500).json({ error: 'Failed to set default LLM config' });
  }
});

/**
 * POST /api/llm-configs/:id/test
 * Test LLM connection
 */
router.post('/llm-configs/:id/test', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid LLM config ID' });
    }

    const result = await llmConfigService.testLLMConnection(id, req.userId!);

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to test LLM connection');
    res.status(500).json({ error: 'Failed to test LLM connection' });
  }
});

// ============================================================================
// Filter Routes
// ============================================================================

/**
 * POST /api/filter/article
 * Filter a single article
 */
router.post('/filter/article', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { articleId, title, description, content } = req.body;

    if (!articleId || isNaN(parseInt(articleId))) {
      return res.status(400).json({ error: 'Article ID is required' });
    }

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Dynamic import to avoid circular dependency
    const { filterArticle } = await import('../filter.js');

    const result = await filterArticle({
      articleId: parseInt(articleId),
      userId: req.userId!,
      title,
      description: description || '',
      content,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to filter article');
    res.status(500).json({ error: 'Failed to filter article' });
  }
});

/**
 * GET /api/filter/logs
 * Get filter logs (paginated)
 */
router.get('/filter/logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const domainId = req.query.domainId ? parseInt(req.query.domainId as string) : undefined;
    const isPassed = req.query.isPassed;

    let query = db
      .selectFrom('article_filter_logs')
      .innerJoin('articles', 'articles.id', 'article_filter_logs.article_id')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!);

    if (domainId !== undefined && !isNaN(domainId)) {
      query = query.where('article_filter_logs.domain_id', '=', domainId);
    }

    if (isPassed !== undefined) {
      const passed = isPassed === 'true';
      query = query.where('article_filter_logs.is_passed', '=', passed ? 1 : 0);
    }

    // Get total count
    const totalCountResult = await query
      .select((eb) => eb.fn.count('article_filter_logs.id').as('count'))
      .executeTakeFirst();

    const total = Number(totalCountResult?.count ?? 0);

    // Get paginated results with article title
    const logs = await query
      .selectAll('article_filter_logs')
      .select('articles.title as article_title')
      .orderBy('article_filter_logs.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    res.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get filter logs');
    res.status(500).json({ error: 'Failed to get filter logs' });
  }
});

/**
 * GET /api/filter/stats
 * Get filter statistics
 */
router.get('/filter/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    // Dynamic import to avoid circular dependency
    const { getFilterStats } = await import('../filter.js');

    const stats = await getFilterStats(req.userId!);

    res.json(stats);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get filter stats');
    res.status(500).json({ error: 'Failed to get filter stats' });
  }
});

// ============================================================================
// Scheduler Routes
// ============================================================================

/**
 * POST /api/rss-sources/fetch-all
 * Trigger immediate fetch of all RSS sources
 */
router.post('/rss-sources/fetch-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scheduler = initRSSScheduler();
    const results = await scheduler.fetchAllNow();

    const successCount = results.filter((r) => r.success).length;
    const totalArticles = results.reduce((sum, r) => sum + r.articlesCount, 0);
    const newArticles = results.reduce((sum, r) => sum + r.newArticlesCount, 0);

    res.json({
      success: true,
      totalTasks: results.length,
      successCount,
      failedCount: results.length - successCount,
      totalArticles,
      newArticles,
      results: results.map((r) => ({
        rssSourceId: r.rssSourceId,
        success: r.success,
        articlesCount: r.articlesCount,
        newArticlesCount: r.newArticlesCount,
        error: r.error,
      })),
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to fetch all RSS sources');
    res.status(500).json({ error: 'Failed to fetch RSS sources' });
  }
});

/**
 * GET /api/scheduler/status
 * Get scheduler status
 */
router.get('/scheduler/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scheduler = initRSSScheduler();
    const status = scheduler.getStatus();

    res.json(status);
  } catch (error) {
    log.error({ error }, 'Failed to get scheduler status');
    res.status(500).json({ error: 'Failed to get scheduler status' });
  }
});

// ============================================================================
// Articles Routes
// ============================================================================

/**
 * GET /api/articles
 * Get user articles with pagination
 */
router.get('/articles', requireAuth, async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const rssSourceId = req.query.rssSourceId
      ? parseInt(req.query.rssSourceId as string)
      : undefined;
    const filterStatus = req.query.filterStatus as
      | 'pending'
      | 'passed'
      | 'rejected'
      | undefined;
    const processStatus = req.query.processStatus as
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | undefined;
    const searchQuery = req.query.search as string | undefined;

    const result = await articleService.getUserArticles(req.userId!, {
      page,
      limit,
      rssSourceId,
      filterStatus,
      processStatus,
      search: searchQuery,
    });

    res.json(result);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get articles');
    res.status(500).json({ error: 'Failed to get articles' });
  }
});

/**
 * GET /api/articles/stats
 * Get article statistics for the homepage
 */
router.get('/articles/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const db = getDb();

    // Get today's new articles count (using UTC to match database)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayCountResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.created_at', '>=', today.toISOString())
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const todayNew = Number(todayCountResult?.count || 0);

    // Get pending articles count
    const pendingResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.process_status', '=', 'pending')
      .where('articles.filter_status', '=', 'passed')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const pending = Number(pendingResult?.count || 0);

    // Get analyzed articles count
    const analyzedResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.process_status', '=', 'completed')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const analyzed = Number(analyzedResult?.count || 0);

    // Get pass rate
    const totalResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '!=', 'pending')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const passedResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '=', 'passed')
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const total = Number(totalResult?.count || 0);
    const passed = Number(passedResult?.count || 0);
    const passRate = total > 0 ? passed / total : 0;

    res.json({
      todayNew,
      pending,
      analyzed,
      passRate,
      total,
      passed,
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get article stats');
    res.status(500).json({ error: 'Failed to get article stats' });
  }
});

/**
 * GET /api/articles/:id
 * Get single article by ID
 */
router.get('/articles/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    const article = await articleService.getArticleById(id, req.userId!);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json(article);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get article');
    res.status(500).json({ error: 'Failed to get article' });
  }
});

/**
 * DELETE /api/articles/:id
 * Delete article by ID
 */
router.delete('/articles/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    await articleService.deleteArticle(id, req.userId!);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Article not found') {
      return res.status(404).json({ error: 'Article not found' });
    }
    log.error({ error, userId: req.userId }, 'Failed to delete article');
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

// ============================================================================
// Article Process Routes
// ============================================================================

/**
 * POST /api/articles/:id/process
 * Trigger processing for a single article
 */
router.post('/articles/:id/process', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.triggerProcess(req, res);
});

/**
 * POST /api/articles/process-batch
 * Trigger batch processing for pending or failed articles
 */
router.post('/articles/process-batch', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.triggerBatchProcess(req, res);
});

/**
 * POST /api/articles/:id/retry
 * Retry a single failed article
 */
router.post('/articles/:id/retry', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.retryArticle(req, res);
});

/**
 * GET /api/articles/process-stats
 * Get processing statistics for a user
 */
router.get('/articles/process-stats', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.getProcessStats(req, res);
});

/**
 * GET /api/articles/pending
 * Get pending articles for processing
 */
router.get('/articles/pending', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.getPendingArticles(req, res);
});

/**
 * GET /api/articles/failed
 * Get failed articles for retry
 */
router.get('/articles/failed', requireAuth, async (req: AuthRequest, res) => {
  await articleProcessService.getFailedArticles(req, res);
});

/**
 * GET /api/articles/:id/related
 * Get related articles based on tags and content
 */
router.get('/articles/:id/related', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    const db = getDb();

    // Get the article's tags
    const article = await db
      .selectFrom('articles')
      .where('articles.id', '=', id)
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .select(['articles.tags', 'articles.title'])
      .executeTakeFirst();

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Get related articles by tags
    const related = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.id', '!=', id)
      .where('articles.filter_status', '=', 'passed')
      .selectAll()
      .orderBy('articles.published_at', 'desc')
      .limit(5)
      .execute();

    res.json(related);
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to get related articles');
    res.status(500).json({ error: 'Failed to get related articles' });
  }
});

/**
 * GET /api/search
 * Search articles by title or content
 *
 * Query parameters:
 * - q: search query (required)
 * - mode: 'semantic' | 'keyword' (default: 'keyword')
 * - page: page number (default: 1)
 * - limit: results per page (default: 10)
 *
 * Phase 8: Added QMD semantic search support
 */
router.get('/search', requireAuth, async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    const mode = (req.query.mode as string) || 'keyword';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Phase 8: Use QMD semantic search when mode=semantic
    if (mode === 'semantic') {
      try {
        const { searchArticlesWithQMD } = await import('../search.js');
        const results = await searchArticlesWithQMD(query.trim(), limit, req.userId);

        res.json({
          results,
          mode: 'semantic',
          query: query.trim(),
          total: results.length,
          page: 1, // QMD doesn't support pagination
          limit,
          totalPages: 1,
        });
        return;
      } catch (error) {
        log.warn({ error, query }, 'QMD search failed, falling back to keyword search');
        // Fall through to keyword search
      }
    }

    // Keyword search (existing implementation)
    const db = getDb();
    const offset = (page - 1) * limit;
    const searchTerm = `%${query.trim()}%`;

    // Get total count
    const countResult = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '=', 'passed')
      .where((eb) =>
        eb.or([
          eb('articles.title', 'like', searchTerm),
          eb('articles.summary', 'like', searchTerm),
          eb('articles.markdown_content', 'like', searchTerm),
        ])
      )
      .select((eb) => eb.fn.count('articles.id').as('count'))
      .executeTakeFirst();

    const total = Number(countResult?.count || 0);

    // Get search results
    const results = await db
      .selectFrom('articles')
      .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .where('rss_sources.user_id', '=', req.userId!)
      .where('articles.filter_status', '=', 'passed')
      .where((eb) =>
        eb.or([
          eb('articles.title', 'like', searchTerm),
          eb('articles.summary', 'like', searchTerm),
          eb('articles.markdown_content', 'like', searchTerm),
        ])
      )
      .select([
        'articles.id',
        'articles.title',
        'articles.url',
        'articles.summary',
        'articles.published_at',
        'articles.tags',
        'rss_sources.name as rss_source_name',
      ])
      .orderBy('articles.published_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    // Calculate relevance score (simple: title matches are more relevant)
    const resultsWithScore = results.map((article) => {
      let score = 0;
      const title = article.title.toLowerCase();
      const summary = (article.summary || '').toLowerCase();
      const q = query.toLowerCase();

      if (title.includes(q)) score += 0.5;
      if (title.startsWith(q)) score += 0.3;
      if (summary.includes(q)) score += 0.2;

      return {
        ...article,
        relevance: Math.min(score, 1),
        excerpt: article.summary || article.markdown_content?.substring(0, 300) || '',
      };
    });

    // Sort by relevance
    resultsWithScore.sort((a, b) => b.relevance - a.relevance);

    res.json({
      results: resultsWithScore,
      mode: 'keyword',
      query: query.trim(),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    log.error({ error, userId: req.userId }, 'Failed to search articles');
    res.status(500).json({ error: 'Failed to search articles' });
  }
});

export default router;
