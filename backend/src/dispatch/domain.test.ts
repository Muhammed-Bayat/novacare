import { describe, expect, it } from 'vitest';
import {
  canTransition,
  formatReferenceCode,
  InvalidTransitionError,
  nextStatuses,
  SERVICE_STATUSES,
  STATUS_TRANSITIONS,
  TERMINAL_STATUSES,
} from './domain.js';

describe('service request statuses', () => {
  it('keeps location review separate from the controlled dispatch workflow', () => {
    expect(SERVICE_STATUSES).toEqual([
      'CREATED',
      'SEARCHING',
      'NOTIFIED',
      'ACKNOWLEDGED',
      'ACCEPTED',
      'ASSIGNED',
      'DISPATCHED',
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_PROVIDER_FOUND',
    ]);
  });

  it('covers every status in the transition map', () => {
    for (const status of SERVICE_STATUSES) {
      expect(STATUS_TRANSITIONS[status], status).toBeDefined();
    }
  });
});

describe('controlled workflow transitions', () => {
  it('follows the happy path CREATED → … → COMPLETED', () => {
    const path = [
      'CREATED',
      'SEARCHING',
      'NOTIFIED',
      'ACKNOWLEDGED',
      'ASSIGNED',
      'DISPATCHED',
      'EN_ROUTE',
      'ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]}`).toBe(true);
    }
  });

  it('allows cancellation from every pre-completion operational state', () => {
    const cancellable = [
      'CREATED',
      'SEARCHING',
      'NOTIFIED',
      'ACKNOWLEDGED',
      'ACCEPTED',
      'ASSIGNED',
      'DISPATCHED',
      'EN_ROUTE',
    ] as const;
    for (const status of cancellable) {
      expect(canTransition(status, 'CANCELLED'), status).toBe(true);
    }
  });

  it('rejects backwards and skip transitions', () => {
    expect(canTransition('SEARCHING', 'CREATED')).toBe(false);
    expect(canTransition('NOTIFIED', 'ASSIGNED')).toBe(false);
    expect(canTransition('CREATED', 'NOTIFIED')).toBe(false);
    expect(canTransition('ASSIGNED', 'EN_ROUTE')).toBe(false);
    expect(canTransition('ARRIVED', 'COMPLETED')).toBe(false);
    expect(canTransition('CREATED', 'SEARCHING')).toBe(true);
  });

  it('marks COMPLETED, CANCELLED and NO_PROVIDER_FOUND as terminal', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(nextStatuses(status)).toEqual([]);
      for (const target of SERVICE_STATUSES) {
        expect(canTransition(status, target), `${status} → ${target}`).toBe(false);
      }
    }
  });

  it('exposes the allowed next statuses for the dispatcher UI', () => {
    expect(nextStatuses('NOTIFIED')).toEqual(['ACKNOWLEDGED', 'NO_PROVIDER_FOUND', 'CANCELLED']);
    expect(nextStatuses('ACKNOWLEDGED')).toEqual(['ASSIGNED', 'NO_PROVIDER_FOUND', 'CANCELLED']);
    expect(nextStatuses('IN_PROGRESS')).toEqual(['COMPLETED']);
  });

  it('carries from/to on the invalid transition error', () => {
    const error = new InvalidTransitionError('NOTIFIED', 'ASSIGNED');
    expect(error.from).toBe('NOTIFIED');
    expect(error.to).toBe('ASSIGNED');
    expect(error.message).toContain('NOTIFIED');
  });
});

describe('reference codes', () => {
  it('formats NC-<year>-<6-digit sequence>', () => {
    expect(formatReferenceCode(2026, 1)).toBe('NC-2026-000001');
    expect(formatReferenceCode(2026, 123)).toBe('NC-2026-000123');
    expect(formatReferenceCode(2027, 1_204_500)).toBe('NC-2027-1204500');
  });
});
