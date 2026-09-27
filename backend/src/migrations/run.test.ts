import { describe, expect, it } from 'vitest';
import { migration as initialMigration } from './001_initial.js';
import { migration as userTypeMigration } from './002_user_type.js';
import { migration as secureStaffInvitationsMigration } from './012_secure_staff_invitations.js';
import { migration as appointmentTriageSummaryMigration } from './013_appointment_triage_summary.js';
import { migration as adminDomainMigration } from './014_admin_domain.js';
import { migration as adminSettingsMigration } from './015_admin_settings.js';

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
