import express from 'express';
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

const router = express.Router();

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

export default router;
