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
  type LocationSource,
  type LocationState,
  type ServiceRequestRow,
  type ServiceRequestTriage,
  type ServiceRequestType,
  type ServiceStatus,
  type ServiceUrgency,
  type FacilityExclusionReason,
  type FacilityMatchingDiagnostic,
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
  locationState?: LocationState;
  locationSource?: LocationSource;
  geocodedFormattedAddress?: string;
  geocodingPlaceId?: string;
  geocodingConfidence?: number;
  idempotencyKey?: string;
  locationCandidateId?: string;
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

export interface DispatcherLocationResolutionInput {
  address: string;
  latitude: number;
  longitude: number;
}

const AWAITING_ASSIGNMENT: readonly ServiceStatus[] = ['NOTIFIED', 'ACKNOWLEDGED', 'ACCEPTED'];
const DISPATCHED_STATUSES: readonly ServiceStatus[] = ['DISPATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

type DispatchFacilityRow = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  ambulance_available: boolean;
  home_visit_available: boolean;
  available_ambulance_unit: boolean;
  available_home_visit_responder: boolean;
};

type MatchingReview = {
  candidate: FacilityCandidate | null;
  diagnostic: FacilityMatchingDiagnostic;
};

function validateCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): void {
  if (latitude == null && longitude == null) return;
  if (latitude == null || longitude == null) {
    throw new DispatchValidationError('Latitude and longitude must be provided together.');
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new DispatchValidationError('Latitude and longitude must be finite numbers.');
  }
  if (latitude < -90 || latitude > 90) throw new DispatchValidationError('Latitude must be between -90 and 90.');
  if (longitude < -180 || longitude > 180) throw new DispatchValidationError('Longitude must be between -180 and 180.');
}

function hasConfirmedCoordinates(row: ServiceRequestRow): boolean {
  return row.location_state === 'LOCATION_CONFIRMED'
    && row.latitude != null
    && row.longitude != null
    && Number.isFinite(row.latitude)
    && Number.isFinite(row.longitude)
    && row.latitude >= -90
    && row.latitude <= 90
    && row.longitude >= -180
    && row.longitude <= 180;
}

function operationalFacilityName(name: string): string {
  const cleaned = name
    .replace(/^simulated facility(?:\s*[—-]\s*)?\s*/i, '')
    .replace(/^novacare demo hospital$/i, 'NovaCare')
    .trim();
  return cleaned || name;
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

  async function insertRequest(q: QueryFn, input: CreateServiceRequestInput, referenceCode: string): Promise<ServiceRequestRow | null> {
    const requestedLocationState = input.locationState ?? (input.latitude != null && input.longitude != null ? 'LOCATION_CONFIRMED' : 'DISPATCHER_LOCATION_REVIEW');
    const locationState = requestedLocationState === 'LOCATION_UNRESOLVED' ? 'DISPATCHER_LOCATION_REVIEW' : requestedLocationState;
    const locationSource = input.locationSource ?? (input.latitude != null && input.longitude != null ? 'GPS' : 'UNRESOLVED');
    const confirmed = locationState === 'LOCATION_CONFIRMED';
    const result = await q<ServiceRequestRow>(
      `INSERT INTO service_requests (
         reference_code, requester_user_id, requester_phone, type, channel, status,
          urgency, reason, triage, address, latitude, longitude, location_state,
          location_confirmation_required, location_confirmed_at, location_source,
          geocoded_formatted_address, geocoding_place_id, geocoding_confidence, idempotency_key
        ) VALUES ($1,$2,$3,$4,$5,'CREATED',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
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
        locationState,
        !confirmed,
        confirmed ? nowIso() : null,
        locationSource,
        input.geocodedFormattedAddress ?? null,
        input.geocodingPlaceId ?? null,
        input.geocodingConfidence ?? null,
        input.idempotencyKey ?? null,
      ],
    );
    return result.rows[0] ?? null;
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
    if (to === 'SEARCHING' && !hasConfirmedCoordinates(current)) {
      throw new DispatchValidationError('A confirmed location with valid coordinates is required before matching can start.');
    }

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

  async function loadDispatchFacilities(): Promise<DispatchFacilityRow[]> {
    const result = await query<DispatchFacilityRow>(
      `SELECT h.id, h.name, h.latitude, h.longitude, h.active,
              h.ambulance_available, h.home_visit_available,
              EXISTS (
                SELECT 1 FROM response_units ru
                WHERE ru.hospital_id = h.id AND ru.active AND ru.unit_type = 'AMBULANCE'
                  AND ru.status = 'AVAILABLE'
              ) AS available_ambulance_unit,
              EXISTS (
                SELECT 1 FROM hospital_memberships m
                WHERE m.hospital_id = h.id AND m.active AND m.on_duty
                  AND m.availability = 'AVAILABLE' AND m.home_visit_eligible
                  AND m.role IN ('nurse', 'doctor')
              ) AS available_home_visit_responder
       FROM hospitals h
       ORDER BY h.name, h.id`,
    );
    return result.rows;
  }

  function validFacilityCoordinates(row: DispatchFacilityRow): row is DispatchFacilityRow & GeoPoint {
    return row.latitude != null
      && row.longitude != null
      && Number.isFinite(row.latitude)
      && Number.isFinite(row.longitude)
      && row.latitude >= -90
      && row.latitude <= 90
      && row.longitude >= -180
      && row.longitude <= 180;
  }

  function reviewFacilities(
    facilities: DispatchFacilityRow[],
    origin: GeoPoint,
    type: ServiceRequestType,
  ): MatchingReview[] {
    return facilities.map((facility) => {
      const exclusionReasons: FacilityExclusionReason[] = [];
      if (!facility.active) exclusionReasons.push('FACILITY_INACTIVE');
      if (!validFacilityCoordinates(facility)) exclusionReasons.push('INVALID_COORDINATES');
      if (type === 'AMBULANCE') {
        if (!facility.ambulance_available) exclusionReasons.push('NO_AMBULANCE_CAPABILITY');
        if (!facility.available_ambulance_unit) exclusionReasons.push('NO_AVAILABLE_AMBULANCE_UNIT');
      } else {
        if (!facility.home_visit_available) exclusionReasons.push('NO_HOME_VISIT_CAPABILITY');
        if (!facility.available_home_visit_responder) exclusionReasons.push('NO_AVAILABLE_HOME_VISIT_RESPONDER');
      }
      const hasCoordinates = validFacilityCoordinates(facility);
      const distanceKm = hasCoordinates ? location.distanceKm(origin, facility) : null;
      const candidate: FacilityCandidate | null = exclusionReasons.length === 0 && hasCoordinates
        ? {
            id: facility.id,
            name: facility.name,
            latitude: facility.latitude,
            longitude: facility.longitude,
            ambulanceAvailable: facility.ambulance_available,
            homeVisitAvailable: facility.home_visit_available,
          }
        : null;
      return {
        candidate,
        diagnostic: {
          facilityId: facility.id,
          facilityName: operationalFacilityName(facility.name),
          latitude: facility.latitude,
          longitude: facility.longitude,
          distanceKm,
          eligible: false,
          exclusionReasons,
        },
      };
    });
  }

  function summarizeExclusions(diagnostics: FacilityMatchingDiagnostic[]): Record<string, number> {
    return diagnostics.reduce<Record<string, number>>((summary, diagnostic) => {
      for (const reason of diagnostic.exclusionReasons) summary[reason] = (summary[reason] ?? 0) + 1;
      return summary;
    }, {});
  }

  async function reviewMatching(request: ServiceRequestRow): Promise<{
    diagnostics: FacilityMatchingDiagnostic[];
    selected: ReturnType<typeof expandRadiusUntilCovered>['selected'];
    radiusKm: number;
    exhausted: boolean;
  }> {
    if (!hasConfirmedCoordinates(request)) {
      return { diagnostics: [], selected: [], radiusKm: 0, exhausted: false };
    }
    const origin: GeoPoint = { latitude: request.latitude!, longitude: request.longitude! };
    const reviews = reviewFacilities(await loadDispatchFacilities(), origin, request.type);
    const { selected, radiusKm, exhausted } = expandRadiusUntilCovered(
      reviews.flatMap((review) => review.candidate ? [review.candidate] : []),
      origin,
      request.type,
      config,
      location,
    );
    const selectedIds = new Set(selected.map((facility) => facility.id));
    const diagnostics = reviews.map(({ diagnostic }) => {
      const exclusionReasons = [...diagnostic.exclusionReasons];
      if (exclusionReasons.length === 0 && !selectedIds.has(diagnostic.facilityId)) {
        exclusionReasons.push('OUTSIDE_SEARCH_RADIUS');
      }
      return { ...diagnostic, eligible: exclusionReasons.length === 0, exclusionReasons };
    }).sort((a, b) =>
      (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)
      || a.facilityName.localeCompare(b.facilityName)
      || a.facilityId.localeCompare(b.facilityId),
    );
    return { diagnostics, selected, radiusKm, exhausted };
  }

  async function startMatching(created: ServiceRequestRow, actorUserId: string | null, alreadySearching = false): Promise<ServiceRequestRow> {
    if (!hasConfirmedCoordinates(created)) {
      throw new DispatchValidationError('A confirmed location with valid coordinates is required before matching can start.');
    }
    if (!alreadySearching) {
      await transition(created.id, 'SEARCHING', actorUserId, {
        note: 'Automatic dispatch search started.',
      });
    }
    await audit({
      actorUserId,
      entityType: 'service_request',
      entityId: created.id,
      action: 'DISPATCH_SEARCH_STARTED',
      metadata: { referenceCode: created.reference_code },
    });

    const { diagnostics, selected, radiusKm, exhausted } = await reviewMatching(created);
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
        metadata: { matched: 0, radiusKm, escalation: exhausted, exclusionCounts: summarizeExclusions(diagnostics) },
      });
      return transition(created.id, 'NO_PROVIDER_FOUND', null, {
        note: `No provider within ${radiusKm} km. Request logged for review.`,
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
    await audit({
      entityType: 'service_request',
      entityId: created.id,
      action: 'FACILITY_MATCHED',
      metadata: { matched: selected.length, radiusKm, escalation: exhausted, exclusionCounts: summarizeExclusions(diagnostics) },
    });

    return transition(created.id, 'NOTIFIED', null, {
      note: `${selected.length} facilities notified within ${radiusKm} km${exhausted ? ' (escalation flag: fewer than minimum at max radius)' : ''}.`,
      eventType: 'service-request:updated',
    });
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

    if (input.idempotencyKey) {
      const existing = await query<ServiceRequestRow>(
        'SELECT * FROM service_requests WHERE idempotency_key = $1',
        [input.idempotencyKey],
      );
      if (existing.rows[0]) return existing.rows[0];
    }

    let referenceCode = '';
    let created: ServiceRequestRow | undefined;
    let reused = false;
    await withTransaction(async (q) => {
      referenceCode = await allocateReferenceCode(q);
      created = await insertRequest(q, input, referenceCode) ?? undefined;
      if (!created && input.idempotencyKey) {
        const existing = await q<ServiceRequestRow>(
          'SELECT * FROM service_requests WHERE idempotency_key = $1',
          [input.idempotencyKey],
        );
        created = existing.rows[0];
        reused = true;
      }
      if (!created) throw new ServiceRequestConflictError('Could not create the service request.');
      if (reused) return;
      await insertHistory(q, created.id, null, 'CREATED', input.requesterUserId ?? null, 'Request created.');
    });
    if (!created) throw new ServiceRequestConflictError('Could not create the service request.');
    if (reused) return created;
    await audit({
      actorUserId: input.requesterUserId ?? null,
      entityType: 'service_request',
      entityId: created.id,
      action: 'SERVICE_REQUEST_CREATED',
      metadata: { referenceCode, type: input.type, channel: input.channel, urgency: created.urgency },
    });
    publish({ type: 'service-request:created', payload: publicEventPayload(created) });

    if (!hasConfirmedCoordinates(created)) return created;
    return startMatching(created, input.requesterUserId ?? null);
  }

  async function getRequest(id: string): Promise<ServiceRequestRow | null> {
    const result = await query<ServiceRequestRow>('SELECT * FROM service_requests WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async function resolveLocationForDispatcher(
    requestId: string,
    input: DispatcherLocationResolutionInput,
    actorUserId: string,
  ): Promise<ServiceRequestRow> {
    const address = input.address.trim().slice(0, 320);
    if (!address) throw new DispatchValidationError('Provide the manually verified address.');
    validateCoordinates(input.latitude, input.longitude);

    await withTransaction(async (q) => {
      const result = await q<ServiceRequestRow>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [requestId]);
      const current = result.rows[0];
      if (!current) throw new ServiceRequestNotFoundError(requestId);
      if (current.status !== 'CREATED' || current.location_state !== 'DISPATCHER_LOCATION_REVIEW') {
        throw new ServiceRequestConflictError('Only requests awaiting location review can be resolved manually.');
      }
      const updated = await q(
        `UPDATE service_requests
         SET address = $2, latitude = $3, longitude = $4, location_state = 'LOCATION_CONFIRMED',
             location_confirmation_required = false, location_confirmed_at = $5,
             location_source = 'MANUAL_DISPATCHER', status = 'SEARCHING', updated_at = $5
          WHERE id = $1 AND status = 'CREATED' AND location_state = 'DISPATCHER_LOCATION_REVIEW'`,
        [requestId, address, input.latitude, input.longitude, nowIso()],
      );
      if (updated.rowCount === 0) throw new ServiceRequestConflictError('The request is no longer awaiting location review.');
      await insertHistory(q, requestId, 'CREATED', 'SEARCHING', actorUserId, 'Dispatcher manually verified the location and started matching.');
    });

    const resolved = await getRequest(requestId);
    if (!resolved) throw new ServiceRequestNotFoundError(requestId);
    await audit({
      actorUserId,
      entityType: 'service_request',
      entityId: requestId,
      action: 'LOCATION_MANUALLY_RESOLVED',
      metadata: { source: 'MANUAL_DISPATCHER' },
    });
    await audit({
      actorUserId,
      entityType: 'service_request',
      entityId: requestId,
      action: 'STATUS_CHANGED',
      metadata: { from: 'CREATED', to: 'SEARCHING' },
    });
    publish({ type: 'service-request:status-changed', payload: publicEventPayload(resolved) });
    return startMatching(resolved, actorUserId, true);
  }

  async function getRequestByReferenceForPhone(referenceCode: string, phoneNumber: string): Promise<ServiceRequestRow | null> {
    const digits = phoneNumber.replace(/\D/g, '');
    if (!/^NC-\d{4}-\d{6}$/.test(referenceCode.trim().toUpperCase()) || !digits) return null;
    const result = await query<ServiceRequestRow>(
      `SELECT * FROM service_requests
       WHERE reference_code = $1
         AND regexp_replace(COALESCE(requester_phone, ''), '\\D', '', 'g') = $2
       LIMIT 1`,
      [referenceCode.trim().toUpperCase(), digits],
    );
    return result.rows[0] ?? null;
  }

  async function cancelRequestByReferenceForPhone(
    referenceCode: string,
    phoneNumber: string,
    reason = 'Cancelled by requester through a NovaCare channel.',
  ): Promise<ServiceRequestRow | null> {
    const request = await getRequestByReferenceForPhone(referenceCode, phoneNumber);
    if (!request) return null;
    if (TERMINAL_STATUSES.includes(request.status)) return request;
    return updateStatus(request.id, 'CANCELLED', null, { note: reason, cancelReason: reason });
  }

  async function listQueue(): Promise<{ live: ServiceRequestRow[] }> {
    const live = await query<ServiceRequestRow>(
      `SELECT * FROM service_requests
        WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'NO_PROVIDER_FOUND')
        ORDER BY created_at DESC`,
    );
    return { live: live.rows };
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
    const result = await query<{ facility_name: string }>(
      `SELECT dn.*, h.name AS facility_name
       FROM dispatch_notifications dn
       JOIN hospitals h ON h.id = dn.facility_id
       WHERE dn.request_id = $1
        ORDER BY dn.distance_km NULLS LAST, h.name, h.id`,
      [requestId],
    );
    return result.rows.map((notification) => ({
      ...notification,
      facility_name: operationalFacilityName(notification.facility_name),
    }));
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
    return {
      responders: responders.rows.map((responder) => ({ ...responder, hospital_name: operationalFacilityName(responder.hospital_name) })),
      units: units.rows.map((unit) => ({ ...unit, hospital_name: operationalFacilityName(unit.hospital_name) })),
    };
  }

  async function respondToNotification(
    requestId: string,
    facilityId: string,
    response: Extract<NotificationResponseStatus, 'ACKNOWLEDGED' | 'UNAVAILABLE'>,
    actorUserId: string | null = null,
  ): Promise<ServiceRequestRow> {
    let acknowledged = false;
    await withTransaction(async (q) => {
      const locked = await q<ServiceRequestRow>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [requestId]);
      let current = locked.rows[0];
      if (!current) throw new ServiceRequestNotFoundError(requestId);
      if (!['NOTIFIED', 'ACKNOWLEDGED'].includes(current.status)) {
        throw new InvalidTransitionError(current.status, 'ACKNOWLEDGED');
      }
      const updated = await q(
        `UPDATE dispatch_notifications
         SET response_status = $3,
              acknowledged_at = CASE WHEN $3 = 'ACKNOWLEDGED' THEN COALESCE(acknowledged_at, $4) ELSE acknowledged_at END,
             responded_at = $4
         WHERE request_id = $1 AND facility_id = $2
           AND (
             ($3 = 'ACKNOWLEDGED' AND response_status = 'PENDING')
              OR ($3 = 'UNAVAILABLE' AND response_status IN ('PENDING', 'ACKNOWLEDGED'))
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
            note: 'All facilities marked the request unavailable.',
          });
        }
        return;
      }

      if (current.status === 'NOTIFIED') {
        await transitionLocked(q, current, 'ACKNOWLEDGED', actorUserId, { note: 'Facility acknowledged the request.' });
        acknowledged = true;
        current = { ...current, status: 'ACKNOWLEDGED' };
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
      if (current.status !== 'ACKNOWLEDGED' && current.status !== 'ACCEPTED') {
        throw new InvalidTransitionError(current.status, 'ASSIGNED');
      }
      const eligible = await q(
        `SELECT 1 FROM dispatch_notifications
         WHERE request_id = $1 AND facility_id = $2 AND response_status IN ('ACKNOWLEDGED', 'AVAILABLE', 'ACCEPTED')
         FOR UPDATE`,
        [requestId, facilityId],
      );
      if (eligible.rowCount === 0) {
        throw new ServiceRequestConflictError('Only an acknowledged facility can be assigned.');
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
        throw new ServiceRequestConflictError('Assign a facility before assigning a responder or unit.');
      }

      if (target.responderId) {
        if (current.type !== 'HOME_VISIT') {
          throw new DispatchValidationError('Ambulance requests require an ambulance unit.');
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
          throw new DispatchValidationError('Home-visit requests require an eligible responder.');
        }
        const claimed = await q(
          `UPDATE response_units
           SET status = 'ASSIGNED'
           WHERE id = $1 AND hospital_id = $2 AND active AND unit_type = 'AMBULANCE' AND status = 'AVAILABLE'`,
          [target.unitId, current.assigned_facility_id],
        );
        if (claimed.rowCount === 0) throw new ServiceRequestConflictError('That response unit is not available for the assigned facility.');
        await transitionLocked(q, current, 'DISPATCHED', actorUserId, {
          note: 'Ambulance unit assigned by dispatcher.',
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
    actorUserId: string | null,
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

  async function listMatchingDiagnostics(requestId: string): Promise<FacilityMatchingDiagnostic[]> {
    const request = await getRequest(requestId);
    if (!request) throw new ServiceRequestNotFoundError(requestId);
    return (await reviewMatching(request)).diagnostics;
  }

  return {
    createServiceRequest,
    resolveLocationForDispatcher,
    getRequest,
    getRequestByReferenceForPhone,
    cancelRequestByReferenceForPhone,
    listQueue,
    listMetrics,
    listForRequester,
    listHistory,
    listNotifications,
    listMatchingDiagnostics,
    listAvailableResponders,
    respondToNotification,
    assignFacility,
    assignResponder,
    updateStatus,
  };
}

export type DispatchService = ReturnType<typeof createDispatchService>;
