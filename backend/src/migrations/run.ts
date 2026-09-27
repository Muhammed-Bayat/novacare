import '../config.js';
import { createHash } from 'node:crypto';
import { getPool, closePool } from '../db.js';
import { migration as initialMigration } from './001_initial.js';
import { migration as userTypeMigration } from './002_user_type.js';
import { migration as bookingDirectoryMigration } from './002_booking_directory.js';
import { migration as generalConsultationsMigration } from './003_general_consultations.js';
import { migration as expandDirectoryAndAppointmentsMigration } from './004_expand_directory_and_appointments.js';
import { migration as importVerifiedSpecialtiesMigration } from './005_import_verified_specialties.js';
import { migration as importCompleteDirectoryMigration } from './006_import_complete_directory.js';
import { migration as correctMajorHospitalServicesMigration } from './007_correct_major_hospital_services.js';
import { migration as applyDohServicePackagesMigration } from './008_apply_doh_service_packages.js';
import { migration as patientQueuesMigration } from './009_patient_queues.js';
import { migration as patientHealthRecordsMigration } from './010_patient_health_records.js';
import { migration as staffRolesMigration } from './011_staff_roles.js';
import { migration as secureStaffInvitationsMigration } from './012_secure_staff_invitations.js';
import { migration as appointmentTriageSummaryMigration } from './013_appointment_triage_summary.js';
import { migration as queueTriageWorkflowMigration } from './014_queue_triage_workflow.js';
import { migration as appointmentCheckedInStatusMigration } from './015_appointment_checkedin_status.js';
import { migration as adminDomainMigration } from './014_admin_domain.js';
import { migration as adminSettingsMigration } from './015_admin_settings.js';

const migrations = [initialMigration, bookingDirectoryMigration, generalConsultationsMigration, expandDirectoryAndAppointmentsMigration, importVerifiedSpecialtiesMigration, importCompleteDirectoryMigration, correctMajorHospitalServicesMigration, applyDohServicePackagesMigration, patientQueuesMigration, patientHealthRecordsMigration, staffRolesMigration, userTypeMigration, secureStaffInvitationsMigration, appointmentTriageSummaryMigration, queueTriageWorkflowMigration, appointmentCheckedInStatusMigration, adminDomainMigration, adminSettingsMigration];

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
