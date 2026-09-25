import { describe, expect, it } from 'vitest';
import { migration as initialMigration } from './001_initial.js';
import { migration as userTypeMigration } from './002_user_type.js';

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
