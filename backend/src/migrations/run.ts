import '../config.js';
import { createHash } from 'node:crypto';
import { getPool, closePool } from '../db.js';
import { migration as initialMigration } from './001_initial.js';
import { migration as userTypeMigration } from './002_user_type.js';

const migrations = [initialMigration, userTypeMigration];

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('novacare:migrations'))");
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const migration of migrations) {
      const checksum = createHash('sha256').update(migration.sql).digest('hex');
      const result = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [migration.name],
      );
      const applied = result.rows[0];
      if (applied && applied.checksum !== checksum) {
        throw new Error(`Applied migration ${migration.name} has changed`);
      }
      if (applied) continue;

      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [migration.name, checksum]);
      console.log(`Applied migration ${migration.name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('novacare:migrations'))");
    client.release();
    await closePool();
  }
}

runMigrations().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
