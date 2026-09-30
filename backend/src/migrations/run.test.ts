import { describe, expect, it } from 'vitest';
import { migration as initialMigration } from './001_initial.js';
import { migration as userTypeMigration } from './002_user_type.js';
import { migration as secureStaffInvitationsMigration } from './012_secure_staff_invitations.js';
import { migration as appointmentTriageSummaryMigration } from './013_appointment_triage_summary.js';
import { migration as adminDomainMigration } from './014_admin_domain.js';
import { migration as adminSettingsMigration } from './015_admin_settings.js';
import { migration as dispatcherRoleMigration } from './016_dispatcher_role.js';
import { migration as dispatchSchemaMigration } from './017_dispatch_schema.js';
import { migration as dispatchUnitsMigration } from './018_dispatch_units.js';
import { migration as dispatcherInvitationsMigration } from './019_dispatcher_invitations.js';
import { migration as responseUnitStatusesMigration } from './020_response_unit_statuses.js';
import { migration as dispatchStatusTimestampsMigration } from './021_dispatch_status_timestamps.js';
import { migration as locationConfirmationMigration } from './023_location_confirmation.js';
import { migration as clinicalQueueCompletionMigration } from './024_clinical_queue_completion.js';
import { migration as showcasePatientSeedTrackingMigration } from './025_showcase_patient_seed_tracking.js';

describe('initial migration', () => {
  it('creates the local users table', () => {
    expect(initialMigration.name).toBe('001_initial');
    expect(initialMigration.sql).toContain('CREATE TABLE users');
    expect(initialMigration.sql).toContain('auth0_subject');
  });
});

describe('user type migration', () => {
  it('adds a constrained user_type column', () => {
    expect(userTypeMigration.name).toBe('002_user_type');
    expect(userTypeMigration.sql).toContain('ADD COLUMN user_type');
    expect(userTypeMigration.sql).toContain("DEFAULT 'patient'");
    expect(userTypeMigration.sql).toContain("'staff'");
    expect(userTypeMigration.sql).toContain("'admin'");
  });
});

describe('secure staff invitations migration', () => {
  it('adds expiring hashed invitation tokens', () => {
    expect(secureStaffInvitationsMigration.name).toBe('012_secure_staff_invitations');
    expect(secureStaffInvitationsMigration.sql).toContain('token_hash');
    expect(secureStaffInvitationsMigration.sql).toContain('expires_at');
    expect(secureStaffInvitationsMigration.sql).toContain('staff_invitations_token_hash_key');
  });
});

describe('appointment triage summary migration', () => {
  it('adds questionnaire summary fields to appointments', () => {
    expect(appointmentTriageSummaryMigration.name).toBe('013_appointment_triage_summary');
    expect(appointmentTriageSummaryMigration.sql).toContain('triage_urgency');
    expect(appointmentTriageSummaryMigration.sql).toContain('triage_summary');
    expect(appointmentTriageSummaryMigration.sql).toContain('triage_red_flags');
  });
});

describe('admin domain migration', () => {
  it('reconciles hospital_services into a single departments concept', () => {
    expect(adminDomainMigration.name).toBe('014_admin_domain');
    expect(adminDomainMigration.sql).toContain('ALTER TABLE hospital_services RENAME TO departments');
    expect(adminDomainMigration.sql).toContain('average_consultation_minutes');
  });

  it('creates appointment slots with capacity and duplicate protection', () => {
    expect(adminDomainMigration.sql).toContain('CREATE TABLE appointment_slots');
    expect(adminDomainMigration.sql).toContain('capacity INT NOT NULL CHECK (capacity >= 1)');
    expect(adminDomainMigration.sql).toContain('reserved_count');
    expect(adminDomainMigration.sql).toContain('UNIQUE (department_id, slot_date, start_time)');
  });

  it('creates audit events for staff actions', () => {
    expect(adminDomainMigration.sql).toContain('CREATE TABLE audit_events');
    expect(adminDomainMigration.sql).toContain('actor_user_id');
    expect(adminDomainMigration.sql).toContain('entity_type');
    expect(adminDomainMigration.sql).toContain('metadata JSONB');
  });
});

describe('admin settings migration', () => {
  it('adds a public display token to hospitals', () => {
    expect(adminSettingsMigration.name).toBe('015_admin_settings');
    expect(adminSettingsMigration.sql).toContain('ADD COLUMN display_token TEXT UNIQUE');
    expect(adminSettingsMigration.sql).toContain('display_active');
  });

  it('carries department assignments on invitations and memberships', () => {
    expect(adminSettingsMigration.sql).toContain('department_ids UUID[]');
    expect(adminSettingsMigration.sql).toContain('CREATE TABLE membership_departments');
    expect(adminSettingsMigration.sql).toContain('PRIMARY KEY (membership_id, department_id)');
  });
});

describe('dispatch migrations', () => {
  it('adds the dispatcher role and responder availability fields', () => {
    expect(dispatcherRoleMigration.name).toBe('016_dispatcher_role');
    expect(dispatcherRoleMigration.sql).toContain("'dispatcher'");
    expect(dispatcherRoleMigration.sql).toContain('home_visit_eligible');
  });

  it('creates the request, history, notification, and reference tables', () => {
    expect(dispatchSchemaMigration.name).toBe('017_dispatch_schema');
    expect(dispatchSchemaMigration.sql).toContain('CREATE TABLE service_requests');
    expect(dispatchSchemaMigration.sql).toContain('CREATE TABLE service_request_status_history');
    expect(dispatchSchemaMigration.sql).toContain('CREATE TABLE dispatch_notifications');
    expect(dispatchSchemaMigration.sql).toContain('CREATE TABLE service_reference_counters');
  });

  it('adds response-unit assignment and supported operational states', () => {
    expect(dispatchUnitsMigration.sql).toContain('assigned_unit_id');
    expect(dispatcherInvitationsMigration.sql).toContain("'dispatcher'");
    expect(responseUnitStatusesMigration.sql).toContain("'EN_ROUTE'");
    expect(responseUnitStatusesMigration.sql).toContain("'OUT_OF_SERVICE'");
    expect(dispatchStatusTimestampsMigration.sql).toContain('dispatched_at');
  });

  it('adds location confirmation metadata without altering the existing dispatch status constraint', () => {
    expect(locationConfirmationMigration.name).toBe('023_location_confirmation');
    expect(locationConfirmationMigration.sql).toContain("ADD COLUMN location_state TEXT NOT NULL DEFAULT 'LEGACY'");
    expect(locationConfirmationMigration.sql).toContain("ADD COLUMN location_source TEXT NOT NULL DEFAULT 'LEGACY'");
    expect(locationConfirmationMigration.sql).toContain('CREATE TABLE location_confirmation_candidates');
    expect(locationConfirmationMigration.sql).not.toMatch(/DROP\s+(?:CONSTRAINT|COLUMN|TABLE)/i);
    expect(locationConfirmationMigration.sql).not.toMatch(/RENAME\s+COLUMN/i);
    expect(locationConfirmationMigration.sql).not.toContain('service_requests_status_check');
    expect(locationConfirmationMigration.sql).not.toContain('service_requests_coordinate_');
  });
});

describe('clinical queue completion migration', () => {
  it('links diagnoses to completed consultations and protects active queues', () => {
    expect(clinicalQueueCompletionMigration.name).toBe('024_clinical_queue_completion');
    expect(clinicalQueueCompletionMigration.sql).toContain("'awaiting_triage', 'waiting', 'called', 'in_consultation'");
    expect(clinicalQueueCompletionMigration.sql).toContain('ADD COLUMN queue_entry_id');
    expect(clinicalQueueCompletionMigration.sql).toContain('ADD COLUMN diagnosed_by');
    expect(clinicalQueueCompletionMigration.sql).toContain('clinical_diagnoses_one_per_queue_entry');
  });
});

describe('showcase patient seed tracking migration', () => {
  it('tracks seed-owned records and permits a new run after rollback', () => {
    expect(showcasePatientSeedTrackingMigration.name).toBe('025_showcase_patient_seed_tracking');
    expect(showcasePatientSeedTrackingMigration.sql).toContain('CREATE TABLE showcase_patient_seed_runs');
    expect(showcasePatientSeedTrackingMigration.sql).toContain('CREATE TABLE showcase_patient_seed_records');
    expect(showcasePatientSeedTrackingMigration.sql).toContain('WHERE rolled_back_at IS NULL');
  });
});
