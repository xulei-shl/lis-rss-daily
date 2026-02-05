/**
 * Web Server
 *
 * Express web server with EJS templating.
 * Serves API routes and frontend pages.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { optionalAuth } from '../middleware/auth.js';
import apiRoutes from './routes.js';

const log = logger.child({ module: 'web-server' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure Express app
 */
export function createApp(): express.Express {
  const app = express();

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const elapsed = Date.now() - startTime;
      log.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          elapsed: `${elapsed}ms`,
        },
        'HTTP request'
      );
    });

    next();
  });

  // API routes
  app.use('/api', apiRoutes);

  // Page routes
  app.get('/login', (req: Request, res: Response) => {
    res.render('login', {
      pageTitle: 'Login - RSS Literature Tracker',
    });
  });

  // Login API route (POST /login)
  app.post('/login', async (req: Request, res: Response) => {
    try {
      const { handleLogin } = await import('../middleware/auth.js');
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
    } catch (error) {
      log.error({ error }, 'Login failed');
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.get('/settings', optionalAuth, (req: any, res: Response) => {
    if (!req.userId) {
      return res.redirect('/login');
    }
    res.render('settings', {
      pageTitle: 'Settings - RSS Literature Tracker',
      user: req.user,
    });
  });

  // Topic management pages
  app.get('/topics', optionalAuth, (req: any, res: Response) => {
    if (!req.userId) {
      return res.redirect('/login');
    }
    res.render('topics', {
      pageTitle: 'Topic Management - RSS Literature Tracker',
      user: req.user,
    });
  });

  app.get('/filter-logs', optionalAuth, (req: any, res: Response) => {
    if (!req.userId) {
      return res.redirect('/login');
    }
    res.render('filter-logs', {
      pageTitle: 'Filter Logs - RSS Literature Tracker',
      user: req.user,
    });
  });

  app.get('/filter-stats', optionalAuth, (req: any, res: Response) => {
    if (!req.userId) {
      return res.redirect('/login');
    }
    res.render('filter-stats', {
      pageTitle: 'Filter Statistics - RSS Literature Tracker',
      user: req.user,
    });
  });

  // Home page - Daily summary
  app.get('/', optionalAuth, (req: any, res: Response) => {
    if (!req.userId) {
      return res.redirect('/login');
    }
    res.render('index', {
      pageTitle: '每日摘要 - RSS Literature Tracker',
      user: req.user,
    });
  });

  // Articles list page
  app.get('/articles', optionalAuth, (req: any, res: Response) => {
    if (!req.userId) {
      return res.redirect('/login');
    }
    res.render('articles', {
      pageTitle: '文章列表 - RSS Literature Tracker',
      user: req.user,
    });
  });

  // Article detail page
  app.get('/articles/:id', optionalAuth, async (req: any, res: Response) => {
    if (!req.userId) {
      return res.redirect('/login');
    }
    // The article detail page will fetch data via API
    res.render('article-detail', {
      pageTitle: '文章详情 - RSS Literature Tracker',
      user: req.user,
    });
  });

  // Search page
  app.get('/search', optionalAuth, (req: any, res: Response) => {
    if (!req.userId) {
      return res.redirect('/login');
    }
    res.render('search', {
      pageTitle: '语义搜索 - RSS Literature Tracker',
      user: req.user,
    });
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error({ error: err.message, stack: err.stack }, 'Unhandled error');

    if (req.path.startsWith('/api/')) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.status(500).render('error', {
        pageTitle: 'Error',
        error: err.message,
      });
    }
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not found' });
    } else {
      res.status(404).render('error', {
        pageTitle: 'Not Found',
        error: 'Page not found',
      });
    }
  });

  return app;
}

/**
 * Start web server
 * @param app - Express app
 * @returns Server instance
 */
export function startServer(app: express.Express): ReturnType<typeof app.listen> {
  const server = app.listen(config.port, () => {
    log.info(`Web server listening on port ${config.port}`);
    log.info(`  > http://localhost:${config.port}`);
  });

  // Graceful shutdown
  server.on('close', () => {
    log.info('Web server closed');
  });

  return server;
}
