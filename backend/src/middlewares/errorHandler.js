import { config } from '../config/env.js';

/**
 * Centralized Global Error Handler
 * Never leaks database connection strings, passwords, or internal tokens to client
 */
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const rawMessage = err.message || 'Internal Server Error';

  // Server-side logging
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, {
    status,
    message: rawMessage,
    ...(config.env === 'development' && { stack: err.stack }),
  });

  // Client-safe response: In production, sanitize 500 internal errors to prevent information disclosure
  const safeMessage =
    status >= 500 && config.env === 'production'
      ? 'An internal server error occurred. Please contact the front desk.'
      : rawMessage;

  res.status(status).json({
    success: false,
    error: safeMessage,
    ...(config.env === 'development' && { stack: err.stack }),
  });
}
