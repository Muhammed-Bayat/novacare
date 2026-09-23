import { describe, expect, it } from 'vitest';
import { migration } from './001_initial.js';

describe('initial migration', () => {
  it('creates the local users table', () => {
    expect(migration.name).toBe('001_initial');
    expect(migration.sql).toContain('CREATE TABLE users');
    expect(migration.sql).toContain('auth0_subject');
  });
});
