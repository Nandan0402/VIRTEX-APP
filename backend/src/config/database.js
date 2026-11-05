import pg from 'pg';
import { config } from './env.js';

const { Pool } = pg;

export const pool = new Pool(config.database);

let isConnected = false;

// Monitor connection events
pool.on('connect', () => {
  isConnected = true;
  console.log('[PostgreSQL] Connected to database pool.');
});

pool.on('error', (err) => {
  isConnected = false;
  console.error('[PostgreSQL] Unexpected error on idle database client:', err.message);
});

/**
 * Execute parameterized query safely against the pool
 * @param {string} text - SQL query string
 * @param {Array<any>} params - Query parameters for SQL injection prevention
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (config.env === 'development') {
      console.log(`[SQL Query] (${duration}ms):`, { text, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('[SQL Error]:', { text, error: error.message });
    throw error;
  }
}

/**
 * Check if the database connection is alive
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function checkDatabaseConnection() {
  try {
    await pool.query('SELECT 1 AS heartbeat');
    isConnected = true;
    return { ok: true };
  } catch (err) {
    isConnected = false;
    return { ok: false, error: err.message };
  }
}

export function isDatabaseConnected() {
  return isConnected;
}

