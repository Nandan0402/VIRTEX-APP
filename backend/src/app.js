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
    // Lets the Google sign-in popup report back to this page (otherwise: "Cross-Origin-Opener-Policy would block window.postMessage").
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    // Exercise media (Member Portal): YouTube still frames + privacy-enhanced embeds only.
    res.setHeader(
      'Content-Security-Policy',
      // Google Sign-In ("Continue with Google") needs its script, button frame, styles and token endpoint.
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://i.ytimg.com https://*.googleusercontent.com; frame-src https://www.youtube-nocookie.com https://accounts.google.com/gsi/; connect-src 'self' ws: https://accounts.google.com/gsi/;"
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

  // Body parsing middleware (supports base64 avatar uploads up to 10MB)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
  app.use(express.static(frontendPath, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));

  // Dedicated route for Trainer / Admin Dashboard
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin.html'));
  });

  // Dedicated route for Admin Profile
  app.get(['/admin-profile', '/profile', '/admin-profile.html'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-profile.html'));
  });

  // Dedicated route for Admin Working Hours & Custom Schedules
  app.get(['/admin-working-hours', '/admin-working-hours.html', '/working-hours', '/hours'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-working-hours.html'));
  });

  // Dedicated route for Admin Calendar / Schedule
  app.get(['/admin-calander', '/admin-calander.html', '/admin-calendar', '/admin-calendar.html', '/calendar', '/calander'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-calander.html'));
  });

  // Dedicated route for Admin Members Directory
  app.get(['/admin-members', '/admin-members.html', '/members'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-members.html'));
  });

  // Dedicated route for Admin Enquiries, Leads & Direct Member Messages
  app.get(['/admin-message', '/admin-message.html', '/messages', '/enquiries', '/leads'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-message.html'));
  });

  // Dedicated route for Admin Personal Trainers Management
  app.get(['/admin-personaltraniner', '/admin-personaltraniner.html', '/admin-personaltrainer', '/admin-personaltrainer.html', '/trainers'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-personaltraniner.html'));
  });

  // Dedicated route for Admin Noticeboard, Announcements & Broadcast Alerts
  app.get(['/admin-notification', '/admin-notification.html', '/notifications', '/announcements'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-notification.html'));
  });

  // Dedicated route for Fees Alert Center
  app.get(['/admin-feessalert', '/admin-feessalert.html', '/admin-feesalert', '/admin-feesalert.html', '/fees-alert', '/fees'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-feessalert.html'));
  });

  // Dedicated route for Birthday Alert Center
  app.get(['/admin-birthdayalert', '/admin-birthdayalert.html', '/birthday-alert', '/birthdays'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-birthdayalert.html'));
  });

  // Dedicated route for Personal Trainer Assignment & Monthly Fees
  app.get([
    '/admin-assign-membertoperonal traniner.html',
    '/admin-assign-membertoperonal%20traniner.html',
    '/admin-assign-membertoperonal-traniner.html',
    '/admin-assign-membertopersonal-trainer.html',
    '/admin-assign-trainer',
    '/admin-assign-trainer.html',
    '/assign-trainer',
    '/assign-pt'
  ], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-assign-membertopersonal-trainer.html'));
  });

  // Dedicated route for Routine & Shift Tracker (Punch In, Break, Punch Out)
  app.get(['/admin-routine-tracker', '/admin-routine-tracker.html', '/routine', '/routine-tracker', '/punch'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-routine-tracker.html'));
  });

  // Dedicated route for Member Reception Kiosk UI
  app.get('/kiosk', (req, res) => {
    res.sendFile(path.join(frontendPath, 'kiosk.html'));
  });

  // Dedicated route for Master Portal Landing Page
  app.get('/portal', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // Dedicated route for Member / Trainer / Admin Authentication Portal
  app.get(['/auth', '/login', '/signup'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'auth.html'));
  });

  app.get(['/member-auth', '/member-login', '/member-signup'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'member-auth.html'));
  });

  app.get(['/trainer-auth', '/trainer-login', '/trainer-signup'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'trainer-auth.html'));
  });

  app.get(['/admin-auth', '/admin-login', '/admin-signup'], (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-auth.html'));
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
