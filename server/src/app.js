import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { authenticate, requirePerm } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { HttpError } from './utils/http.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import animalRoutes from './routes/animals.js';
import milkRoutes from './routes/milk.js';
import customerRoutes from './routes/customers.js';
import salesRoutes from './routes/sales.js';
import billingRoutes from './routes/billing.js';
import financeRoutes from './routes/finance.js';
import inventoryRoutes from './routes/inventory.js';
import healthRoutes from './routes/health.js';
import breedingRoutes from './routes/breeding.js';
import employeeRoutes from './routes/employees.js';
import taskRoutes from './routes/tasks.js';
import reminderRoutes from './routes/reminders.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import backupRoutes from './routes/backup.js';

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: config.cookieSecure ? [] : null,
        },
      },
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  if (config.corsOrigin) {
    app.use((req, res, next) => {
      if (req.headers.origin === config.corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  // CSRF defence: cookies are SameSite=strict, and every state-changing API call
  // must carry a custom header that browsers never add to cross-site form posts.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'SmartDairy') return next(new HttpError(403, 'Missing request header'));
    next();
  });

  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 100000 : 600, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/api/health-check', (_req, res) => res.json({ ok: true }));

  // Backup restore needs a large body limit, so it is mounted before the normal JSON parser.
  app.use('/api/backup', authenticate, backupRoutes);
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api', authenticate);
  app.use('/api/users', userRoutes);
  app.use('/api', settingsRoutes);
  app.use('/api/dashboard', requirePerm('dashboard.read'), dashboardRoutes);
  app.use('/api/animals', requirePerm('animals.read'), animalRoutes);
  app.use('/api/milk', requirePerm('milk.read'), milkRoutes);
  app.use('/api/customers', requirePerm('customers.read'), customerRoutes);
  app.use('/api/sales', requirePerm('customers.read'), salesRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/inventory', requirePerm('inventory.read'), inventoryRoutes);
  app.use('/api/health', requirePerm('health.read'), healthRoutes);
  app.use('/api/breeding', requirePerm('breeding.read'), breedingRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/tasks', requirePerm('tasks.read'), taskRoutes);
  app.use('/api/reminders', requirePerm('reminders.read'), reminderRoutes);
  app.use('/api/reports', requirePerm('reports.read'), reportRoutes);
  app.use('/api', notFoundHandler);

  // Serve the built React app in production.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '7d', setHeaders: (res, p) => p.endsWith('.html') && res.setHeader('Cache-Control', 'no-cache') }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  app.use(errorHandler);
  return app;
}
