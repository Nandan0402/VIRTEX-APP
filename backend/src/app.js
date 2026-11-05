import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { requestLogger } from './middlewares/logger.js';
import { apiRateLimiter } from './middlewares/rateLimiter.js';
import { config } from './config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // HTTP Security Response Headers (OWASP Hardening)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws:;"
    );
    next();
  });

  // Environment-aware CORS configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : null;

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (ESP32 polling, curl, mobile apps, same-origin)
        if (!origin || !allowedOrigins || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('CORS policy: Not allowed by Access-Control-Allow-Origin.'));
      },
      credentials: true,
    })
  );

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging middleware
  app.use(requestLogger);

  // Favicon handler
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  // Direct health route aliases
  app.get('/health', (req, res) => {
    res.redirect('/api/health');
  });

  // Mount API endpoints with rate limiting at both /api and /api/v1 for 100% compatibility
  app.use('/api', apiRateLimiter, apiRoutes);
  app.use('/api/v1', apiRateLimiter, apiRoutes);

  // Serve static frontend assets
  const frontendPath = path.resolve(__dirname, '../../frontend');
  app.use(express.static(frontendPath));

  // Dedicated route for Trainer / Admin Dashboard
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin.html'));
  });

  // Dedicated route for Member Reception Kiosk UI
  app.get('/kiosk', (req, res) => {
    res.sendFile(path.join(frontendPath, 'kiosk.html'));
  });

  // Dedicated route for Master Portal Landing Page
  app.get('/portal', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // Fallback to frontend index.html for SPA-style routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // Centralized Error Handler (Never leak secrets or stack traces)
  app.use(errorHandler);

  return app;
}
