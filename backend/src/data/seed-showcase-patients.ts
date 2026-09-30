import '../config.js';
import { closePool, getPool } from '../db.js';
import {
  SHOWCASE_PATIENT_SEED_VERSION,
  buildShowcasePatientPlan,
  formatShowcasePatientPlan,
  showcasePatientPlanFingerprint,
  type ShowcaseDepartment,
  type ShowcasePatientPlan,
} from './showcase-patients.js';

type SqlResult<Row> = { rows: Row[]; rowCount: number | null };
type Queryable = { query: <Row = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<SqlResult<Row>> };
type Mode = 'dry-run' | 'apply' | 'rollback-preview' | 'rollback';

interface Options {
  mode: Mode;
  hospitalName: string;
  confirmation?: string;
  planConfirmation?: string;
  runId?: string;
}

interface SeedContext {
  hospital: { id: string; name: string; active: boolean };
  date: string;
  timezone: string;
  departments: ShowcaseDepartment[];
  occupiedBookedSlots: Set<string>;
  staffCounts: Record<string, number>;
}

interface RollbackPlan {
  runId: string;
  seedDate: string;
  userIds: string[];
  appointmentIds: string[];
  queueEntryIds: string[];
  diagnosisIds: string[];
  profileIds: string[];
  auditEventCount: number;
}

function optionValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const matches = args.filter((argument) => argument.startsWith(prefix));
  if (matches.length > 1) throw new Error(`Provide ${name} only once.`);
  return matches[0]?.slice(prefix.length).trim();
}

export function parseShowcasePatientArgs(args: string[]): Options {
  const supported = new Set(['--dry-run', '--apply', '--rollback']);
  const unsupported = args.filter((argument) => !supported.has(argument)
    && !argument.startsWith('--hospital-name=')
    && !argument.startsWith('--confirm-hospital=')
    && !argument.startsWith('--confirm-plan=')
    && !argument.startsWith('--run-id='));
  if (unsupported.length > 0) throw new Error(`Unsupported option: ${unsupported.join(', ')}`);
  const hospitalName = optionValue(args, '--hospital-name');
  if (!hospitalName) throw new Error('Provide --hospital-name=<exact hospital name>.');
  const apply = args.includes('--apply');
  const rollback = args.includes('--rollback');
  const dryRun = args.includes('--dry-run');
  if (apply && rollback) throw new Error('Choose either --apply or --rollback.');
  if (apply && dryRun) throw new Error('Use --dry-run by itself to preview an apply.');
  if (!apply && !rollback && !dryRun) throw new Error('Choose --dry-run, --apply, or --rollback.');
  const mode: Mode = rollback ? (dryRun ? 'rollback-preview' : 'rollback') : apply ? 'apply' : 'dry-run';
  return {
    mode,
    hospitalName,
    confirmation: optionValue(args, '--confirm-hospital'),
    planConfirmation: optionValue(args, '--confirm-plan'),
    runId: optionValue(args, '--run-id'),
  };
}

async function loadContext(db: Queryable, hospitalName: string, lockRows = false): Promise<SeedContext> {
  const hospitals = await db.query<{ id: string; name: string; active: boolean }>(
    `SELECT id, name, active FROM hospitals WHERE lower(name) = lower($1)${lockRows ? ' FOR SHARE' : ''}`,
    [hospitalName],
  );
  if (hospitals.rows.length !== 1) {
    throw new Error(hospitals.rows.length === 0 ? `Hospital not found: ${hospitalName}` : `Hospital name is ambiguous: ${hospitalName}`);
  }
  const hospital = hospitals.rows[0]!;
  if (!hospital.active) throw new Error(`${hospital.name} is inactive.`);
  const dateResult = await db.query<{ seed_date: string; timezone: string }>(
    `SELECT CURRENT_DATE::text AS seed_date, current_setting('TimeZone') AS timezone`,
  );
  const date = dateResult.rows[0]!.seed_date;
  const departments = await db.query<ShowcaseDepartment>(
    'SELECT id, name FROM departments WHERE hospital_id = $1 AND active ORDER BY name, id',
    [hospital.id],
  );
  const booked = await db.query<{ department_id: string; appointment_time: string }>(
    `SELECT hospital_service_id AS department_id, appointment_time::text
     FROM appointments
     WHERE hospital_id = $1 AND appointment_date = $2 AND status <> 'cancelled'`,
    [hospital.id, date],
  );
  const staff = await db.query<{ role: string; count: number }>(
    `SELECT role, COUNT(*)::int AS count
     FROM hospital_memberships
     WHERE hospital_id = $1 AND active
     GROUP BY role`,
    [hospital.id],
  );
  const staffCounts = Object.fromEntries(staff.rows.map((row) => [row.role, Number(row.count)]));
  if (!staffCounts.nurse || !staffCounts.doctor) {
    throw new Error(`${hospital.name} must have at least one active nurse and doctor before seeding showcase patients.`);
  }
  return {
    hospital,
    date,
    timezone: dateResult.rows[0]!.timezone,
    departments: departments.rows,
    occupiedBookedSlots: new Set(booked.rows.map((row) => `${row.department_id}|${row.appointment_time.slice(0, 5)}`)),
    staffCounts,
  };
}

function planFromContext(context: SeedContext): ShowcasePatientPlan {
  return buildShowcasePatientPlan({
    hospitalId: context.hospital.id,
    hospitalName: context.hospital.name,
    date: context.date,
    departments: context.departments,
    occupiedBookedSlots: context.occupiedBookedSlots,
  });
}

function requireHospitalConfirmation(options: Options, hospitalId: string): void {
  if (options.confirmation !== hospitalId) {
    throw new Error(`Writing requires --confirm-hospital=${hospitalId}`);
  }
}

function requirePlanConfirmation(options: Options, plan: ShowcasePatientPlan): void {
  const fingerprint = showcasePatientPlanFingerprint(plan);
  if (options.planConfirmation !== fingerprint) {
    throw new Error(`Apply requires the current dry-run fingerprint: --confirm-plan=${fingerprint}`);
  }
}

async function activeApplyRun(db: Queryable, context: SeedContext): Promise<string | undefined> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM showcase_patient_seed_runs
     WHERE hospital_id = $1 AND seed_date = $2 AND seed_version = $3 AND rolled_back_at IS NULL`,
    [context.hospital.id, context.date, SHOWCASE_PATIENT_SEED_VERSION],
  );
  return result.rows[0]?.id;
}

async function recordSeedEntity(db: Queryable, runId: string, entityType: 'user' | 'appointment' | 'queue_entry', entityId: string): Promise<void> {
  await db.query(
    'INSERT INTO showcase_patient_seed_records (run_id, entity_type, entity_id) VALUES ($1, $2, $3)',
    [runId, entityType, entityId],
  );
}

async function applySeed(db: Queryable, plan: ShowcasePatientPlan): Promise<string> {
  const run = await db.query<{ id: string }>(
    `INSERT INTO showcase_patient_seed_runs (hospital_id, seed_date, seed_version)
     VALUES ($1, $2, $3) RETURNING id`,
    [plan.hospitalId, plan.date, SHOWCASE_PATIENT_SEED_VERSION],
  );
  const runId = run.rows[0]!.id;
  const userIds = new Map<string, string>();
  const appointmentIds = new Map<string, string>();

  for (const patient of plan.patients) {
    const created = await db.query<{ id: string }>(
      `INSERT INTO users (auth0_subject, email, display_name, user_type)
       VALUES ($1, $2, $3, 'patient') RETURNING id`,
      [patient.auth0Subject, patient.email, patient.displayName],
    );
    const userId = created.rows[0]!.id;
    userIds.set(patient.key, userId);
    await recordSeedEntity(db, runId, 'user', userId);
  }

  for (const appointment of plan.appointments) {
    const created = await db.query<{ id: string }>(
      `INSERT INTO appointments (user_id, hospital_id, hospital_service_id, appointment_date, appointment_time, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userIds.get(appointment.patientKey), plan.hospitalId, appointment.departmentId, plan.date, appointment.time, appointment.status],
    );
    const appointmentId = created.rows[0]!.id;
    appointmentIds.set(appointment.key, appointmentId);
    await recordSeedEntity(db, runId, 'appointment', appointmentId);
  }

  for (const entry of plan.queueEntries) {
    const created = await db.query<{ id: string }>(
      `INSERT INTO queue_entries (
         user_id, hospital_id, hospital_service_id, queue_date, status, appointment_id,
         triage_urgency, triage_pathway, triage_department, triage_summary, triage_red_flags,
         category, joined_at, triaged_at, called_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, GREATEST(date_trunc('day', now()), now() - ($13::int * interval '1 minute')),
         CASE WHEN $14::int IS NULL THEN NULL ELSE GREATEST(date_trunc('day', now()), now() - ($14::int * interval '1 minute')) END,
         CASE WHEN $15::int IS NULL THEN NULL ELSE GREATEST(date_trunc('day', now()), now() - ($15::int * interval '1 minute')) END
       ) RETURNING id`,
      [
        userIds.get(entry.patientKey), plan.hospitalId, entry.departmentId, plan.date, entry.status,
        entry.appointmentKey ? appointmentIds.get(entry.appointmentKey) : null,
        entry.triageUrgency ?? null, entry.triageUrgency ? 'Showcase intake' : null,
        entry.triageUrgency ? entry.departmentName : null, entry.triageSummary ?? null, entry.triageRedFlags,
        entry.category ?? null, entry.joinedMinutesAgo, entry.triagedMinutesAgo ?? null, entry.calledMinutesAgo ?? null,
      ],
    );
    await recordSeedEntity(db, runId, 'queue_entry', created.rows[0]!.id);
  }
  return runId;
}

async function loadRollbackPlan(db: Queryable, context: SeedContext, requestedRunId?: string): Promise<RollbackPlan | null> {
  const runs = await db.query<{ id: string; seed_date: string }>(
    `SELECT id, seed_date::text FROM showcase_patient_seed_runs
     WHERE hospital_id = $1 AND seed_version = $2 AND rolled_back_at IS NULL
       AND ($3::uuid IS NULL OR id = $3::uuid)
     ORDER BY seed_date DESC, created_at DESC`,
    [context.hospital.id, SHOWCASE_PATIENT_SEED_VERSION, requestedRunId ?? null],
  );
  if (runs.rows.length === 0) return null;
  if (runs.rows.length > 1) {
    throw new Error(`Multiple active showcase runs exist. Choose one with --run-id=<uuid>: ${runs.rows.map((run) => run.id).join(', ')}`);
  }
  const selectedRun = runs.rows[0]!;
  const tracked = await db.query<{ entity_type: string; entity_id: string }>(
    'SELECT entity_type, entity_id FROM showcase_patient_seed_records WHERE run_id = $1',
    [selectedRun.id],
  );
  const userIds = tracked.rows.filter((row) => row.entity_type === 'user').map((row) => row.entity_id);
  if (userIds.length === 0) throw new Error(`Active showcase run ${selectedRun.id} has no tracked patients; refusing rollback.`);
  const users = await db.query<{ id: string; auth0_subject: string }>('SELECT id, auth0_subject FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  const subjectPrefix = `synthetic:showcase:patient:${context.hospital.id}:${selectedRun.seed_date}:`;
  if (users.rows.length !== userIds.length || users.rows.some((user) => !user.auth0_subject.startsWith(subjectPrefix))) {
    throw new Error('Tracked showcase patient ownership could not be verified; refusing rollback.');
  }
  const appointments = await db.query<{ id: string }>('SELECT id FROM appointments WHERE user_id = ANY($1::uuid[]) FOR UPDATE', [userIds]);
  const queues = await db.query<{ id: string }>('SELECT id FROM queue_entries WHERE user_id = ANY($1::uuid[]) FOR UPDATE', [userIds]);
  const profiles = await db.query<{ id: string }>('SELECT id FROM patient_profiles WHERE user_id = ANY($1::uuid[])', [userIds]);
  const profileIds = profiles.rows.map((row) => row.id);
  const queueEntryIds = queues.rows.map((row) => row.id);
  const diagnoses = await db.query<{ id: string }>(
    `SELECT id FROM clinical_diagnoses
     WHERE patient_profile_id = ANY($1::uuid[]) OR queue_entry_id = ANY($2::uuid[])`,
    [profileIds, queueEntryIds],
  );
  const diagnosisIds = diagnoses.rows.map((row) => row.id);
  const audit = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM audit_events
     WHERE hospital_id = $1 AND (
       (entity_type = 'queue_entry' AND entity_id = ANY($2::text[])) OR
       (entity_type = 'clinical_diagnosis' AND entity_id = ANY($3::text[])) OR
       metadata->>'queueEntryId' = ANY($2::text[]) OR metadata->>'referralQueueEntryId' = ANY($2::text[])
     )`,
    [context.hospital.id, queueEntryIds, diagnosisIds],
  );
  return {
    runId: selectedRun.id,
    seedDate: selectedRun.seed_date,
    userIds,
    appointmentIds: appointments.rows.map((row) => row.id),
    queueEntryIds,
    diagnosisIds,
    profileIds,
    auditEventCount: Number(audit.rows[0]?.count ?? 0),
  };
}

function formatRollbackPlan(context: SeedContext, plan: RollbackPlan): string[] {
  return [
    `Hospital: ${context.hospital.name} (${context.hospital.id})`,
    `Seed date: ${plan.seedDate}`,
    `Synthetic patients to delete: ${plan.userIds.length}`,
    `Appointments to delete: ${plan.appointmentIds.length}`,
    `Queue entries to delete (including referrals): ${plan.queueEntryIds.length}`,
    `Diagnoses to delete: ${plan.diagnosisIds.length}`,
    `Patient profiles to delete: ${plan.profileIds.length}`,
    `Related audit events to delete: ${plan.auditEventCount}`,
  ];
}

async function rollbackSeed(db: Queryable, context: SeedContext, plan: RollbackPlan): Promise<void> {
  await db.query(
    `DELETE FROM audit_events
     WHERE hospital_id = $1 AND (
       (entity_type = 'queue_entry' AND entity_id = ANY($2::text[])) OR
       (entity_type = 'clinical_diagnosis' AND entity_id = ANY($3::text[])) OR
       metadata->>'queueEntryId' = ANY($2::text[]) OR metadata->>'referralQueueEntryId' = ANY($2::text[])
     )`,
    [context.hospital.id, plan.queueEntryIds, plan.diagnosisIds],
  );
  await db.query(
    'DELETE FROM clinical_diagnoses WHERE patient_profile_id = ANY($1::uuid[]) OR queue_entry_id = ANY($2::uuid[])',
    [plan.profileIds, plan.queueEntryIds],
  );
  await db.query('DELETE FROM queue_entries WHERE user_id = ANY($1::uuid[])', [plan.userIds]);
  await db.query('DELETE FROM appointments WHERE user_id = ANY($1::uuid[])', [plan.userIds]);
  await db.query('DELETE FROM patient_profiles WHERE user_id = ANY($1::uuid[])', [plan.userIds]);
  const deletedUsers = await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [plan.userIds]);
  if (deletedUsers.rowCount !== plan.userIds.length) throw new Error('Not every tracked showcase patient could be deleted; rolling back cleanup.');
  await db.query('UPDATE showcase_patient_seed_runs SET rolled_back_at = now() WHERE id = $1 AND rolled_back_at IS NULL', [plan.runId]);
}

function printContext(context: SeedContext): void {
  console.log(`[seed:showcase-patients] PostgreSQL date/timezone: ${context.date} / ${context.timezone}`);
  console.log(`[seed:showcase-patients] Active staff: ${Object.entries(context.staffCounts).map(([role, count]) => `${role}=${count}`).join(', ')}`);
}

async function main(): Promise<void> {
  const options = parseShowcasePatientArgs(process.argv.slice(2));
  const client = await getPool().connect();
  try {
    if (options.mode === 'dry-run' || options.mode === 'rollback-preview') {
      const context = await loadContext(client, options.hospitalName);
      printContext(context);
      if (options.mode === 'rollback-preview') {
        const rollbackPlan = await loadRollbackPlan(client, context, options.runId);
        if (!rollbackPlan) {
          console.log('[seed:showcase-patients] No active showcase run to roll back.');
        } else {
          for (const line of formatRollbackPlan(context, rollbackPlan)) console.log(line);
        }
      } else {
        const activeRunId = await activeApplyRun(client, context);
        if (activeRunId) {
          console.log(`[seed:showcase-patients] Active run ${activeRunId} already exists; apply would be a no-op.`);
        } else {
          const plan = planFromContext(context);
          for (const line of formatShowcasePatientPlan(plan)) console.log(line);
          console.log(`[seed:showcase-patients] Plan fingerprint: ${showcasePatientPlanFingerprint(plan)}`);
        }
      }
      console.log('[seed:showcase-patients] Dry run complete. No database writes performed.');
      return;
    }

    const initialContext = await loadContext(client, options.hospitalName);
    requireHospitalConfirmation(options, initialContext.hospital.id);
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('novacare:showcase-patients:' || $1))", [initialContext.hospital.id]);
      const context = await loadContext(client, options.hospitalName, true);
      printContext(context);
      if (options.mode === 'apply') {
        const activeRunId = await activeApplyRun(client, context);
        if (activeRunId) {
          console.log(`[seed:showcase-patients] Active run ${activeRunId} already exists; no records changed.`);
        } else {
          const plan = planFromContext(context);
          requirePlanConfirmation(options, plan);
          const runId = await applySeed(client, plan);
          for (const line of formatShowcasePatientPlan(plan)) console.log(line);
          console.log(`[seed:showcase-patients] Applied run ${runId}.`);
        }
      } else {
        const rollbackPlan = await loadRollbackPlan(client, context, options.runId);
        if (!rollbackPlan) {
          console.log('[seed:showcase-patients] No active showcase run to roll back; no records changed.');
        } else {
          await rollbackSeed(client, context, rollbackPlan);
          for (const line of formatRollbackPlan(context, rollbackPlan)) console.log(line);
          console.log(`[seed:showcase-patients] Rolled back run ${rollbackPlan.runId}.`);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

if (process.env.NODE_ENV !== 'test') {
  main()
    .catch((error: unknown) => {
      console.error('[seed:showcase-patients] Failed without committing partial changes:', error);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
