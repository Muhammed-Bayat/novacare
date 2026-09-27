import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getPool } from './db.js';

export type StaffRole = 'administrator' | 'nurse' | 'doctor';

export interface Membership {
  hospitalId: string;
  hospitalName: string;
  role: StaffRole;
}

export interface AccessAllowed {
  allowed: true;
}

export interface AccessDenied {
  allowed: false;
  status: 403 | 404;
  code: string;
  message: string;
}

export type AccessDecision = AccessAllowed | AccessDenied;
export type AccessScopeDecision = { allowed: true; hospitalId: string } | AccessDenied;

function allow(): AccessAllowed {
  return { allowed: true };
}

function deny(status: 403 | 404, code: string, message: string): AccessDenied {
  return { allowed: false, status, code, message };
}

const forbidden = (message = 'You do not have permission to access this resource.') => deny(403, 'FORBIDDEN', message);

/** Loads an active hospital membership for the Auth0 subject, optionally filtered by role. */
export async function loadMembership(auth0Subject: string, roles?: readonly StaffRole[]): Promise<Membership | null> {
  const result = await getPool().query<{ hospital_id: string; hospital_name: string; role: StaffRole }>(
    `SELECT hm.hospital_id, h.name AS hospital_name, hm.role
     FROM hospital_memberships hm
     JOIN users u ON u.id = hm.user_id
     JOIN hospitals h ON h.id = hm.hospital_id
     WHERE u.auth0_subject = $1 AND hm.active AND h.active
       AND ($2::text[] IS NULL OR hm.role = ANY($2::text[]))
     ORDER BY hm.created_at
     LIMIT 1`,
    [auth0Subject, roles && roles.length > 0 ? [...roles] : null],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { hospitalId: row.hospital_id, hospitalName: row.hospital_name, role: row.role };
}

/** Plan §11: role check against hospital_memberships, server-side only. */
export function decideRole(membership: Membership | null | undefined, allowedRoles: readonly StaffRole[]): AccessDecision {
  if (membership && allowedRoles.includes(membership.role)) return allow();
  return forbidden('Your account does not have the required hospital role.');
}

/**
 * Plan §11: the hospital ID always comes from the server-side membership.
 * A client-provided hospital ID is only ever honoured when it matches the membership.
 */
export function decideHospitalScope(
  membership: Membership | null | undefined,
  requestedHospitalId?: string | null,
): AccessScopeDecision {
  if (!membership) return forbidden('Hospital staff access is required.');
  if (requestedHospitalId && requestedHospitalId !== membership.hospitalId) {
    return forbidden('That hospital is outside your access.');
  }
  return { allowed: true, hospitalId: membership.hospitalId };
}

/** Plan §11: patients read/write only their own rows. Missing entity is a 404, not a 403. */
export function decideOwnership(entityOwnerId: string | null | undefined, actorUserId: string | null | undefined): AccessDecision {
  if (!entityOwnerId) return deny(404, 'NOT_FOUND', 'That record was not found.');
  if (!actorUserId || entityOwnerId !== actorUserId) return forbidden('You can only access your own records.');
  return allow();
}

export type ResourceName =
  | 'admin.team.read'
  | 'admin.team.write'
  | 'admin.schedule.read'
  | 'admin.schedule.write'
  | 'admin.departments.read'
  | 'admin.departments.write'
  | 'admin.display.read'
  | 'admin.display.write'
  | 'admin.audit.read'
  | 'admin.overview.read'
  | 'hospital.departments.read'
  | 'staff.triage.read'
  | 'staff.queue.read'
  | 'patient.record.read';

interface ResourcePolicy {
  roles: readonly StaffRole[] | 'authenticated';
  hospitalScoped: boolean;
  ownershipScoped?: boolean;
}

/** Plan §11 authorization matrix as data — the contract for authorization.test.ts. */
export const resourcePolicies: Record<ResourceName, ResourcePolicy> = {
  'admin.team.read': { roles: ['administrator'], hospitalScoped: true },
  'admin.team.write': { roles: ['administrator'], hospitalScoped: true },
  'admin.schedule.read': { roles: ['administrator'], hospitalScoped: true },
  'admin.schedule.write': { roles: ['administrator'], hospitalScoped: true },
  'admin.departments.read': { roles: ['administrator'], hospitalScoped: true },
  'admin.departments.write': { roles: ['administrator'], hospitalScoped: true },
  'admin.display.read': { roles: ['administrator'], hospitalScoped: true },
  'admin.display.write': { roles: ['administrator'], hospitalScoped: true },
  'admin.audit.read': { roles: ['administrator'], hospitalScoped: true },
  'admin.overview.read': { roles: ['administrator'], hospitalScoped: true },
  'hospital.departments.read': { roles: ['administrator', 'nurse', 'doctor'], hospitalScoped: true },
  'staff.triage.read': { roles: ['nurse'], hospitalScoped: true },
  'staff.queue.read': { roles: ['nurse', 'doctor'], hospitalScoped: true },
  'patient.record.read': { roles: 'authenticated', hospitalScoped: false, ownershipScoped: true },
};

export interface ResourceAccessInput {
  resource: ResourceName;
  membership: Membership | null;
  actorUserId?: string | null;
  entityOwnerId?: string | null;
  requestedHospitalId?: string | null;
}

/** Combined decision used by the table-driven authorization matrix. */
export function decideResourceAccess(input: ResourceAccessInput): AccessDecision {
  const policy = resourcePolicies[input.resource];
  if (!policy) return forbidden('Unknown resource.');
  if (policy.roles !== 'authenticated') {
    const role = decideRole(input.membership, policy.roles);
    if (!role.allowed) return role;
  }
  if (policy.hospitalScoped) {
    const scope = decideHospitalScope(input.membership, input.requestedHospitalId);
    if (!scope.allowed) return scope;
  }
  if (policy.ownershipScoped) {
    const ownership = decideOwnership(input.entityOwnerId, input.actorUserId ?? null);
    if (!ownership.allowed) return ownership;
  }
  return allow();
}

function denyResponse(res: Response, decision: AccessDenied): void {
  res.status(decision.status).json({ error: { code: decision.code, message: decision.message } });
}

function missingAuth(res: Response): void {
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
}

async function currentUserId(auth0Subject: string): Promise<string | null> {
  const result = await getPool().query<{ id: string }>('SELECT id FROM users WHERE auth0_subject = $1', [auth0Subject]);
  return result.rows[0]?.id ?? null;
}

function requestedHospitalHint(req: Request): string | undefined {
  const query = (req.query as Record<string, unknown>).hospitalId;
  if (typeof query === 'string' && query) return query;
  const body = req.body as Record<string, unknown> | undefined;
  const bodyHospitalId = body?.hospitalId;
  if (typeof bodyHospitalId === 'string' && bodyHospitalId) return bodyHospitalId;
  return undefined;
}

/** Requires an active membership with one of the given roles; stores it on `req.membership`. */
export function requireRole(...roles: StaffRole[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) { missingAuth(res); return; }
      const membership = await loadMembership(req.auth.subject, roles);
      const decision = decideRole(membership, roles);
      if (!decision.allowed) { denyResponse(res, decision); return; }
      req.membership = membership!;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Resolves `req.hospitalId` from the membership only — never from a client-provided hospital ID. */
export function requireHospital(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) { missingAuth(res); return; }
      const membership = req.membership ?? await loadMembership(req.auth.subject);
      const decision = decideHospitalScope(membership, requestedHospitalHint(req));
      if (!decision.allowed) { denyResponse(res, decision); return; }
      req.membership = membership!;
      req.hospitalId = decision.hospitalId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Patient-scoped guard: the loaded entity must belong to the authenticated user. */
export function requireOwnership(loadEntity: (req: Request) => Promise<{ ownerUserId: string | null } | null>): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth) { missingAuth(res); return; }
      const entity = await loadEntity(req);
      const actorUserId = await currentUserId(req.auth.subject);
      const decision = decideOwnership(entity?.ownerUserId ?? null, actorUserId);
      if (!decision.allowed) { denyResponse(res, decision); return; }
      next();
    } catch (error) {
      next(error);
    }
  };
}
