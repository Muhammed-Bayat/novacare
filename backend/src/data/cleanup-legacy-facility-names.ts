import '../config.js';
import { closePool, getPool } from '../db.js';
import {
  applyLegacyFacilityCleanup,
  type FacilityNameRenameInput,
  formatLegacyFacilityCleanupPlan,
  planLegacyFacilityCleanup,
  type FacilityNameRecord,
  type LegacyFacilityNameStore,
} from './legacy-facility-names.js';

type SqlResult<Row> = { rows: Row[]; rowCount: number | null };
type SqlQuery = (text: string, values?: unknown[]) => Promise<SqlResult<unknown>>;

function rowsAs<Row>(result: SqlResult<unknown>): Row[] {
  return result.rows as Row[];
}

class PostgresLegacyFacilityNameStore implements LegacyFacilityNameStore {
  constructor(private readonly query: SqlQuery) {}

  async listFacilityNames(): Promise<FacilityNameRecord[]> {
    const result = await this.query('SELECT id, name FROM hospitals ORDER BY name, id');
    return rowsAs<FacilityNameRecord>(result);
  }

  async renameFacility(rename: FacilityNameRenameInput): Promise<void> {
    const result = await this.query(
      `UPDATE hospitals
       SET name = $1
       WHERE id = $2 AND name = $3
       RETURNING id`,
      [rename.proposedName, rename.facilityId, rename.currentName],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Facility ${rename.facilityId} changed before its legacy name could be cleaned up.`);
    }
  }
}

function parseArgs(args: string[]): { dryRun: boolean } {
  const unsupported = args.filter((arg) => arg !== '--dry-run');
  if (unsupported.length > 0) throw new Error(`Unsupported option: ${unsupported.join(', ')}`);
  return { dryRun: args.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const client = await getPool().connect();
  const store = new PostgresLegacyFacilityNameStore((text, values = []) => client.query(text, values));
  try {
    const plan = planLegacyFacilityCleanup(await store.listFacilityNames());
    if (dryRun) {
      for (const line of formatLegacyFacilityCleanupPlan(plan, true)) console.log(line);
      return;
    }

    await client.query('BEGIN');
    try {
      await applyLegacyFacilityCleanup(store, plan);
      await client.query('COMMIT');
      for (const line of formatLegacyFacilityCleanupPlan(plan, false)) console.log(line);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

main()
  .catch((error: unknown) => {
    console.error('[cleanup:legacy-facility-names] Failed without committing partial changes:', error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
