/**
 * bootstrapSchema.js — first start on a brand-new, EMPTY database (e.g. a fresh hosted PostgreSQL).
 *
 * If the connected database has no tables at all, create the full Virtex structure from
 * database/bootstrap/full_schema.sql (structure only — no members, users or passwords) in ONE transaction.
 * A database that has even one table is never touched. Turn off with AUTO_BOOTSTRAP_SCHEMA=false.
 *
 * Afterwards nobody can sign in yet: the first admin sign-up on admin-auth.html becomes the Owner
 * (only while the database has no users at all — see adminSignup.controller.js).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './database.js';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/bootstrap/full_schema.sql');
const COUNT_TABLES = `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;

/** Outcome of the last start-up check, shown in GET /api/v1/health (no secrets). */
export const bootstrapStatus = { state: 'not-run', detail: null, at: null };
const note = (state, detail) => Object.assign(bootstrapStatus, { state, detail: detail ? String(detail).slice(0, 200) : null, at: new Date().toISOString() });

/** @returns {Promise<{ ran: boolean, reason?: string, tables?: number }>} */
export async function bootstrapEmptyDatabase(pool = getPool()) {
  try {
    const r = await runBootstrap(pool);
    note(r.ran ? 'created' : 'skipped', r.ran ? `${r.tables} tables created` : r.reason);
    return r;
  } catch (err) {
    note('failed', `${err.code ? err.code + ': ' : ''}${err.message}`);
    throw err;
  }
}

async function runBootstrap(pool) {
  if (String(process.env.AUTO_BOOTSTRAP_SCHEMA || '').toLowerCase() === 'false') return { ran: false, reason: 'disabled (AUTO_BOOTSTRAP_SCHEMA=false)' };
  const existing = (await pool.query(COUNT_TABLES)).rows[0].n;
  if (existing > 0) {
    const hasUsers = (await pool.query(`SELECT to_regclass('public.users') IS NOT NULL AS ok`)).rows[0].ok;
    return { ran: false, reason: hasUsers ? 'database already has tables' : `database has ${existing} other table(s) but no Virtex tables — not touched` };
  }
  if (!fs.existsSync(FILE)) return { ran: false, reason: 'database/bootstrap/full_schema.sql is missing from the deploy' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(724519001)');          // two servers starting at once: one does it
    if ((await client.query(COUNT_TABLES)).rows[0].n > 0) { await client.query('ROLLBACK'); return { ran: false, reason: 'created by another process' }; }
    await client.query(fs.readFileSync(FILE, 'utf8'));
    const n = (await client.query(COUNT_TABLES)).rows[0].n;
    await client.query('COMMIT');
    return { ran: true, tables: n };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { });
    throw err;
  } finally {
    // The dump changes session settings (search_path); never hand this connection back to the pool.
    client.release(true);
  }
}
