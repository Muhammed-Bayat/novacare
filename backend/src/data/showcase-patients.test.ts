import { describe, expect, it } from 'vitest';
import { parseShowcasePatientArgs } from './seed-showcase-patients.js';
import {
  SHOWCASE_APPOINTMENT_COUNT,
  SHOWCASE_QUEUE_COUNT,
  buildShowcasePatientPlan,
  selectShowcaseDepartments,
  showcasePatientPlanFingerprint,
  type ShowcaseDepartment,
} from './showcase-patients.js';

const departments: ShowcaseDepartment[] = [
  { id: 'anaesthetics', name: 'Anaesthetics' },
  { id: 'general', name: 'General consultation' },
  { id: 'internal', name: 'Internal Medicine' },
  { id: 'orthopaedics', name: 'Orthopaedics' },
  { id: 'trauma', name: 'Trauma and Emergency Services' },
];

function buildPlan(occupiedBookedSlots = new Set<string>()) {
  return buildShowcasePatientPlan({
    hospitalId: 'hospital-1',
    hospitalName: 'Helen Joseph Hospital',
    date: '2026-09-30',
    departments,
    occupiedBookedSlots,
  });
}

describe('showcase patient planning', () => {
  it('prefers the four clinical departments selected for the demo', () => {
    expect(selectShowcaseDepartments(departments).map((department) => department.name)).toEqual([
      'Trauma and Emergency Services',
      'General consultation',
      'Internal Medicine',
      'Orthopaedics',
    ]);
  });

  it('falls back deterministically and requires four active departments', () => {
    expect(selectShowcaseDepartments(departments.slice(0, 4))).toHaveLength(4);
    expect(() => selectShowcaseDepartments(departments.slice(0, 3))).toThrow('At least 4 active departments');
  });

  it('builds a full, evenly distributed operational demo', () => {
    const plan = buildPlan();

    expect(plan.patients).toHaveLength(28);
    expect(plan.appointments).toHaveLength(SHOWCASE_APPOINTMENT_COUNT);
    expect(plan.queueEntries).toHaveLength(SHOWCASE_QUEUE_COUNT);
    expect(plan.appointments.filter((entry) => entry.status === 'booked')).toHaveLength(8);
    expect(plan.appointments.filter((entry) => entry.status === 'checked_in')).toHaveLength(4);
    expect(plan.queueEntries.filter((entry) => entry.status === 'awaiting_triage')).toHaveLength(4);
    expect(plan.queueEntries.filter((entry) => entry.status === 'waiting')).toHaveLength(12);
    expect(plan.queueEntries.filter((entry) => entry.status === 'called')).toHaveLength(2);
    expect(plan.queueEntries.filter((entry) => entry.status === 'in_consultation')).toHaveLength(2);
    for (const department of plan.departments) {
      expect(plan.appointments.filter((entry) => entry.departmentId === department.id)).toHaveLength(3);
      expect(plan.queueEntries.filter((entry) => entry.departmentId === department.id)).toHaveLength(5);
    }
  });

  it('uses fictional, stable identities that cannot authenticate through Auth0', () => {
    const first = buildPlan().patients;
    const second = buildPlan().patients;

    expect(second).toEqual(first);
    expect(first.every((patient) => patient.auth0Subject.startsWith('synthetic:showcase:patient:'))).toBe(true);
    expect(first.every((patient) => patient.email.endsWith('@novacare.invalid'))).toBe(true);
    expect(new Set(first.map((patient) => patient.auth0Subject)).size).toBe(first.length);
    expect(showcasePatientPlanFingerprint(buildPlan())).toBe(showcasePatientPlanFingerprint(buildPlan()));
  });

  it('moves bookings away from occupied department slots', () => {
    const plan = buildPlan(new Set(['trauma|08:00', 'trauma|08:30']));
    const traumaTimes = plan.appointments.filter((entry) => entry.departmentId === 'trauma').map((entry) => entry.time);

    expect(traumaTimes).toEqual(['09:00', '09:30', '10:00']);
    expect(showcasePatientPlanFingerprint(plan)).not.toBe(showcasePatientPlanFingerprint(buildPlan()));
  });
});

describe('showcase patient command options', () => {
  it('parses apply and rollback previews explicitly', () => {
    expect(parseShowcasePatientArgs(['--hospital-name=Helen Joseph Hospital', '--apply', '--confirm-hospital=h1', '--confirm-plan=hash'])).toEqual({
      mode: 'apply', hospitalName: 'Helen Joseph Hospital', confirmation: 'h1', planConfirmation: 'hash', runId: undefined,
    });
    expect(parseShowcasePatientArgs(['--hospital-name=Helen Joseph Hospital', '--rollback', '--dry-run', '--run-id=run-1'])).toEqual({
      mode: 'rollback-preview', hospitalName: 'Helen Joseph Hospital', confirmation: undefined, planConfirmation: undefined, runId: 'run-1',
    });
  });

  it('rejects implicit writes and conflicting actions', () => {
    expect(() => parseShowcasePatientArgs(['--hospital-name=Helen Joseph Hospital'])).toThrow('Choose --dry-run, --apply, or --rollback');
    expect(() => parseShowcasePatientArgs(['--hospital-name=Helen Joseph Hospital', '--apply', '--rollback'])).toThrow('Choose either --apply or --rollback');
    expect(() => parseShowcasePatientArgs(['--dry-run'])).toThrow('Provide --hospital-name');
    expect(() => parseShowcasePatientArgs(['--hospital-name=Helen Joseph Hospital', '--apply', '--force'])).toThrow('Unsupported option');
    expect(() => parseShowcasePatientArgs(['--hospital-name=One', '--hospital-name=Two', '--dry-run'])).toThrow('Provide --hospital-name only once');
  });
});
