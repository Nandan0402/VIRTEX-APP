import pg from 'pg';
import { config } from './env.js';

const { Pool } = pg;

let internalPool = null;
let isConnected = false;

/**
 * Creates and initializes the PostgreSQL connection pool using environment credentials
 */
function createPool() {
  const poolConfig = config.database.connectionString
    ? {
        connectionString: config.database.connectionString,
        ssl: config.database.ssl,
        max: config.database.max,
        idleTimeoutMillis: config.database.idleTimeoutMillis,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis,
      }
    : {
        host: config.database.host,
        port: config.database.port,
        database: config.database.database,
        user: config.database.user,
        password: config.database.password,
        ssl: config.database.ssl,
        max: config.database.max,
        idleTimeoutMillis: config.database.idleTimeoutMillis,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis,
      };

  const p = new Pool(poolConfig);

  p.on('connect', () => {
    isConnected = true;
    if (config.env === 'development' && process.env.LOG_SQL_POOL === 'true') {
      console.log('[PostgreSQL] Connected new client to database pool.');
    }
  });

  p.on('error', (err) => {
    isConnected = false;
    console.error('[PostgreSQL] Unexpected error on idle database client:', err.message);
  });

  return p;
}

/**
 * Accessor for the active pool, lazily recreating it if it was drained or closed
 * @returns {pg.Pool}
 */
export function getPool() {
  if (!internalPool || internalPool.ending || internalPool.ended) {
    internalPool = createPool();
  }
  return internalPool;
}

// Proxied export so existing references `pool.query(...)` or `pool.on(...)` dynamically resolve
export const pool = new Proxy({}, {
  get(target, prop) {
    const current = getPool();
    const val = current[prop];
    return typeof val === 'function' ? val.bind(current) : val;
  },
});

/**
 * Pure function to sanitize parameters for query logging
 * Redacts passwords, hashes, tokens, API keys, and sensitive payloads
 * @param {string} text - SQL query text
 * @param {Array<any>} params - Array of parameters
 * @returns {Array<any>} Parameter array with sensitive values replaced by '[REDACTED]'
 */
export function sanitizeLogParams(text, params) {
  if (!params || !Array.isArray(params) || params.length === 0) return [];
  const sensitiveQueryRegex = /password|secret|hash|token|api_key|credential/i;
  const isSensitiveQuery = sensitiveQueryRegex.test(text || '');

  return params.map((param) => {
    if (param === null || param === undefined) return param;
    if (isSensitiveQuery) {
      return '[REDACTED]';
    }
    if (typeof param === 'string' && (param.startsWith('$2a$') || param.startsWith('$2b$') || param.length > 80)) {
      return '[REDACTED]';
    }
    return param;
  });
}

/**
 * Standardize and sanitize PostgreSQL errors into user-friendly responses
 * Never leaks database credentials, connection strings, or system paths
 * @param {Error} error
 * @returns {{ statusCode: number, code: string, message: string }}
 */
export function formatDatabaseError(error) {
  if (!error) {
    return {
      statusCode: 500,
      code: 'UNKNOWN_DB_ERROR',
      message: 'An unexpected database error occurred.',
    };
  }

  // Duplicate key violation (PostgreSQL 23505) or custom duplicate check-in trigger
  if (error.code === '23505' || (error.message && error.message.includes('DUPLICATE_CHECK_IN'))) {
    return {
      statusCode: 409,
      code: 'DUPLICATE_ENTRY',
      message: error.message.includes('DUPLICATE_CHECK_IN')
        ? error.message.replace(/^.*?DUPLICATE_CHECK_IN:\s*/, '')
        : 'A record with these unique details already exists.',
    };
  }

  // Foreign key violation (PostgreSQL 23503)
  if (error.code === '23503') {
    return {
      statusCode: 400,
      code: 'FOREIGN_KEY_VIOLATION',
      message: 'Referenced entity does not exist or is constrained by existing dependencies.',
    };
  }

  // Check constraint violation (PostgreSQL 23514)
  if (error.code === '23514') {
    return {
      statusCode: 400,
      code: 'CHECK_VIOLATION',
      message: 'Submitted data violates database integrity rules.',
    };
  }

  // Not null violation (PostgreSQL 23502)
  if (error.code === '23502') {
    return {
      statusCode: 400,
      code: 'NOT_NULL_VIOLATION',
      message: `Required field '${error.column || 'unknown'}' cannot be null.`,
    };
  }

  // Connection failure (PostgreSQL 08001 / 08006 / ECONNREFUSED)
  if (error.code === '08006' || error.code === '08001' || error.code === 'ECONNREFUSED') {
    return {
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database service is currently unreachable.',
    };
  }

  // Query timeout or cancellation (PostgreSQL 57014)
  if (error.code === '57014') {
    return {
      statusCode: 504,
      code: 'QUERY_TIMEOUT',
      message: 'Database operation timed out.',
    };
  }

  return {
    statusCode: 500,
    code: error.code || 'DB_ERROR',
    message: error.message || 'Database operation failed.',
  };
}

/**
 * Execute a parameterized SQL query safely against the connection pool
 * @param {string} text - SQL statement using $1, $2, ... parameter placeholders
 * @param {Array<any>} [params] - Query parameter values
 * @param {Object} [options] - Options { silent: boolean }
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = [], options = {}) {
  const p = getPool();
  const start = Date.now();
  try {
    const res = await p.query(text, params);
    const duration = Date.now() - start;

    if (!options.silent && (config.env === 'development' || process.env.LOG_SQL === 'true')) {
      const safeParams = sanitizeLogParams(text, params);
      const textFormatted = text.trim();
      console.log(`[SQL Query] (${duration}ms):`, {
        text: textFormatted,
        params: safeParams.length > 0 ? safeParams : undefined,
        rows: res.rowCount,
      });
    }

    return res;
  } catch (error) {
    const duration = Date.now() - start;
    const sanitizedError = formatDatabaseError(error);

    if (config.env === 'development') {
      console.error('[SQL Error]:', {
        text: text.trim().replace(/\s+/g, ' '),
        duration: `${duration}ms`,
        code: error.code,
        error: sanitizedError.message,
      });
    }

    throw error;
  }
}

/**
 * Execute an atomic transaction block with automatic BEGIN, COMMIT, ROLLBACK, and client release.
 * @param {Function} callback - async (client) => { ... }
 * @param {Object} [options] - { isolationLevel: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' }
 * @returns {Promise<any>} Result of callback
 */
export async function withTransaction(callback, options = {}) {
  const p = getPool();
  const client = await p.connect();
  const isolation = options.isolationLevel ? ` ISOLATION LEVEL ${options.isolationLevel}` : '';

  try {
    await client.query(`BEGIN${isolation};`);
    const result = await callback(client);
    await client.query('COMMIT;');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK;');
    } catch (rollbackErr) {
      console.error('[PostgreSQL Transaction] Rollback error:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retrieve current pool connection metrics
 * @returns {{ totalCount: number, idleCount: number, waitingCount: number }}
 */
export function getPoolStats() {
  const p = getPool();
  return {
    totalCount: p.totalCount || 0,
    idleCount: p.idleCount || 0,
    waitingCount: p.waitingCount || 0,
  };
}

/**
 * Check if the database connection is alive and measure latency
 * @returns {Promise<{ ok: boolean, latencyMs?: number, pool: object, pgVersion?: string, serverTime?: Date, error?: string }>}
 */
export async function checkDatabaseConnection() {
  const start = Date.now();
  try {
    const p = getPool();
    const res = await p.query('SELECT 1 AS heartbeat, NOW() AS server_time, version() AS pg_version;');
    const latencyMs = Date.now() - start;
    isConnected = true;

    return {
      ok: true,
      latencyMs,
      pgVersion: res.rows[0]?.pg_version?.split(' ')?.[1] || 'PostgreSQL 18',
      serverTime: res.rows[0]?.server_time,
      pool: getPoolStats(),
    };
  } catch (err) {
    isConnected = false;
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err.message,
      pool: getPoolStats(),
    };
  }
}

/**
 * Check if PostgreSQL connection pool is currently marked connected
 * @returns {boolean}
 */
export function isDatabaseConnected() {
  return isConnected;
}

/**
 * Drain and cleanly close the database connection pool during graceful shutdown
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<void>}
 */
export async function closePool(timeoutMs = 5000) {
  if (internalPool && !internalPool.ending && !internalPool.ended) {
    try {
      const closePromise = internalPool.end();
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, timeoutMs));
      await Promise.race([closePromise, timeoutPromise]);
      console.log('[PostgreSQL] Database connection pool closed gracefully.');
    } catch (err) {
      console.warn('[PostgreSQL] Warning during pool close:', err.message);
    } finally {
      internalPool = null;
      isConnected = false;
    }
  }
}
