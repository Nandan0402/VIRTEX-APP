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

  // Application error codes we set ourselves (e.g. TRAINER_HUB_MIGRATIONS_PENDING) are passed to the client so
  // pages can show "waiting for a database update" instead of a generic failure. PostgreSQL SQLSTATEs never match.
  const appCode = typeof err.code === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(err.code)
    && !err.syscall && !err.code.startsWith('ECONN') && !err.code.startsWith('ERR_') ? err.code : null;

  // Client-safe response: In production, sanitize 500 internal errors to prevent information disclosure
  // (app-coded errors carry messages we wrote, so they are kept).
  const safeMessage =
    status >= 500 && config.env === 'production' && !appCode
      ? 'An internal server error occurred. Please contact the front desk.'
      : rawMessage;

  res.status(status).json({
    success: false,
    error: safeMessage,
    ...(appCode && { code: appCode }),
    ...(config.env === 'development' && { stack: err.stack }),
  });
}
