import '../config.js';
import { getPool, closePool } from '../db.js';

/**
 * Dispatch Core demo seed — clearly fictional Johannesburg data.
 *
 * Every facility, response unit and responder here is SIMULATED for the
 * development prototype. Nothing represents a real emergency service.
 *
 * Test geometry around NovaCare Demo Hospital (Sandton, -26.1076, 28.0567):
 *   - fewer than 3 capable facilities within 5 km
 *   - 4 ambulance-capable facilities within 10 km
 *   - more capable facilities spread out to ~30 km
 *   - capabilities vary (ambulance only / home visit only / both)
 */

interface DemoFacility {
  name: string;
  suburb: string;
  address: string;
  latitude: number;
  longitude: number;
  ambulance: boolean;
  homeVisit: boolean;
}

const DEMO_HOSPITAL_NAME = 'NovaCare Demo Hospital';
const DEMO_HOSPITAL_ADDRESS = '1 Care Lane, Sandton, Johannesburg, 2196';

const DEMO_HOSPITAL: DemoFacility = {
  name: DEMO_HOSPITAL_NAME,
  suburb: 'Sandton',
  address: DEMO_HOSPITAL_ADDRESS,
  latitude: -26.1076,
  longitude: 28.0567,
  ambulance: true,
  homeVisit: true,
};

const FACILITIES: DemoFacility[] = [
  DEMO_HOSPITAL,
  // 4.6 km — ambulance only (keeps <3 capable inside 5 km for both request types)
  { name: 'Simulated Facility — Rosebank Response Centre', suburb: 'Rosebank', address: '7 Demo Avenue, Rosebank, Johannesburg', latitude: -26.1467, longitude: 28.0417, ambulance: true, homeVisit: false },
  // 7.9 km — home visit only
  { name: 'Simulated Facility — Randburg Care Station', suburb: 'Randburg', address: '12 Demo Street, Ferndale, Randburg', latitude: -26.0967, longitude: 27.9783, ambulance: false, homeVisit: true },
  // 9.2 km — both (pushes each type to exactly 3 within 10 km)
  { name: 'Simulated Facility — Johannesburg CBD Clinic', suburb: 'Johannesburg CBD', address: '200 Demo Main Street, Johannesburg CBD', latitude: -26.19, longitude: 28.045, ambulance: true, homeVisit: true },
  // 8.4 km — ambulance only (gives the ambulance demo four eligible facilities at 10 km)
  { name: 'Simulated Facility — Parktown Response Centre', suburb: 'Parktown', address: '42 Demo Crescent, Parktown, Johannesburg', latitude: -26.1832, longitude: 28.0567, ambulance: true, homeVisit: false },
  // beyond 10 km — the wider demo network
  { name: 'Simulated Facility — Fourways North', suburb: 'Fourways', address: '45 Demo Boulevard, Fourways, Johannesburg', latitude: -26.0093, longitude: 28.0064, ambulance: true, homeVisit: false },
  { name: 'Simulated Facility — Midrand Gateway', suburb: 'Midrand', address: '30 Demo Road, Midrand', latitude: -25.9892, longitude: 28.1286, ambulance: false, homeVisit: true },
  { name: 'Simulated Facility — Diepkloof Community', suburb: 'Diepkloof, Soweto', address: '88 Demo Zone, Diepkloof, Soweto', latitude: -26.2494, longitude: 27.9339, ambulance: true, homeVisit: true },
  { name: 'Simulated Facility — Germiston East', suburb: 'Germiston', address: '5 Demo Lane, Germiston', latitude: -26.2178, longitude: 28.1667, ambulance: true, homeVisit: false },
  { name: 'Simulated Facility — Roodepoort West', suburb: 'Roodepoort', address: '61 Demo Drive, Roodepoort', latitude: -26.1625, longitude: 27.8725, ambulance: false, homeVisit: true },
  { name: 'Simulated Facility — Alberton South', suburb: 'Alberton', address: '19 Demo Crescent, Alberton', latitude: -26.267, longitude: 28.122, ambulance: true, homeVisit: false },
  { name: 'Simulated Facility — Krugersdorp West', suburb: 'Krugersdorp', address: '77 Demo Way, Krugersdorp', latitude: -26.1, longitude: 27.75, ambulance: false, homeVisit: true },
];

const RESPONSE_UNITS: { callsign: string; facilityName: string }[] = [
  { callsign: 'A01', facilityName: DEMO_HOSPITAL_NAME },
  { callsign: 'A02', facilityName: 'Simulated Facility — Rosebank Response Centre' },
  { callsign: 'A03', facilityName: 'Simulated Facility — Johannesburg CBD Clinic' },
  { callsign: 'A04', facilityName: 'Simulated Facility — Fourways North' },
  { callsign: 'A05', facilityName: 'Simulated Facility — Diepkloof Community' },
];

const DISPATCHERS = [
  { email: 'dispatcher.amina@novacare.local', name: 'Simulated Dispatcher Amina' },
  { email: 'dispatcher.thabo@novacare.local', name: 'Simulated Dispatcher Thabo' },
  { email: 'dispatcher.lerato@novacare.local', name: 'Simulated Dispatcher Lerato' },
] as const;

const RESPONDERS: { email: string; name: string; facilityName: string; role: 'nurse' | 'doctor'; homeVisitEligible: boolean }[] = [
  { email: 'responder.naledi@novacare.local', name: 'Simulated Responder Naledi', facilityName: DEMO_HOSPITAL_NAME, role: 'nurse', homeVisitEligible: true },
  { email: 'responder.pieter@novacare.local', name: 'Simulated Responder Pieter', facilityName: DEMO_HOSPITAL_NAME, role: 'doctor', homeVisitEligible: true },
  { email: 'responder.zanele@novacare.local', name: 'Simulated Responder Zanele', facilityName: 'Simulated Facility — Johannesburg CBD Clinic', role: 'nurse', homeVisitEligible: true },
  { email: 'responder.mandla@novacare.local', name: 'Simulated Responder Mandla', facilityName: 'Simulated Facility — Johannesburg CBD Clinic', role: 'doctor', homeVisitEligible: true },
  { email: 'responder.farah@novacare.local', name: 'Simulated Responder Farah', facilityName: 'Simulated Facility — Randburg Care Station', role: 'nurse', homeVisitEligible: true },
  { email: 'responder.musa@novacare.local', name: 'Simulated Responder Musa', facilityName: 'Simulated Facility — Midrand Gateway', role: 'doctor', homeVisitEligible: true },
];

async function upsertFacility(pool: ReturnType<typeof getPool>, facility: DemoFacility): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO hospitals (name, province, address, latitude, longitude, active, ambulance_available, home_visit_available)
     VALUES ($1, 'Gauteng', $2, $3, $4, true, $5, $6)
     ON CONFLICT (name, address) DO UPDATE SET
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       active = true,
       ambulance_available = EXCLUDED.ambulance_available,
       home_visit_available = EXCLUDED.home_visit_available
     RETURNING id`,
    [facility.name, facility.address, facility.latitude, facility.longitude, facility.ambulance, facility.homeVisit],
  );
  return result.rows[0].id;
}

async function seedFacilities(): Promise<Map<string, string>> {
  const pool = getPool();
  const ids = new Map<string, string>();
  for (const facility of FACILITIES) {
    ids.set(facility.name, await upsertFacility(pool, facility));
  }
  return ids;
}

async function seedResponseUnits(facilityIds: Map<string, string>): Promise<number> {
  const pool = getPool();
  let count = 0;
  for (const unit of RESPONSE_UNITS) {
    const facilityId = facilityIds.get(unit.facilityName);
    if (!facilityId) continue;
    await pool.query(
      `INSERT INTO response_units (callsign, unit_type, hospital_id, status, active)
       VALUES ($1, 'AMBULANCE', $2, 'AVAILABLE', true)
       ON CONFLICT (callsign) DO UPDATE SET hospital_id = EXCLUDED.hospital_id, status = 'AVAILABLE', active = true`,
      [unit.callsign, facilityId],
    );
    count += 1;
  }
  return count;
}

async function resolveSeedUser(email: string, displayName: string): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = $1 ORDER BY (auth0_subject LIKE 'seed|%') ASC LIMIT 1`,
    [email],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO users (auth0_subject, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (auth0_subject) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, updated_at = now()
     RETURNING id`,
    [`seed|${email}`, email, displayName],
  );
  return created.rows[0].id;
}

async function upsertMembership(
  userId: string,
  facilityId: string,
  role: 'dispatcher' | 'nurse' | 'doctor',
  options: { homeVisitEligible?: boolean } = {},
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO hospital_memberships (user_id, hospital_id, role, active, availability, home_visit_eligible, on_duty)
     VALUES ($1, $2, $3, true, 'AVAILABLE', $4, true)
     ON CONFLICT (user_id) DO UPDATE SET
       hospital_id = EXCLUDED.hospital_id,
       role = EXCLUDED.role,
       active = true,
       availability = 'AVAILABLE',
       home_visit_eligible = EXCLUDED.home_visit_eligible,
       on_duty = true`,
    [userId, facilityId, role, options.homeVisitEligible ?? false],
  );
}

async function seedPeople(facilityIds: Map<string, string>): Promise<void> {
  const demoId = facilityIds.get(DEMO_HOSPITAL_NAME);
  if (!demoId) throw new Error('NovaCare Demo Hospital not found — run the base seed first.');
  for (const dispatcher of DISPATCHERS) {
    const dispatcherId = await resolveSeedUser(dispatcher.email, dispatcher.name);
    await upsertMembership(dispatcherId, demoId, 'dispatcher');
  }
  for (const responder of RESPONDERS) {
    const userId = await resolveSeedUser(responder.email, responder.name);
    const facilityId = facilityIds.get(responder.facilityName) ?? demoId;
    await upsertMembership(userId, facilityId, responder.role, { homeVisitEligible: responder.homeVisitEligible });
  }
}

async function main(): Promise<void> {
  const facilityIds = await seedFacilities();
  const unitCount = await seedResponseUnits(facilityIds);
  await seedPeople(facilityIds);
  const pool = getPool();
  const capability = await pool.query<{ ambulance: string; home_visit: string }>(
    'SELECT COUNT(*) FILTER (WHERE ambulance_available) AS ambulance, COUNT(*) FILTER (WHERE home_visit_available) AS home_visit FROM hospitals WHERE active',
  );
  console.log('[seed:dispatch] Simulated facilities:', facilityIds.size);
  console.log('[seed:dispatch] Simulated response units:', unitCount);
  console.log('[seed:dispatch] Capable (ambulance / home visit):', capability.rows[0].ambulance, '/', capability.rows[0].home_visit);
  console.log('[seed:dispatch] Dispatcher placeholders:', DISPATCHERS.map((dispatcher) => dispatcher.email).join(', '), '(no real login attached)');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
