import { describe, expect, it } from 'vitest';
import {
  decideHospitalScope,
  decideOwnership,
  decideResourceAccess,
  decideRole,
  resourcePolicies,
  type Membership,
  type ResourceName,
  type StaffRole,
} from './authorization.js';

const hospitals = { own: 'hospital-a', other: 'hospital-b' };

function member(role: StaffRole, hospitalId: string = hospitals.own): Membership {
  return { hospitalId, hospitalName: 'NovaCare Demo Hospital', role };
}

type Actor = 'patient' | 'administrator' | 'nurse' | 'doctor';

const actors: Record<Actor, { membership: Membership | null; userId: string }> = {
  patient: { membership: null, userId: 'user-patient' },
  administrator: { membership: member('administrator'), userId: 'user-admin' },
  nurse: { membership: member('nurse'), userId: 'user-nurse' },
  doctor: { membership: member('doctor'), userId: 'user-doctor' },
};

interface MatrixCase {
  actor: Actor;
  resource: ResourceName;
  scope: 'own' | 'other';
  allowed: boolean;
}

const matrix: MatrixCase[] = [
  { actor: 'patient', resource: 'admin.team.read', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'admin.team.write', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'admin.schedule.write', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'admin.departments.write', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'admin.display.write', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'admin.audit.read', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'admin.overview.read', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'hospital.departments.read', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'staff.queue.read', scope: 'own', allowed: false },
  { actor: 'patient', resource: 'patient.record.read', scope: 'own', allowed: true },
  { actor: 'patient', resource: 'patient.record.read', scope: 'other', allowed: false },

  { actor: 'administrator', resource: 'admin.team.read', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.team.write', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.schedule.read', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.schedule.write', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.team.write', scope: 'other', allowed: false },
  { actor: 'administrator', resource: 'admin.schedule.write', scope: 'other', allowed: false },
  { actor: 'administrator', resource: 'admin.departments.read', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.departments.write', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.departments.write', scope: 'other', allowed: false },
  { actor: 'administrator', resource: 'admin.display.read', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.display.write', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.display.write', scope: 'other', allowed: false },
  { actor: 'administrator', resource: 'admin.audit.read', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.audit.read', scope: 'other', allowed: false },
  { actor: 'administrator', resource: 'admin.overview.read', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'admin.overview.read', scope: 'other', allowed: false },
  { actor: 'administrator', resource: 'hospital.departments.read', scope: 'own', allowed: true },
  { actor: 'administrator', resource: 'staff.triage.read', scope: 'own', allowed: false },
  { actor: 'administrator', resource: 'staff.queue.read', scope: 'own', allowed: false },
  { actor: 'administrator', resource: 'patient.record.read', scope: 'other', allowed: false },

  { actor: 'nurse', resource: 'hospital.departments.read', scope: 'own', allowed: true },
  { actor: 'nurse', resource: 'staff.triage.read', scope: 'own', allowed: true },
  { actor: 'nurse', resource: 'staff.queue.read', scope: 'own', allowed: true },
  { actor: 'nurse', resource: 'staff.triage.read', scope: 'other', allowed: false },
  { actor: 'nurse', resource: 'staff.queue.read', scope: 'other', allowed: false },
  { actor: 'nurse', resource: 'admin.team.write', scope: 'own', allowed: false },
  { actor: 'nurse', resource: 'admin.schedule.write', scope: 'own', allowed: false },
  { actor: 'nurse', resource: 'admin.departments.write', scope: 'own', allowed: false },
  { actor: 'nurse', resource: 'admin.display.write', scope: 'own', allowed: false },
  { actor: 'nurse', resource: 'admin.audit.read', scope: 'own', allowed: false },
  { actor: 'nurse', resource: 'admin.overview.read', scope: 'own', allowed: false },
  { actor: 'nurse', resource: 'patient.record.read', scope: 'own', allowed: true },
  { actor: 'nurse', resource: 'patient.record.read', scope: 'other', allowed: false },

  { actor: 'doctor', resource: 'hospital.departments.read', scope: 'own', allowed: true },
  { actor: 'doctor', resource: 'staff.queue.read', scope: 'own', allowed: true },
  { actor: 'doctor', resource: 'staff.triage.read', scope: 'own', allowed: false },
  { actor: 'doctor', resource: 'staff.queue.read', scope: 'other', allowed: false },
  { actor: 'doctor', resource: 'admin.team.read', scope: 'own', allowed: false },
  { actor: 'doctor', resource: 'admin.schedule.write', scope: 'own', allowed: false },
  { actor: 'doctor', resource: 'admin.departments.write', scope: 'own', allowed: false },
  { actor: 'doctor', resource: 'admin.display.write', scope: 'own', allowed: false },
  { actor: 'doctor', resource: 'admin.audit.read', scope: 'own', allowed: false },
  { actor: 'doctor', resource: 'admin.overview.read', scope: 'own', allowed: false },
  { actor: 'doctor', resource: 'patient.record.read', scope: 'own', allowed: true },
  { actor: 'doctor', resource: 'patient.record.read', scope: 'other', allowed: false },
];

describe('authorization matrix (Plan §11)', () => {
  it.each(matrix)('$actor → $resource in $scope hospital is $allowed', ({ actor, resource, scope, allowed }) => {
    const subject = actors[actor];
    const decision = decideResourceAccess({
      resource,
      membership: subject.membership,
      actorUserId: subject.userId,
      entityOwnerId: resource === 'patient.record.read' ? (scope === 'own' ? subject.userId : 'user-other-patient') : null,
      requestedHospitalId: scope === 'own' ? hospitals.own : hospitals.other,
    });
    expect(decision.allowed).toBe(allowed);
  });

  it('denies unknown resources', () => {
    const decision = decideResourceAccess({ resource: 'not.a.resource' as ResourceName, membership: member('administrator') });
    expect(decision.allowed).toBe(false);
  });
});

describe('decideRole', () => {
  it('allows a matching role', () => {
    expect(decideRole(member('nurse'), ['nurse']).allowed).toBe(true);
  });

  it('denies a different role', () => {
    expect(decideRole(member('nurse'), ['administrator']).allowed).toBe(false);
  });

  it('denies when there is no membership (self-signed-up patient)', () => {
    expect(decideRole(null, ['administrator']).allowed).toBe(false);
  });
});

describe('decideHospitalScope', () => {
  it('returns the hospital from the membership when the client sends none', () => {
    const decision = decideHospitalScope(member('administrator'));
    expect(decision).toEqual({ allowed: true, hospitalId: hospitals.own });
  });

  it('honours a client hospital ID only when it matches the membership', () => {
    expect(decideHospitalScope(member('administrator'), hospitals.own)).toEqual({ allowed: true, hospitalId: hospitals.own });
  });

  it('rejects a client hospital ID from another hospital', () => {
    const decision = decideHospitalScope(member('administrator'), hospitals.other);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.status).toBe(403);
  });

  it('denies staff access without a membership', () => {
    expect(decideHospitalScope(null).allowed).toBe(false);
  });
});

describe('decideOwnership', () => {
  it('allows the owner', () => {
    expect(decideOwnership('user-1', 'user-1').allowed).toBe(true);
  });

  it('denies another patient', () => {
    const decision = decideOwnership('user-1', 'user-2');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.status).toBe(403);
  });

  it('denies an anonymous actor', () => {
    expect(decideOwnership('user-1', null).allowed).toBe(false);
  });

  it('returns 404 when the entity does not exist', () => {
    const decision = decideOwnership(null, 'user-1');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.status).toBe(404);
  });
});

describe('resource policies', () => {
  it('keeps staff and schedule resources hospital-scoped', () => {
    for (const [resource, policy] of Object.entries(resourcePolicies)) {
      if (resource.startsWith('patient.')) continue;
      expect(policy.hospitalScoped).toBe(true);
    }
  });

  it('denies every hospital-scoped resource for a user without a membership', () => {
    for (const [resource, policy] of Object.entries(resourcePolicies)) {
      if (!policy.hospitalScoped) continue;
      const decision = decideResourceAccess({ resource: resource as ResourceName, membership: null });
      expect(decision.allowed, resource).toBe(false);
    }
  });

  it('only lets patients through ownership-scoped resources', () => {
    const patientOnly = Object.entries(resourcePolicies).filter(([resource]) => resource.startsWith('patient.'));
    expect(patientOnly.length).toBeGreaterThan(0);
    for (const [resource, policy] of patientOnly) {
      expect(policy.roles, resource).toBe('authenticated');
      expect(policy.ownershipScoped, resource).toBe(true);
    }
  });
});
