import express from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import * as llmConfigService from '../llm-configs.js';
import { logger } from '../../logger.js';

const log = logger.child({ module: 'api-routes/llm-configs' });

const router = express.Router();

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
    const configType = req.query.configType as 'llm' | 'embedding' | 'rerank' | undefined;

    const result = await llmConfigService.getUserLLMConfigs(req.userId!, {
      page,
      limit,
      provider,
      configType,
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
      configType,
      enabled,
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

    if (configType !== undefined && !['llm', 'embedding', 'rerank'].includes(configType)) {
      return res.status(400).json({ error: 'configType must be llm, embedding, or rerank' });
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
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
      configType: (configType as 'llm' | 'embedding' | 'rerank') || 'llm',
      enabled: enabled === true,
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
      configType,
      enabled,
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

    if (configType !== undefined) {
      if (typeof configType !== 'string' || !['llm', 'embedding', 'rerank'].includes(configType)) {
        return res.status(400).json({ error: 'configType must be llm, embedding, or rerank' });
      }
      updateData.configType = configType as 'llm' | 'embedding' | 'rerank';
    }

    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      updateData.enabled = enabled;
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

export default router;
