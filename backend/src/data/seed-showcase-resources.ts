import '../config.js';
import { closePool, getPool } from '../db.js';
import {
  formatShowcaseSeedSummary,
  seedShowcaseResources,
  type ShowcaseAmbulance,
  type ShowcaseFacility,
  type ShowcaseRecordState,
  type ShowcaseResponderPlan,
  type ShowcaseResourceStore,
  type ShowcaseResponder,
  type ShowcaseWriteResult,
} from './showcase-resources.js';

type SqlResult<Row> = { rows: Row[]; rowCount: number | null };
type SqlQuery = (text: string, values?: unknown[]) => Promise<SqlResult<unknown>>;

type FacilityRow = {
  id: string;
  name: string;
  active: boolean;
  ambulance_available: boolean;
  home_visit_available: boolean;
  existing_responders: number;
  existing_ambulances: number;
};

type ResponderRow = {
  user_id: string;
  membership_id: string | null;
  hospital_id: string | null;
};

type AmbulanceRow = { id: string; hospital_id: string };

function rowsAs<Row>(result: SqlResult<unknown>): Row[] {
  return result.rows as Row[];
}

class PostgresShowcaseResourceStore implements ShowcaseResourceStore {
  constructor(private readonly query: SqlQuery) {}

  async listFacilities(): Promise<ShowcaseFacility[]> {
    const result = await this.query(
      `SELECT h.id, h.name, h.active, h.ambulance_available, h.home_visit_available,
              (SELECT COUNT(*)::int
               FROM hospital_memberships m
               JOIN users u ON u.id = m.user_id
               WHERE m.hospital_id = h.id AND m.role IN ('doctor', 'nurse')
                 AND u.auth0_subject NOT LIKE 'synthetic:showcase:%') AS existing_responders,
              (SELECT COUNT(*)::int
               FROM response_units ru
               WHERE ru.hospital_id = h.id AND ru.callsign NOT LIKE 'AMB-NC-%') AS existing_ambulances
       FROM hospitals h
       ORDER BY h.name, h.id`,
    );
    return rowsAs<FacilityRow>(result).map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      ambulanceAvailable: row.ambulance_available,
      homeVisitAvailable: row.home_visit_available,
      existingResponders: Number(row.existing_responders),
      existingAmbulances: Number(row.existing_ambulances),
    }));
  }

  async responderPlan(responder: ShowcaseResponder): Promise<ShowcaseResponderPlan> {
    const existing = await this.findResponder(responder.auth0Subject);
    if (!existing) return { syntheticUser: 'missing', membership: 'missing' };
    if (existing.membership_id && existing.hospital_id !== responder.facilityId) {
      throw new Error(`Showcase responder ${responder.auth0Subject} belongs to a different hospital.`);
    }
    return { syntheticUser: 'present', membership: existing.membership_id ? 'present' : 'missing' };
  }

  async ambulanceState(ambulance: ShowcaseAmbulance): Promise<ShowcaseRecordState> {
    const existing = await this.findAmbulance(ambulance.callsign);
    if (!existing) return 'missing';
    if (existing.hospital_id !== ambulance.facilityId) {
      throw new Error(`Showcase ambulance ${ambulance.callsign} belongs to a different hospital.`);
    }
    return 'present';
  }

  async enableDispatchCapabilities(facilityId: string): Promise<void> {
    await this.query(
      `UPDATE hospitals
       SET ambulance_available = true, home_visit_available = true
       WHERE id = $1 AND active
         AND (NOT ambulance_available OR NOT home_visit_available)`,
      [facilityId],
    );
  }

  async ensureResponder(responder: ShowcaseResponder): Promise<ShowcaseResponderPlan> {
    const plan = await this.responderPlan(responder);
    if (plan.syntheticUser === 'missing') {
      await this.query(
        `INSERT INTO users (auth0_subject, email, display_name, user_type)
         VALUES ($1, $2, $3, 'staff')
         ON CONFLICT (auth0_subject) DO NOTHING`,
        [responder.auth0Subject, responder.email, responder.displayName],
      );
    }

    const user = await this.findResponder(responder.auth0Subject);
    if (!user) throw new Error(`Unable to create showcase responder ${responder.auth0Subject}.`);
    const membership = await this.query(
      `INSERT INTO hospital_memberships (user_id, hospital_id, role, active, availability, home_visit_eligible, on_duty)
       VALUES ($1, $2, 'doctor', true, 'AVAILABLE', true, true)
       ON CONFLICT (user_id) DO UPDATE SET
         role = 'doctor',
         active = true,
         availability = 'AVAILABLE',
         home_visit_eligible = true,
         on_duty = true
       WHERE hospital_memberships.hospital_id = EXCLUDED.hospital_id
       RETURNING id`,
      [user.user_id, responder.facilityId],
    );
    if (!membership.rowCount) {
      throw new Error(`Showcase responder ${responder.auth0Subject} belongs to a different hospital.`);
    }
    return plan;
  }

  async ensureAmbulance(ambulance: ShowcaseAmbulance): Promise<ShowcaseWriteResult> {
    const state = await this.ambulanceState(ambulance);
    const result = await this.query(
      `INSERT INTO response_units (callsign, unit_type, hospital_id, status, active)
       VALUES ($1, 'AMBULANCE', $2, 'AVAILABLE', true)
       ON CONFLICT (callsign) DO UPDATE SET
         status = 'AVAILABLE',
         active = true
       WHERE response_units.hospital_id = EXCLUDED.hospital_id
       RETURNING id`,
      [ambulance.callsign, ambulance.facilityId],
    );
    if (!result.rowCount) {
      throw new Error(`Showcase ambulance ${ambulance.callsign} belongs to a different hospital.`);
    }
    return state === 'missing' ? 'created' : 'reused';
  }

  private async findResponder(auth0Subject: string): Promise<ResponderRow | null> {
    const result = await this.query(
      `SELECT u.id AS user_id, m.id AS membership_id, m.hospital_id
       FROM users u
       LEFT JOIN hospital_memberships m ON m.user_id = u.id
       WHERE u.auth0_subject = $1`,
      [auth0Subject],
    );
    return rowsAs<ResponderRow>(result)[0] ?? null;
  }

  private async findAmbulance(callsign: string): Promise<AmbulanceRow | null> {
    const result = await this.query(
      'SELECT id, hospital_id FROM response_units WHERE callsign = $1',
      [callsign],
    );
    return rowsAs<AmbulanceRow>(result)[0] ?? null;
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
  const store = new PostgresShowcaseResourceStore((text, values = []) => client.query(text, values));
  try {
    if (dryRun) {
      const summary = await seedShowcaseResources(store, { dryRun: true });
      for (const line of formatShowcaseSeedSummary(summary)) console.log(line);
      return;
    }

    await client.query('BEGIN');
    try {
      const summary = await seedShowcaseResources(store);
      await client.query('COMMIT');
      for (const line of formatShowcaseSeedSummary(summary)) console.log(line);
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
    console.error('[seed:showcase-resources] Failed without committing partial changes:', error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
