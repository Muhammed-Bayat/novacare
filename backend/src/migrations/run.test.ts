import { describe, expect, it } from 'vitest';
import { migration as initialMigration } from './001_initial.js';
import { migration as userTypeMigration } from './002_user_type.js';
import { migration as secureStaffInvitationsMigration } from './012_secure_staff_invitations.js';

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
