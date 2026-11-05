import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

/**
 * General API Rate Limiter
 * Protects endpoints from denial-of-service floods
 */
export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
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
  max: config.rateLimit.authMax,
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


