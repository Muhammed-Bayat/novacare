import { getPool } from '../db.js';
import { recordAudit, type AuditEventInput } from '../audit.js';
import {
  canTransition,
  formatReferenceCode,
  type AvailableResponderRow,
  type AvailableResponders,
  type AvailableUnitRow,
  InvalidTransitionError,
  ServiceRequestConflictError,
  ServiceRequestNotFoundError,
  type NotificationResponseStatus,
  type ServiceChannel,
  type ServiceRequestRow,
  type ServiceRequestTriage,
  type ServiceRequestType,
  type ServiceStatus,
  type ServiceUrgency,
  SERVICE_STATUSES,
  TERMINAL_STATUSES,
} from './domain.js';
import {
  createHaversineLocationService,
  expandRadiusUntilCovered,
  loadRadiusConfig,
  type FacilityCandidate,
  type GeoPoint,
  type LocationService,
  type RadiusExpansionConfig,
} from './location.service.js';
import type { DispatchEvent, DispatchEventType, ServiceRequestEventPayload } from './events.js';

export type QueryResult<T> = { rows: T[]; rowCount: number | null };
export type QueryFn = <T = unknown>(text: string, params?: unknown[]) => Promise<QueryResult<T>>;

export class DispatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchValidationError';
  }
}

export interface CreateServiceRequestInput {
  channel: ServiceChannel;
  type: ServiceRequestType;
  urgency?: ServiceUrgency;
  reason?: string;
  triage?: ServiceRequestTriage;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  requesterUserId?: string | null;
  requesterPhone?: string | null;
}

export interface DispatchServiceDeps {
  query?: QueryFn;
  withTransaction?: (fn: (query: QueryFn) => Promise<void>) => Promise<void>;
  audit?: (input: AuditEventInput) => Promise<void>;
  publish?: (event: DispatchEvent) => void;
  now?: () => Date;
  config?: Partial<RadiusExpansionConfig>;
  location?: LocationService;
}

export interface DispatchMetrics {
  active: number;
  ambulance: number;
  homeVisit: number;
  awaitingAssignment: number;
  dispatched: number;
}

export interface AssignResponderTarget {
  responderId?: string;
  unitId?: string;
}

const AWAITING_ASSIGNMENT: readonly ServiceStatus[] = ['NOTIFIED', 'ACKNOWLEDGED', 'ACCEPTED'];
const DISPATCHED_STATUSES: readonly ServiceStatus[] = ['DISPATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

function validateCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): void {
  if (latitude == null && longitude == null) return;
  if (latitude == null || longitude == null) {
    throw new DispatchValidationError('Latitude and longitude must be provided together.');
  }
  if (latitude < -90 || latitude > 90) throw new DispatchValidationError('Latitude must be between -90 and 90.');
  if (longitude < -180 || longitude > 180) throw new DispatchValidationError('Longitude must be between -180 and 180.');
}

export function publicEventPayload(row: ServiceRequestRow): ServiceRequestEventPayload {
  return {
    id: row.id,
    referenceCode: row.reference_code,
    type: row.type,
    urgency: row.urgency,
    status: row.status,
    channel: row.channel,
    escalationFlag: row.escalation_flag,
    assignedFacilityId: row.assigned_facility_id,
    updatedAt: row.updated_at,
  };
}

export function createDispatchService(deps: DispatchServiceDeps = {}) {
  const query: QueryFn = deps.query ?? (<T>(text: string, params?: unknown[]) => getPool().query(text, params as never[]) as unknown as Promise<QueryResult<T>>);
  const withTransaction =
    deps.withTransaction ??
    (async (fn: (query: QueryFn) => Promise<void>): Promise<void> => {
      const client = await getPool().connect();
      const clientQuery: QueryFn = <T>(text: string, params?: unknown[]) =>
        client.query(text, params as never[]) as unknown as Promise<QueryResult<T>>;
      try {
        await client.query('BEGIN');
        await fn(clientQuery);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  const audit = deps.audit ?? recordAudit;
  const publish = deps.publish ?? ((): void => undefined);
  const now = deps.now ?? ((): Date => new Date());
  const config: RadiusExpansionConfig = { ...loadRadiusConfig(), ...deps.config };
  const location = deps.location ?? createHaversineLocationService();
  const nowIso = (): string => now().toISOString();

  async function allocateReferenceCode(q: QueryFn): Promise<string> {
    const year = now().getUTCFullYear();
    const result = await q<{ last_seq: number }>(
      `INSERT INTO service_reference_counters (year, last_seq)
       VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE SET last_seq = service_reference_counters.last_seq + 1
       RETURNING last_seq`,
      [year],
    );
    return formatReferenceCode(year, result.rows[0].last_seq);
  }

  async function insertRequest(q: QueryFn, input: CreateServiceRequestInput, referenceCode: string): Promise<ServiceRequestRow> {
    const result = await q<ServiceRequestRow>(
      `INSERT INTO service_requests (
         reference_code, requester_user_id, requester_phone, type, channel, status,
         urgency, reason, triage, address, latitude, longitude
       ) VALUES ($1,$2,$3,$4,$5,'CREATED',$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        referenceCode,
        input.requesterUserId ?? null,
        input.requesterPhone ?? null,
        input.type,
        input.channel,
        input.urgency ?? 'STANDARD',
        input.reason ?? null,
        JSON.stringify(input.triage ?? {}),
        input.address ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
      ],
    );
    return result.rows[0];
  }

  async function insertHistory(
    q: QueryFn,
    requestId: string,
    fromStatus: ServiceStatus | null,
    toStatus: ServiceStatus,
    actorUserId: string | null,
    note?: string,
  ): Promise<void> {
    await q(
      `INSERT INTO service_request_status_history (request_id, from_status, to_status, actor_user_id, note)
       VALUES ($1,$2,$3,$4,$5)`,
      [requestId, fromStatus, toStatus, actorUserId, note ?? null],
    );
  }

  type TransitionOptions = {
    note?: string;
    cancelReason?: string;
    assignedFacilityId?: string;
    assignedResponderId?: string;
    assignedUnitId?: string;
  };

  /** Applies a guarded transition while the request row is already locked. */
  async function transitionLocked(
    q: QueryFn,
    current: ServiceRequestRow,
    to: ServiceStatus,
    actorUserId: string | null,
    options: TransitionOptions = {},
  ): Promise<void> {
    if (!canTransition(current.status, to)) throw new InvalidTransitionError(current.status, to);

    const sets = ['status = $2', 'updated_at = $3'];
    const params: unknown[] = [current.id, to, nowIso()];
    const stamp = (column: string): void => {
      params.push(nowIso());
      sets.push(`${column} = $${params.length}`);
    };
    const set = (column: string, value: unknown): void => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (to === 'NOTIFIED') stamp('notified_at');
    if (to === 'ACKNOWLEDGED') stamp('acknowledged_at');
    if (to === 'ASSIGNED') stamp('assigned_at');
    if (to === 'DISPATCHED') stamp('dispatched_at');
    if (to === 'EN_ROUTE') stamp('en_route_at');
    if (to === 'ARRIVED') stamp('arrived_at');
    if (to === 'IN_PROGRESS') stamp('in_progress_at');
    if (to === 'COMPLETED') stamp('completed_at');
    if (to === 'CANCELLED') {
      stamp('cancelled_at');
      set('cancel_reason', options.cancelReason ?? options.note ?? null);
    }
    if (options.assignedFacilityId) set('assigned_facility_id', options.assignedFacilityId);
    if (options.assignedResponderId) set('assigned_responder_id', options.assignedResponderId);
    if (options.assignedUnitId) set('assigned_unit_id', options.assignedUnitId);
    params.push(current.status);
    const conditional = await q(
      `UPDATE service_requests SET ${sets.join(', ')} WHERE id = $1 AND status = $${params.length}`,
      params,
    );
    if (conditional.rowCount === 0) {
      throw new ServiceRequestConflictError(`Service request ${current.id} is no longer ${current.status}.`);
    }
    await insertHistory(q, current.id, current.status, to, actorUserId, options.note);

    // A responder/unit is exclusive only while the request is active. This occurs
    // in the same transaction as the terminal state, so a failed transition cannot
    // leave a simulated resource stuck busy.
    if (TERMINAL_STATUSES.includes(to)) {
      if (current.assigned_responder_id) {
        await q(
          "UPDATE hospital_memberships SET availability = 'AVAILABLE' WHERE id = $1 AND availability = 'BUSY'",
          [current.assigned_responder_id],
        );
      }
      if (current.assigned_unit_id) {
        await q(
          "UPDATE response_units SET status = 'AVAILABLE' WHERE id = $1 AND status IN ('ASSIGNED', 'EN_ROUTE')",
          [current.assigned_unit_id],
        );
      }
    }
    if (to === 'EN_ROUTE' && current.assigned_unit_id) {
      await q(
        "UPDATE response_units SET status = 'EN_ROUTE' WHERE id = $1 AND status = 'ASSIGNED'",
        [current.assigned_unit_id],
      );
    }
  }

  async function transition(
    requestId: string,
    to: ServiceStatus,
    actorUserId: string | null,
    options: TransitionOptions & { eventType?: DispatchEventType } = {},
  ): Promise<ServiceRequestRow> {
    let from: ServiceStatus | null = null;
    await withTransaction(async (q) => {
      const result = await q<ServiceRequestRow>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [requestId]);
      const current = result.rows[0];
      if (!current) throw new ServiceRequestNotFoundError(requestId);
      from = current.status;
      await transitionLocked(q, current, to, actorUserId, options);
    });

    const fresh = await getRequest(requestId);
    if (!fresh) throw new ServiceRequestNotFoundError(requestId);
    await audit({
      actorUserId,
      entityType: 'service_request',
      entityId: requestId,
      action: 'STATUS_CHANGED',
      metadata: { from, to },
    });
    publish({ type: options.eventType ?? 'service-request:status-changed', payload: publicEventPayload(fresh) });
    return fresh;
  }

  async function loadCandidateFacilities(type: ServiceRequestType): Promise<FacilityCandidate[]> {
    const result = await query<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      ambulance_available: boolean;
      home_visit_available: boolean;
    }>(
      `SELECT id, name, latitude, longitude, ambulance_available, home_visit_available
       FROM hospitals
       WHERE active AND latitude IS NOT NULL AND longitude IS NOT NULL
         AND (${type === 'AMBULANCE'}::boolean AND ambulance_available
              OR ${type === 'HOME_VISIT'}::boolean AND home_visit_available)`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      ambulanceAvailable: row.ambulance_available,
      homeVisitAvailable: row.home_visit_available,
    }));
  }

  /** WEB, USSD and SMS all converge on this one entry point. */
  async function createServiceRequest(input: CreateServiceRequestInput): Promise<ServiceRequestRow> {
    if (input.type !== 'AMBULANCE' && input.type !== 'HOME_VISIT') {
      throw new DispatchValidationError('type must be AMBULANCE or HOME_VISIT.');
    }
    if (input.channel !== 'WEB' && input.channel !== 'USSD' && input.channel !== 'SMS') {
      throw new DispatchValidationError('channel must be WEB, USSD or SMS.');
    }
    validateCoordinates(input.latitude, input.longitude);

    let referenceCode = '';
    let created: ServiceRequestRow | undefined;
    await withTransaction(async (q) => {
      referenceCode = await allocateReferenceCode(q);
      created = await insertRequest(q, input, referenceCode);
      await insertHistory(q, created.id, null, 'CREATED', input.requesterUserId ?? null, 'Demo request created.');
    });
    if (!created) throw new ServiceRequestConflictError('Could not create the service request.');
    await audit({
      actorUserId: input.requesterUserId ?? null,
      entityType: 'service_request',
      entityId: created.id,
      action: 'SERVICE_REQUEST_CREATED',
      metadata: { referenceCode, type: input.type, channel: input.channel, urgency: created.urgency },
    });
    publish({ type: 'service-request:created', payload: publicEventPayload(created) });

    await transition(created.id, 'SEARCHING', input.requesterUserId ?? null, {
      note: 'Automatic dispatch search started.',
    });
    await audit({
      actorUserId: input.requesterUserId ?? null,
      entityType: 'service_request',
      entityId: created.id,
      action: 'DISPATCH_SEARCH_STARTED',
      metadata: { referenceCode },
    });

    const origin: GeoPoint | null =
      input.latitude != null && input.longitude != null ? { latitude: input.latitude, longitude: input.longitude } : null;
    if (!origin) {
      return transition(created.id, 'NO_PROVIDER_FOUND', null, {
        note: 'No location provided for facility matching. Demo request logged for review.',
      });
    }

    const candidates = await loadCandidateFacilities(input.type);
    const { selected, radiusKm, exhausted } = expandRadiusUntilCovered(candidates, origin, input.type, config, location);
    await query(
      `UPDATE service_requests
       SET search_radius_km = $2, facilities_notified = $3, escalation_flag = $4, updated_at = $5
       WHERE id = $1`,
      [created.id, radiusKm, selected.length, exhausted, nowIso()],
    );
    if (selected.length === 0) {
      await audit({
        entityType: 'service_request',
        entityId: created.id,
        action: 'FACILITY_MATCHED',
        metadata: { matched: 0, radiusKm, escalation: exhausted },
      });
      return transition(created.id, 'NO_PROVIDER_FOUND', null, {
        note: `No simulated facility within ${radiusKm} km. Demo request logged for review.`,
      });
    }

    for (const facility of selected) {
      await query(
        `INSERT INTO dispatch_notifications (request_id, facility_id, distance_km)
         VALUES ($1, $2, $3)
         ON CONFLICT (request_id, facility_id) DO NOTHING`,
        [created.id, facility.id, facility.distanceKm],
      );
      await audit({
        entityType: 'service_request',
        entityId: created.id,
        action: 'FACILITY_NOTIFIED',
        metadata: { facilityId: facility.id, facilityName: facility.name, distanceKm: facility.distanceKm },
      });
    }
    const refreshed = await getRequest(created.id);
    if (!refreshed) throw new ServiceRequestNotFoundError(created.id);
    await audit({
      entityType: 'service_request',
      entityId: created.id,
      action: 'FACILITY_MATCHED',
      metadata: { matched: selected.length, radiusKm, escalation: exhausted },
    });

    return transition(created.id, 'NOTIFIED', null, {
      note: `${selected.length} simulated facilities notified within ${radiusKm} km${exhausted ? ' (escalation flag: fewer than minimum at max radius)' : ''}.`,
      eventType: 'service-request:updated',
    });
  }

  async function getRequest(id: string): Promise<ServiceRequestRow | null> {
    const result = await query<ServiceRequestRow>('SELECT * FROM service_requests WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async function listQueue(): Promise<{ live: ServiceRequestRow[]; unresolved: ServiceRequestRow[] }> {
    const live = await query<ServiceRequestRow>(
      `SELECT * FROM service_requests
       WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'NO_PROVIDER_FOUND')
       ORDER BY created_at DESC`,
    );
    const unresolved = await query<ServiceRequestRow>(
      `SELECT * FROM service_requests
       WHERE status = 'NO_PROVIDER_FOUND'
       ORDER BY created_at DESC
       LIMIT 20`,
    );
    return { live: live.rows, unresolved: unresolved.rows };
  }

  async function listMetrics(): Promise<DispatchMetrics> {
    const result = await query<{
      active: string;
      ambulance: string;
      home_visit: string;
      awaiting_assignment: string;
      dispatched: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED','CANCELLED','NO_PROVIDER_FOUND')) AS active,
         COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED','CANCELLED','NO_PROVIDER_FOUND') AND type = 'AMBULANCE') AS ambulance,
         COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED','CANCELLED','NO_PROVIDER_FOUND') AND type = 'HOME_VISIT') AS home_visit,
         COUNT(*) FILTER (WHERE status = ANY($1)) AS awaiting_assignment,
         COUNT(*) FILTER (WHERE status = ANY($2)) AS dispatched
       FROM service_requests`,
      [AWAITING_ASSIGNMENT, DISPATCHED_STATUSES],
    );
    const row = result.rows[0];
    return {
      active: Number(row.active),
      ambulance: Number(row.ambulance),
      homeVisit: Number(row.home_visit),
      awaitingAssignment: Number(row.awaiting_assignment),
      dispatched: Number(row.dispatched),
    };
  }

  async function listForRequester(userId: string): Promise<ServiceRequestRow[]> {
    const result = await query<ServiceRequestRow>(
      'SELECT * FROM service_requests WHERE requester_user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return result.rows;
  }

  async function listHistory(requestId: string): Promise<unknown[]> {
    const result = await query(
      `SELECT id, from_status, to_status, actor_user_id, note, created_at
       FROM service_request_status_history
       WHERE request_id = $1
       ORDER BY created_at`,
      [requestId],
    );
    return result.rows;
  }

  async function listNotifications(requestId: string): Promise<unknown[]> {
    const result = await query(
      `SELECT dn.*, h.name AS facility_name
       FROM dispatch_notifications dn
       JOIN hospitals h ON h.id = dn.facility_id
       WHERE dn.request_id = $1
       ORDER BY dn.distance_km`,
      [requestId],
    );
    return result.rows;
  }

  async function listAvailableResponders(): Promise<AvailableResponders> {
    const responders = await query<AvailableResponderRow>(
      `SELECT m.id, m.role, m.availability, m.home_visit_eligible, m.on_duty,
              u.display_name, u.email, h.id AS hospital_id, h.name AS hospital_name
       FROM hospital_memberships m
       JOIN users u ON u.id = m.user_id
       JOIN hospitals h ON h.id = m.hospital_id
       WHERE m.active AND m.on_duty AND m.availability = 'AVAILABLE' AND m.role IN ('nurse', 'doctor')
       ORDER BY h.name, u.display_name`,
    );
    const units = await query<AvailableUnitRow>(
      `SELECT ru.id, ru.callsign, ru.unit_type, ru.status, h.id AS hospital_id, h.name AS hospital_name
       FROM response_units ru
       JOIN hospitals h ON h.id = ru.hospital_id
       WHERE ru.active AND ru.status = 'AVAILABLE'
       ORDER BY ru.callsign`,
    );
    return { responders: responders.rows, units: units.rows };
  }

  async function respondToNotification(
    requestId: string,
    facilityId: string,
    response: Exclude<NotificationResponseStatus, 'PENDING'>,
    actorUserId: string | null = null,
  ): Promise<ServiceRequestRow> {
    let acknowledged = false;
    await withTransaction(async (q) => {
      const locked = await q<ServiceRequestRow>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [requestId]);
      let current = locked.rows[0];
      if (!current) throw new ServiceRequestNotFoundError(requestId);
      if (!['NOTIFIED', 'ACKNOWLEDGED', 'ACCEPTED'].includes(current.status)) {
        throw new InvalidTransitionError(current.status, 'ACKNOWLEDGED');
      }
      const updated = await q(
        `UPDATE dispatch_notifications
         SET response_status = $3,
             acknowledged_at = CASE WHEN $3 IN ('ACKNOWLEDGED', 'AVAILABLE', 'ACCEPTED') THEN COALESCE(acknowledged_at, $4) ELSE acknowledged_at END,
             responded_at = $4
         WHERE request_id = $1 AND facility_id = $2
           AND (
             ($3 = 'ACKNOWLEDGED' AND response_status = 'PENDING')
             OR ($3 IN ('AVAILABLE', 'ACCEPTED') AND response_status IN ('PENDING', 'ACKNOWLEDGED'))
             OR ($3 = 'UNAVAILABLE' AND response_status IN ('PENDING', 'ACKNOWLEDGED', 'AVAILABLE', 'ACCEPTED'))
           )`,
        [requestId, facilityId, response, nowIso()],
      );
      if (updated.rowCount === 0) throw new ServiceRequestConflictError('That facility has no active notification for this request.');

      if (response === 'UNAVAILABLE') {
        const remaining = await q<{ count: string }>(
          `SELECT COUNT(*) AS count FROM dispatch_notifications
           WHERE request_id = $1 AND response_status <> 'UNAVAILABLE'`,
          [requestId],
        );
        if (Number(remaining.rows[0]?.count ?? 0) === 0) {
          await transitionLocked(q, current, 'NO_PROVIDER_FOUND', actorUserId, {
            note: 'All simulated facilities marked the request unavailable.',
          });
        }
        return;
      }

      if (current.status === 'NOTIFIED') {
        await transitionLocked(q, current, 'ACKNOWLEDGED', actorUserId, { note: 'Facility acknowledged the request.' });
        acknowledged = true;
        current = { ...current, status: 'ACKNOWLEDGED' };
      }
      if ((response === 'AVAILABLE' || response === 'ACCEPTED') && current.status === 'ACKNOWLEDGED') {
        await transitionLocked(q, current, 'ACCEPTED', actorUserId, {
          note: `Facility marked ${response.toLowerCase()}.`,
        });
      }
    });

    const next = await getRequest(requestId);
    if (!next) throw new ServiceRequestNotFoundError(requestId);
    if (acknowledged) {
      await audit({
        actorUserId,
        entityType: 'service_request',
        entityId: requestId,
        action: 'REQUEST_ACKNOWLEDGED',
        metadata: { facilityId },
      });
    }
    publish({ type: 'service-request:updated', payload: publicEventPayload(next) });
    return next;
  }

  async function assignFacility(requestId: string, facilityId: string, actorUserId: string): Promise<ServiceRequestRow> {
    await withTransaction(async (q) => {
      const locked = await q<ServiceRequestRow>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [requestId]);
      const current = locked.rows[0];
      if (!current) throw new ServiceRequestNotFoundError(requestId);
      if (current.status !== 'ACCEPTED') throw new InvalidTransitionError(current.status, 'ASSIGNED');
      const eligible = await q(
        `SELECT 1 FROM dispatch_notifications
         WHERE request_id = $1 AND facility_id = $2 AND response_status IN ('AVAILABLE', 'ACCEPTED')
         FOR UPDATE`,
        [requestId, facilityId],
      );
      if (eligible.rowCount === 0) {
        throw new ServiceRequestConflictError('Only an available or accepted simulated facility can be assigned.');
      }
      await transitionLocked(q, current, 'ASSIGNED', actorUserId, {
        note: 'Facility assigned by dispatcher.',
        assignedFacilityId: facilityId,
      });
    });
    const next = await getRequest(requestId);
    if (!next) throw new ServiceRequestNotFoundError(requestId);
    await audit({
      actorUserId,
      entityType: 'service_request',
      entityId: requestId,
      action: 'FACILITY_ASSIGNED',
      metadata: { facilityId },
    });
    publish({ type: 'service-request:assigned', payload: publicEventPayload(next) });
    return next;
  }

  async function assignResponder(
    requestId: string,
    target: AssignResponderTarget,
    actorUserId: string,
  ): Promise<ServiceRequestRow> {
    if (!target.responderId && !target.unitId) {
      throw new DispatchValidationError('Provide responderId or unitId.');
    }
    if (target.responderId && target.unitId) {
      throw new DispatchValidationError('Provide responderId or unitId, not both.');
    }
    await withTransaction(async (q) => {
      const locked = await q<ServiceRequestRow>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [requestId]);
      const current = locked.rows[0];
      if (!current) throw new ServiceRequestNotFoundError(requestId);
      if (current.status !== 'ASSIGNED') throw new InvalidTransitionError(current.status, 'DISPATCHED');
      if (!current.assigned_facility_id) {
        throw new ServiceRequestConflictError('Assign a simulated facility before assigning a responder or unit.');
      }

      if (target.responderId) {
        if (current.type !== 'HOME_VISIT') {
          throw new DispatchValidationError('Ambulance requests require a simulated ambulance unit.');
        }
        const claimed = await q(
          `UPDATE hospital_memberships
           SET availability = 'BUSY'
           WHERE id = $1 AND hospital_id = $2 AND active AND on_duty
             AND availability = 'AVAILABLE' AND home_visit_eligible AND role IN ('nurse', 'doctor')`,
          [target.responderId, current.assigned_facility_id],
        );
        if (claimed.rowCount === 0) throw new ServiceRequestConflictError('That responder is not available for this facility home visit.');
        await transitionLocked(q, current, 'DISPATCHED', actorUserId, {
          note: 'Home-visit responder assigned by dispatcher.',
          assignedResponderId: target.responderId,
        });
      } else if (target.unitId) {
        if (current.type !== 'AMBULANCE') {
          throw new DispatchValidationError('Home-visit requests require an eligible simulated responder.');
        }
        const claimed = await q(
          `UPDATE response_units
           SET status = 'ASSIGNED'
           WHERE id = $1 AND hospital_id = $2 AND active AND unit_type = 'AMBULANCE' AND status = 'AVAILABLE'`,
          [target.unitId, current.assigned_facility_id],
        );
        if (claimed.rowCount === 0) throw new ServiceRequestConflictError('That response unit is not available for the assigned facility.');
        await transitionLocked(q, current, 'DISPATCHED', actorUserId, {
          note: 'Simulated ambulance unit assigned by dispatcher.',
          assignedUnitId: target.unitId,
        });
      }
    });
    const next = await getRequest(requestId);
    if (!next) throw new ServiceRequestNotFoundError(requestId);
    await audit({
      actorUserId,
      entityType: 'service_request',
      entityId: requestId,
      action: 'RESPONDER_ASSIGNED',
      metadata: { responderId: target.responderId ?? null, unitId: target.unitId ?? null },
    });
    publish({ type: 'service-request:assigned', payload: publicEventPayload(next) });
    return next;
  }

  async function updateStatus(
    requestId: string,
    to: ServiceStatus,
    actorUserId: string,
    options: { note?: string; cancelReason?: string } = {},
  ): Promise<ServiceRequestRow> {
    if (!SERVICE_STATUSES.includes(to)) {
      throw new DispatchValidationError(`Unknown status: ${String(to)}`);
    }
    const next = await transition(requestId, to, actorUserId, options);
    if (to === 'CANCELLED') {
      await audit({
        actorUserId,
        entityType: 'service_request',
        entityId: requestId,
        action: 'REQUEST_CANCELLED',
        metadata: { reason: options.cancelReason ?? null },
      });
    }
    if (to === 'COMPLETED') {
      await audit({
        actorUserId,
        entityType: 'service_request',
        entityId: requestId,
        action: 'REQUEST_COMPLETED',
        metadata: {},
      });
    }
    return next;
  }

  return {
    createServiceRequest,
    getRequest,
    listQueue,
    listMetrics,
    listForRequester,
    listHistory,
    listNotifications,
    listAvailableResponders,
    respondToNotification,
    assignFacility,
    assignResponder,
    updateStatus,
  };
}

export type DispatchService = ReturnType<typeof createDispatchService>;
