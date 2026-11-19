import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

/**
 * General API Rate Limiter
 * Protects endpoints from denial-of-service floods
 */
export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  skip: (req) => process.env.NODE_ENV === 'test' || (process.env.NODE_ENV === 'development' && (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1')),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again after 15 minutes.',
  },
});

/**
 * Strict Rate Limiter for Authentication / Login
 * Prevents password brute-forcing
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.rateLimit.authMax || 100,
  skip: (req) => process.env.NODE_ENV === 'test' || (process.env.NODE_ENV === 'development' && (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1')),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login attempts. Please wait 15 minutes before trying again.',
  },
});

/**
 * Specialized AI Query Rate Limiter
 * Protects Gemini API quota, server speech resources, and prevents token drain abuse
 */
export const aiChatRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute sliding window
  max: parseInt(process.env.RATE_LIMIT_AI_MAX_REQUESTS, 10) || 60, // 60 requests/minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'AI query rate limit exceeded. Please wait a moment before asking another question.',
  },
});


