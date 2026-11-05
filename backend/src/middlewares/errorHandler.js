import { config } from '../config/env.js';
import { formatDatabaseError } from '../config/database.js';

/**
 * Centralized Global Error Handler
 * Never leaks database connection strings, passwords, or internal tokens to client
 */
export function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let rawMessage = err.message || 'Internal Server Error';

  // Detect PostgreSQL driver errors and apply standardized mapping
  if (err.code && (typeof err.code === 'string' && (/^\d{5}$/.test(err.code) || err.code.startsWith('ECONN')))) {
    const formatted = formatDatabaseError(err);
    if (status === 500) status = formatted.statusCode;
    rawMessage = formatted.message;
  }

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
