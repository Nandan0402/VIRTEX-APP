/**
 * logger.js - Structured HTTP Request Logger Middleware
 */

export function requestLogger(req, res, next) {
  const start = Date.now();
  
  // Listen for response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    
    // Do not log static asset noise or favicon
    if (req.originalUrl.startsWith('/css') || req.originalUrl.startsWith('/js') || req.originalUrl === '/favicon.ico') {
      return;
    }

    const logPrefix = `[HTTP] ${req.method} ${req.originalUrl} ${status} (${duration}ms)`;
    if (status >= 500) {
      console.error(`${logPrefix} - Server Error`);
    } else if (status >= 400) {
      console.warn(`${logPrefix} - Client Error`);
    } else {
      console.log(logPrefix);
    }
  });

  next();
}

