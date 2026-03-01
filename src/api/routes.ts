import express from 'express';
import pingRoutes from './routes/ping.routes.js';
import authRoutes from './routes/auth.routes.js';
import rssSourceRoutes from './routes/rss-sources.routes.js';
import topicDomainRoutes from './routes/topic-domains.routes.js';
import topicKeywordsRoutes from './routes/topic-keywords.routes.js';
import llmConfigRoutes from './routes/llm-configs.routes.js';
import filterRoutes from './routes/filter.routes.js';
import schedulerRoutes from './routes/scheduler.routes.js';
import articleRoutes from './routes/articles.routes.js';
import articleProcessRoutes from './routes/article-process.routes.js';
import searchRoutes from './routes/search.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import systemPromptRoutes from './routes/system-prompts.routes.js';
import dailySummaryRoutes from './routes/daily-summary.routes.js';
import typesRoutes from './routes/types.routes.js';
import journalsRoutes from './routes/journals.routes.js';
import logsRoutes from './routes/logs.routes.js';
import blacklistRoutes from './routes/blacklist.routes.js';

console.log('[routes.ts] blacklistRoutes imported:', typeof blacklistRoutes);

const router = express.Router();

router.use(pingRoutes);
router.use(authRoutes);
router.use(rssSourceRoutes);
router.use(topicDomainRoutes);
router.use(topicKeywordsRoutes);
router.use(llmConfigRoutes);
router.use(filterRoutes);
router.use(schedulerRoutes);
router.use(articleRoutes);
router.use(articleProcessRoutes);
router.use(searchRoutes);
router.use(settingsRoutes);
router.use(systemPromptRoutes);
router.use(dailySummaryRoutes);
router.use(typesRoutes);
router.use(journalsRoutes);
router.use(logsRoutes);
console.log('[routes.ts] About to use blacklistRoutes, stack:', blacklistRoutes.stack?.length || 0);
console.log('[routes.ts] blacklistRoutes stack:', blacklistRoutes.stack?.map((l: any) => ({ path: l.path, method: l.methods?.[0] })));
router.use(blacklistRoutes);
console.log('[routes.ts] blacklistRoutes registered');

// Debug: Print all registered routes
router._router?.stack?.forEach((layer: any) => {
  if (layer.name === 'router') {
    console.log('[routes.ts] Subrouter registered:', layer.regexp);
    layer.handle?.stack?.forEach((subLayer: any) => {
      console.log('[routes.ts]   - route:', subLayer.route?.path || subLayer.path, 'methods:', subLayer.route?.methods || subLayer.methods);
    });
  }
});

export default router;
