import '../config.js';
import { closePool, getPool } from '../db.js';

interface SeedPerson {
  email: string;
  displayName: string;
  userType: 'admin' | 'staff' | 'patient';
  role: 'administrator' | 'nurse' | 'doctor' | null;
}

const demoHospital = {
  name: 'NovaCare Demo Hospital',
  province: 'Gauteng',
  address: '1 Care Lane, Sandton, Johannesburg, 2196',
  latitude: -26.1076,
  longitude: 28.0567,
};

const demoDepartments: { name: string; minutes: number }[] = [
  { name: 'Emergency', minutes: 10 },
  { name: 'General Medicine', minutes: 15 },
  { name: 'Outpatient', minutes: 15 },
  { name: 'Maternity', minutes: 20 },
  { name: 'Paediatrics', minutes: 15 },
  { name: 'Pharmacy', minutes: 5 },
  { name: 'Radiology', minutes: 20 },
  { name: 'Laboratory Collection', minutes: 10 },
];

function adminEmail(): string {
  return (process.env.PLATFORM_OVERSEER_EMAIL ?? '2811604@students.wits.ac.za').trim().toLowerCase();
}

async function resolveUser(email: string, displayName: string, userType: SeedPerson['userType']): Promise<string> {
  const pool = getPool();
  // Prefer an existing real Auth0 account (seed rows are only placeholders).
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = $1 ORDER BY (auth0_subject LIKE 'seed|%') ASC LIMIT 1`,
    [email],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO users (auth0_subject, email, display_name, user_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (auth0_subject) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, user_type = EXCLUDED.user_type, updated_at = now()
     RETURNING id`,
    [`seed|${email}`, email, displayName, userType],
  );
  return created.rows[0]!.id;
}

async function main(): Promise<void> {
  const pool = getPool();
  const people: SeedPerson[] = [
    { email: adminEmail(), displayName: 'NovaCare Demo Administrator', userType: 'admin', role: 'administrator' },
    { email: 'nurse.thandi@novacare.demo', displayName: 'Thandi Ngcobo', userType: 'staff', role: 'nurse' },
    { email: 'nurse.sipho@novacare.demo', displayName: 'Sipho Mabaso', userType: 'staff', role: 'nurse' },
    { email: 'dr.dlamini@novacare.demo', displayName: 'Zanele Dlamini', userType: 'staff', role: 'doctor' },
    { email: 'dr.mokoena@novacare.demo', displayName: 'Kabelo Mokoena', userType: 'staff', role: 'doctor' },
    { email: 'patient.demo@novacare.demo', displayName: 'Demo Patient', userType: 'patient', role: null },
  ];

  const hospital = await pool.query<{ id: string }>(
    `INSERT INTO hospitals (name, province, address, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (name, address) DO UPDATE SET active = true, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
     RETURNING id`,
    [demoHospital.name, demoHospital.province, demoHospital.address, demoHospital.latitude, demoHospital.longitude],
  );
  const hospitalId = hospital.rows[0]!.id;

  for (const department of demoDepartments) {
    await pool.query(
      `INSERT INTO departments (hospital_id, name, average_consultation_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT (hospital_id, name) DO UPDATE
       SET average_consultation_minutes = EXCLUDED.average_consultation_minutes, active = true`,
      [hospitalId, department.name, department.minutes],
    );
  }

  const staffed: string[] = [];
  for (const person of people) {
    const userId = await resolveUser(person.email, person.displayName, person.userType);
    if (person.role) {
      await pool.query(
        `INSERT INTO hospital_memberships (user_id, hospital_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, hospital_id) DO UPDATE SET role = EXCLUDED.role, active = true`,
        [userId, hospitalId, person.role],
      );
      staffed.push(`${person.role}: ${person.email}`);
    }
  }

  console.log('NovaCare seed complete');
  console.log(`  Hospital:     ${demoHospital.name} (${hospitalId})`);
  console.log(`  Departments:  ${demoDepartments.map((department) => `${department.name} ${department.minutes}m`).join(', ')}`);
  for (const line of staffed) console.log(`  Membership:   ${line}`);
  console.log('  Patient:      patient.demo@novacare.demo (no staff role)');
  console.log('Note: staff placeholders use seed|<email> Auth0 subjects until the real account signs in.');
  console.log('Run `npm run migrate` first if the tables were missing.');
}

main()
  .catch((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === '42P01' || code === '42703') {
      console.error('Seed failed: database schema is out of date. Run `npm run migrate` first.');
    } else {
      console.error('Seed failed:', error);
    }
    process.exitCode = 1;
  })
  .finally(() => closePool());
