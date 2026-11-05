import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, checkDatabaseConnection } from '../backend/src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../database/migrations');

const REQUIRED_TABLES = [
  'users',
  'roles',
  'members',
  'membership_plans',
  'memberships',
  'check_ins',
  'trainers',
  'trainer_schedules',
  'trainer_availability',
  'gym_settings',
  'gym_faqs',
  'announcements',
  'member_enquiries',
  'interaction_logs',
  'robot_devices',
  'robot_commands',
  'robot_logs',
];

async function runSqlFile(filepath) {
  const filename = path.basename(filepath);
  console.log(`[Migrate] Executing ${filename}...`);
  const sql = fs.readFileSync(filepath, 'utf8');
  await pool.query(sql);
  console.log(`[Migrate] ✓ Finished ${filename}`);
}

async function verifyTables() {
  console.log('\n--- VERIFYING SHARED SCHEMA TABLES ---');
  const res = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public';
  `);
  const existingTables = new Set(res.rows.map((r) => r.table_name));

  let allFound = true;
  for (const t of REQUIRED_TABLES) {
    if (existingTables.has(t)) {
      const countRes = await pool.query(`SELECT count(*) FROM "${t}"`);
      console.log(`  ✓ ${t.padEnd(24)} : ${countRes.rows[0].count} rows`);
    } else {
      console.log(`  ✗ ${t.padEnd(24)} : MISSING!`);
      allFound = false;
    }
  }

  return allFound;
}

async function main() {
  const command = (process.argv[2] || 'up').toLowerCase();

  const conn = await checkDatabaseConnection();
  if (!conn.ok) {
    console.error('[Migrate] Cannot connect to PostgreSQL database:', conn.error);
    process.exit(1);
  }

  try {
    if (command === 'up') {
      console.log('[Migrate] Applying non-destructive shared schema migrations...');
      await runSqlFile(path.join(migrationsDir, '001_shared_schema_upgrade.sql'));
      await runSqlFile(path.join(migrationsDir, '002_shared_seed_data.sql'));
      const ok = await verifyTables();
      if (ok) {
        console.log('\n[Migrate] 🎉 All 17 required shared tables verified successfully!');
      } else {
        console.warn('\n[Migrate] ⚠️ Some required tables are missing.');
      }
    } else if (command === 'down') {
      console.log('[Migrate] Rolling back shared schema migrations...');
      await runSqlFile(path.join(migrationsDir, '002_shared_seed_data_down.sql'));
      await runSqlFile(path.join(migrationsDir, '001_shared_schema_upgrade_down.sql'));
      console.log('\n[Migrate] ✓ Rollback completed.');
      await verifyTables();
    } else if (command === 'status') {
      await verifyTables();
    } else {
      console.log('Usage: node scripts/migrate.js [up | down | status]');
    }
  } catch (err) {
    console.error('[Migrate Error]:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

