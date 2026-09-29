import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDispatchService,
  DispatchValidationError,
  type QueryResult,
  type QueryFn,
} from './dispatch.service.js';
import {
  InvalidTransitionError,
  ServiceRequestConflictError,
  ServiceRequestNotFoundError,
  type ServiceChannel,
  type ServiceRequestRow,
  type ServiceRequestType,
  type ServiceStatus,
  type ServiceUrgency,
} from './domain.js';
import type { DispatchEvent } from './events.js';
import type { FacilityCandidate } from './location.service.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const ORIGIN = { latitude: -26.1076, longitude: 28.0567 };
const DISPATCHER = 'user-dispatcher-1';

type MembershipAvailability = 'AVAILABLE' | 'BUSY' | 'OFF_DUTY';
type UnitStatus = 'AVAILABLE' | 'ASSIGNED' | 'EN_ROUTE' | 'OUT_OF_SERVICE';
type ResponseStatus = 'PENDING' | 'ACKNOWLEDGED' | 'AVAILABLE' | 'UNAVAILABLE' | 'ACCEPTED';

type MembershipRow = { id: string; on_duty: boolean; availability: MembershipAvailability; hospital_id?: string; home_visit_eligible?: boolean; role?: 'nurse' | 'doctor' };
type UnitRow = { id: string; active: boolean; status: UnitStatus; hospital_id?: string };
type NotificationRow = {
  request_id: string;
  facility_id: string;
  distance_km: number;
  response_status: ResponseStatus;
  acknowledged_at: string | null;
  responded_at: string | null;
};
type HistoryRow = {
  request_id: string;
  from_status: ServiceStatus | null;
  to_status: ServiceStatus;
  actor_user_id: string | null;
  note: string | null;
};
type FacilityDbRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  ambulance_available: boolean;
  home_visit_available: boolean;
};

function ok<T>(rows: T[]): QueryResult<T> {
  return { rows, rowCount: rows.length };
}

function dbFacility(candidate: FacilityCandidate): FacilityDbRow {
  return {
    id: candidate.id,
    name: candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    ambulance_available: candidate.ambulanceAvailable,
    home_visit_available: candidate.homeVisitAvailable,
  };
}

/** In-memory stand-in for the dispatch SQL surface. */
class FakeDb {
  requests = new Map<string, ServiceRequestRow>();
  counters = new Map<number, number>();
  notifications: NotificationRow[] = [];
  history: HistoryRow[] = [];
  memberships = new Map<string, MembershipRow>();
  units = new Map<string, UnitRow>();
  facilities: FacilityCandidate[] = [];
  /** Test hook: pretend another transaction won the race. */
  conflictOnNextTransitionUpdate = false;
  private seq = 0;

  query: QueryFn = async <T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> => {
    if (text.includes('SELECT * FROM service_requests') && text.includes('FOR UPDATE')) {
      const row = this.requests.get(String(params[0]));
      return ok(row ? [structuredClone(row)] : []) as QueryResult<T>;
    }
    if (text.includes("regexp_replace(COALESCE(requester_phone, ''), '\\D', '', 'g')")) {
      const referenceCode = String(params[0]);
      const phoneDigits = String(params[1]);
      const row = [...this.requests.values()].find((request) =>
        request.reference_code === referenceCode && request.requester_phone?.replace(/\D/g, '') === phoneDigits,
      );
      return ok(row ? [structuredClone(row)] : []) as QueryResult<T>;
    }
    if (text.includes('SELECT 1 FROM dispatch_notifications')) {
      const note = this.notifications.find((n) =>
        n.request_id === params[0] && n.facility_id === params[1] && ['AVAILABLE', 'ACCEPTED'].includes(n.response_status),
      );
      return ok(note ? [{}] : []) as QueryResult<T>;
    }
    if (text.includes('service_reference_counters')) {
      const year = Number(params[0]);
      const next = (this.counters.get(year) ?? 0) + 1;
      this.counters.set(year, next);
      return ok([{ last_seq: next }]) as QueryResult<T>;
    }
    if (text.includes('INSERT INTO service_requests')) {
      const row = this.buildRequest(params);
      this.requests.set(row.id, row);
      return ok([structuredClone(row)]) as QueryResult<T>;
    }
    if (text.includes('INSERT INTO service_request_status_history')) {
      this.history.push({
        request_id: String(params[0]),
        from_status: params[1] as ServiceStatus | null,
        to_status: params[2] as ServiceStatus,
        actor_user_id: params[3] as string | null,
        note: params[4] as string | null,
      });
      return ok([]) as QueryResult<T>;
    }
    if (text.includes('INSERT INTO dispatch_notifications')) {
      this.notifications.push({
        request_id: String(params[0]),
        facility_id: String(params[1]),
        distance_km: Number(params[2]),
        response_status: 'PENDING',
        acknowledged_at: null,
        responded_at: null,
      });
      return ok([{}]) as QueryResult<T>;
    }
    if (text.includes('UPDATE dispatch_notifications')) {
      const target = this.notifications.find(
        (n) => {
          const response = params[2] as ResponseStatus;
          const allowed = response === 'ACKNOWLEDGED'
            ? n.response_status === 'PENDING'
            : response === 'UNAVAILABLE'
              ? n.response_status !== 'UNAVAILABLE'
              : n.response_status === 'PENDING' || n.response_status === 'ACKNOWLEDGED';
          return n.request_id === params[0] && n.facility_id === params[1] && allowed;
        },
      );
      if (!target) return { rows: [], rowCount: 0 } as QueryResult<T>;
      target.response_status = params[2] as ResponseStatus;
      if (target.response_status !== 'UNAVAILABLE') target.acknowledged_at = target.acknowledged_at ?? NOW_ISO;
      target.responded_at = NOW_ISO;
      return ok([{}]) as QueryResult<T>;
    }
    if (text.includes('COUNT(*) AS count FROM dispatch_notifications')) {
      const count = this.notifications.filter((n) => n.request_id === params[0] && n.response_status !== 'UNAVAILABLE').length;
      return ok([{ count: String(count) }]) as QueryResult<T>;
    }
    if (text.includes('UPDATE hospital_memberships')) {
      const membership = this.memberships.get(String(params[0]));
      if (text.includes("SET availability = 'AVAILABLE'")) {
        if (!membership || membership.availability !== 'BUSY') return { rows: [], rowCount: 0 } as QueryResult<T>;
        membership.availability = 'AVAILABLE';
        return ok([{}]) as QueryResult<T>;
      }
      if (!membership || !membership.on_duty || membership.availability !== 'AVAILABLE') {
        return { rows: [], rowCount: 0 } as QueryResult<T>;
      }
      if (membership.hospital_id && membership.hospital_id !== params[1]) return { rows: [], rowCount: 0 } as QueryResult<T>;
      if (membership.home_visit_eligible === false || (membership.role && !['nurse', 'doctor'].includes(membership.role))) return { rows: [], rowCount: 0 } as QueryResult<T>;
      membership.availability = 'BUSY';
      return ok([{}]) as QueryResult<T>;
    }
    if (text.includes('UPDATE response_units')) {
      const unit = this.units.get(String(params[0]));
      if (text.includes("SET status = 'AVAILABLE'")) {
        if (!unit || (unit.status !== 'ASSIGNED' && unit.status !== 'EN_ROUTE')) return { rows: [], rowCount: 0 } as QueryResult<T>;
        unit.status = 'AVAILABLE';
        return ok([{}]) as QueryResult<T>;
      }
      if (text.includes("SET status = 'EN_ROUTE'")) {
        if (!unit || unit.status !== 'ASSIGNED') return { rows: [], rowCount: 0 } as QueryResult<T>;
        unit.status = 'EN_ROUTE';
        return ok([{}]) as QueryResult<T>;
      }
      if (!unit || !unit.active || unit.status !== 'AVAILABLE') {
        return { rows: [], rowCount: 0 } as QueryResult<T>;
      }
      if (unit.hospital_id && unit.hospital_id !== params[1]) return { rows: [], rowCount: 0 } as QueryResult<T>;
      unit.status = 'ASSIGNED';
      return ok([{}]) as QueryResult<T>;
    }
    if (text.includes('assigned_facility_id') && !text.includes('status = $2')) {
      return this.patchRequest(String(params[0]), { assigned_facility_id: String(params[1]) }) as QueryResult<T>;
    }
    if (text.includes('assigned_responder_id') && !text.includes('status = $2')) {
      return this.patchRequest(String(params[0]), { assigned_responder_id: String(params[1]) }) as QueryResult<T>;
    }
    if (text.includes('assigned_unit_id') && !text.includes('status = $2')) {
      return this.patchRequest(String(params[0]), { assigned_unit_id: String(params[1]) }) as QueryResult<T>;
    }
    if (text.includes('search_radius_km')) {
      return this.patchRequest(String(params[0]), {
        search_radius_km: Number(params[1]),
        facilities_notified: Number(params[2]),
        escalation_flag: Boolean(params[3]),
      }) as QueryResult<T>;
    }
    if (text.includes("location_source = 'MANUAL_DISPATCHER'")) {
      const row = this.requests.get(String(params[0]));
      if (!row || row.status !== 'CREATED' || row.location_state !== 'DISPATCHER_LOCATION_REVIEW') return { rows: [], rowCount: 0 } as QueryResult<T>;
      Object.assign(row, {
        address: String(params[1]),
        latitude: Number(params[2]),
        longitude: Number(params[3]),
        location_state: 'LOCATION_CONFIRMED',
        location_confirmation_required: false,
        location_confirmed_at: String(params[4]),
        location_source: 'MANUAL_DISPATCHER',
        status: 'SEARCHING',
        updated_at: String(params[4]),
      });
      return ok([{}]) as QueryResult<T>;
    }
    if (text.startsWith('UPDATE service_requests')) {
      const slot = /status = \$(\d+)\s*$/.exec(text);
      const expected = slot ? params[Number(slot[1]) - 1] : undefined;
      const row = this.requests.get(String(params[0]));
      if (this.conflictOnNextTransitionUpdate) {
        this.conflictOnNextTransitionUpdate = false;
        return { rows: [], rowCount: 0 } as QueryResult<T>;
      }
      if (!row || row.status !== expected) return { rows: [], rowCount: 0 } as QueryResult<T>;
      row.status = params[1] as ServiceStatus;
      row.updated_at = NOW_ISO;
      for (const column of ['notified_at', 'acknowledged_at', 'assigned_at', 'completed_at', 'cancelled_at'] as const) {
        if (text.includes(column)) row[column] = NOW_ISO;
      }
      for (const [column, field] of [
        ['assigned_facility_id', 'assigned_facility_id'],
        ['assigned_responder_id', 'assigned_responder_id'],
        ['assigned_unit_id', 'assigned_unit_id'],
      ] as const) {
        const match = new RegExp(`${column} = \\$(\\d+)`).exec(text);
        if (match) row[field] = String(params[Number(match[1]) - 1]);
      }
      if (text.includes('cancel_reason')) row.cancel_reason = params[params.length - 2] as string | null;
      return ok([{}]) as QueryResult<T>;
    }
    if (text.includes('FROM hospitals')) {
      return ok(this.facilities.map(dbFacility)) as QueryResult<T>;
    }
    if (text.includes('COUNT(*) FILTER')) {
      const live = [...this.requests.values()].filter((r) => !['COMPLETED', 'CANCELLED', 'NO_PROVIDER_FOUND'].includes(r.status));
      const awaiting = ['NOTIFIED', 'ACKNOWLEDGED', 'ACCEPTED'];
      const dispatched = ['DISPATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
      return ok([
        {
          active: String(live.length),
          ambulance: String(live.filter((r) => r.type === 'AMBULANCE').length),
          home_visit: String(live.filter((r) => r.type === 'HOME_VISIT').length),
          awaiting_assignment: String([...this.requests.values()].filter((r) => awaiting.includes(r.status)).length),
          dispatched: String([...this.requests.values()].filter((r) => dispatched.includes(r.status)).length),
        },
      ]) as QueryResult<T>;
    }
    if (text.includes('requester_user_id = $1')) {
      return ok([...this.requests.values()].filter((r) => r.requester_user_id === params[0])) as QueryResult<T>;
    }
    if (text.includes('FROM service_request_status_history')) {
      return ok(this.history.filter((h) => h.request_id === params[0])) as QueryResult<T>;
    }
    if (text.includes('dispatch_notifications dn')) {
      const rows = this.notifications
        .filter((n) => n.request_id === params[0])
        .map((n) => ({
          ...n,
          facility_name: this.facilities.find((f) => f.id === n.facility_id)?.name ?? 'Unknown facility',
        }));
      return ok(rows) as QueryResult<T>;
    }
    if (text.includes("location_state = 'DISPATCHER_LOCATION_REVIEW'")) {
      return ok([...this.requests.values()].filter((r) =>
        r.status === 'NO_PROVIDER_FOUND' || (!['COMPLETED', 'CANCELLED', 'NO_PROVIDER_FOUND'].includes(r.status) && r.location_state === 'DISPATCHER_LOCATION_REVIEW'),
      )) as QueryResult<T>;
    }
    if (text.includes('WHERE id = $1')) {
      const row = this.requests.get(String(params[0]));
      return ok(row ? [structuredClone(row)] : []) as QueryResult<T>;
    }
    if (text.includes('SELECT * FROM service_requests')) {
      const live = [...this.requests.values()].filter((r) =>
        !['COMPLETED', 'CANCELLED', 'NO_PROVIDER_FOUND'].includes(r.status) && r.location_state !== 'DISPATCHER_LOCATION_REVIEW',
      );
      return ok(live) as QueryResult<T>;
    }
    throw new Error(`Unexpected SQL in fake: ${text.slice(0, 80)}`);
  };

  private patchRequest(id: string, patch: Partial<ServiceRequestRow>): QueryResult<unknown> {
    const row = this.requests.get(id);
    if (!row) return { rows: [], rowCount: 0 };
    Object.assign(row, patch, { updated_at: NOW_ISO });
    return { rows: [{}], rowCount: 1 };
  }

  private buildRequest(params: unknown[]): ServiceRequestRow {
    const [referenceCode, requesterUserId, requesterPhone, type, channel, urgency, reason, triageJson, address, latitude, longitude, locationState, locationConfirmationRequired, locationConfirmedAt, locationSource, geocodedFormattedAddress, geocodingPlaceId, geocodingConfidence, idempotencyKey] =
      params as [string, string | null, string | null, ServiceRequestType, ServiceChannel, ServiceUrgency, string | null, string, string | null, number | null, number | null, ServiceRequestRow['location_state'], boolean, string | null, ServiceRequestRow['location_source'], string | null, string | null, number | null, string | null];
    this.seq += 1;
    return {
      id: `req-${this.seq}`,
      reference_code: referenceCode,
      requester_user_id: requesterUserId,
      requester_phone: requesterPhone,
      type,
      channel,
      status: 'CREATED',
      urgency,
      reason,
      triage: JSON.parse(triageJson) as ServiceRequestRow['triage'],
      address,
      latitude,
      longitude,
      location_state: locationState,
      location_confirmation_required: locationConfirmationRequired,
      location_confirmed_at: locationConfirmedAt,
      location_source: locationSource,
      geocoded_formatted_address: geocodedFormattedAddress,
      geocoding_place_id: geocodingPlaceId,
      geocoding_confidence: geocodingConfidence,
      idempotency_key: idempotencyKey,
      search_radius_km: null,
      facilities_notified: null,
      escalation_flag: false,
      assigned_facility_id: null,
      assigned_responder_id: null,
      assigned_unit_id: null,
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
      notified_at: null,
      acknowledged_at: null,
      assigned_at: null,
      completed_at: null,
      cancelled_at: null,
      cancel_reason: null,
    };
  }
}

function facility(
  id: string,
  latitude: number,
  longitude: number,
  caps: Partial<Pick<FacilityCandidate, 'ambulanceAvailable' | 'homeVisitAvailable'>> = {},
): FacilityCandidate {
  return {
    id,
    name: `Simulated Facility ${id}`,
    latitude,
    longitude,
    ambulanceAvailable: caps.ambulanceAvailable ?? true,
    homeVisitAvailable: caps.homeVisitAvailable ?? true,
  };
}

const NEAR = facility('near', -26.1076, 28.0567 + 0.03);
const MID = facility('mid', -26.1076 + 0.07, 28.0567);
const FAR = facility('far', -26.1076 + 0.13, 28.0567);
const STANDARD_CONFIG = { initialRadiusKm: 5, radiusIncrementKm: 5, minFacilities: 3, maxRadiusKm: 50 };

type AuditCall = { action: string; entityId: string | null; metadata: Record<string, unknown>; actorUserId: string | null };

describe('dispatch service', () => {
  let db: FakeDb;
  let audits: AuditCall[];
  let events: DispatchEvent[];
  let service: ReturnType<typeof createDispatchService>;

  beforeEach(() => {
    db = new FakeDb();
    audits = [];
    events = [];
    service = createDispatchService({
      query: db.query,
      withTransaction: (fn) => fn(db.query),
      audit: async (input) => {
        audits.push({
          action: input.action,
          entityId: input.entityId ?? null,
          metadata: (input.metadata ?? {}) as Record<string, unknown>,
          actorUserId: input.actorUserId ?? null,
        });
      },
      publish: (event) => events.push(event),
      now: () => NOW,
      config: STANDARD_CONFIG,
    });
  });

  function createInput(overrides: Partial<Parameters<typeof service.createServiceRequest>[0]> = {}) {
    return {
      channel: 'WEB' as const,
      type: 'AMBULANCE' as const,
      urgency: 'EMERGENCY' as const,
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      requesterUserId: 'user-patient-1',
      requesterPhone: '+27820000001',
      triage: { ambulanceReason: 'chest-pain', conscious: 'YES' as const },
      ...overrides,
    };
  }

  describe('createServiceRequest validation', () => {
    it('rejects an unknown request type', async () => {
      await expect(service.createServiceRequest(createInput({ type: 'HELICOPTER' as never }))).rejects.toBeInstanceOf(DispatchValidationError);
    });

    it('rejects an unknown channel', async () => {
      await expect(service.createServiceRequest(createInput({ channel: 'FAX' as never }))).rejects.toBeInstanceOf(DispatchValidationError);
    });

    it('rejects a latitude without a longitude', async () => {
      await expect(service.createServiceRequest(createInput({ longitude: undefined }))).rejects.toBeInstanceOf(DispatchValidationError);
    });

    it('rejects out-of-range coordinates', async () => {
      await expect(service.createServiceRequest(createInput({ latitude: 91 }))).rejects.toBeInstanceOf(DispatchValidationError);
      await expect(service.createServiceRequest(createInput({ longitude: -181 }))).rejects.toBeInstanceOf(DispatchValidationError);
    });
  });

  describe('reference codes', () => {
    it('allocates sequential NC-<year>-###### codes per year', async () => {
      db.facilities = [NEAR, MID, FAR];
      const first = await service.createServiceRequest(createInput());
      const second = await service.createServiceRequest(createInput());
      expect(first.reference_code).toBe('NC-2026-000001');
      expect(second.reference_code).toBe('NC-2026-000002');
    });
  });

  describe('channel reference access', () => {
    it('only exposes and cancels a request for its normalized requester phone number', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput({ channel: 'SMS', requesterPhone: '+27 82 000 0001' }));

      await expect(service.getRequestByReferenceForPhone(request.reference_code, '+27820000001')).resolves.toMatchObject({ id: request.id });
      await expect(service.getRequestByReferenceForPhone(request.reference_code, '+27820000000')).resolves.toBeNull();

      const cancelled = await service.cancelRequestByReferenceForPhone(request.reference_code, '+27820000001');
      expect(cancelled).toMatchObject({ id: request.id, status: 'CANCELLED' });
      expect(events.at(-1)).toMatchObject({ type: 'service-request:status-changed', payload: { status: 'CANCELLED' } });
    });
  });

  describe('facility matching', () => {
    it('runs the full happy path to NOTIFIED with notifications for capable facilities', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput());

      expect(request.status).toBe('NOTIFIED');
      expect(request.search_radius_km).toBe(15);
      expect(request.facilities_notified).toBe(3);
      expect(request.escalation_flag).toBe(false);
      expect(request.notified_at).toBe(NOW_ISO);

      const history = db.history.filter((h) => h.request_id === request.id).map((h) => h.to_status);
      expect(history).toEqual(['CREATED', 'SEARCHING', 'NOTIFIED']);

      const notified = db.notifications.filter((n) => n.request_id === request.id);
      expect(notified).toHaveLength(3);
      expect(notified.map((n) => n.response_status)).toEqual(['PENDING', 'PENDING', 'PENDING']);

      const actions = audits.filter((a) => a.entityId === request.id).map((a) => a.action);
      expect(actions).toEqual([
        'SERVICE_REQUEST_CREATED',
        'STATUS_CHANGED',
        'DISPATCH_SEARCH_STARTED',
        'FACILITY_NOTIFIED',
        'FACILITY_NOTIFIED',
        'FACILITY_NOTIFIED',
        'FACILITY_MATCHED',
        'STATUS_CHANGED',
      ]);
      const matched = audits.find((a) => a.action === 'FACILITY_MATCHED');
      expect(matched?.metadata).toMatchObject({ matched: 3, radiusKm: 15, escalation: false });
    });

    it('uses the identical matching and event pipeline for WEB, USSD, and SMS inputs', async () => {
      db.facilities = [NEAR, MID, FAR];
      const requests = await Promise.all(
        (['WEB', 'USSD', 'SMS'] as const).map((channel) => service.createServiceRequest(createInput({ channel }))),
      );

      expect(requests.map((request) => request.channel)).toEqual(['WEB', 'USSD', 'SMS']);
      expect(requests.map((request) => request.status)).toEqual(['NOTIFIED', 'NOTIFIED', 'NOTIFIED']);
      expect(requests.map((request) => request.facilities_notified)).toEqual([3, 3, 3]);
      expect(requests.map((request) => request.search_radius_km)).toEqual([15, 15, 15]);
      expect(events.filter((event) => event.type === 'service-request:created').map((event) => event.payload.channel)).toEqual(['WEB', 'USSD', 'SMS']);
    });

    it('filters candidates by request capability', async () => {
      db.facilities = [
        facility('amb-only', -26.1076, 28.0567 + 0.03, { ambulanceAvailable: true, homeVisitAvailable: false }),
        facility('hv-only', -26.1076, 28.0567 + 0.04, { ambulanceAvailable: false, homeVisitAvailable: true }),
        MID,
        FAR,
      ];
      const ambulance = await service.createServiceRequest(createInput());
      expect(db.notifications.filter((n) => n.request_id === ambulance.id).map((n) => n.facility_id)).not.toContain('hv-only');

      const homeVisit = await service.createServiceRequest(
        createInput({ type: 'HOME_VISIT', urgency: 'STANDARD', triage: { preferredResponder: 'NURSE' } }),
      );
      expect(db.notifications.filter((n) => n.request_id === homeVisit.id).map((n) => n.facility_id)).not.toContain('amb-only');
    });

    it('uses dispatcher location state without starting matching when no confirmed coordinates are provided', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput({ latitude: null, longitude: null, address: 'Corner of Demo & Test, Sandton' }));
      expect(request.status).toBe('CREATED');
      expect(request.location_state).toBe('DISPATCHER_LOCATION_REVIEW');
      expect(request.location_confirmation_required).toBe(true);
      expect(db.notifications).toHaveLength(0);
      expect(db.history.filter((h) => h.request_id === request.id).map((h) => h.to_status)).toEqual(['CREATED']);
    });

    it('starts the regular matching flow after dispatcher location resolution', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput({ latitude: null, longitude: null, address: 'Unverified address' }));

      const resolved = await service.resolveLocationForDispatcher(request.id, {
        address: '1 Care Lane, Sandton',
        latitude: -26.1076,
        longitude: 28.0567,
      }, DISPATCHER);

      expect(resolved.status).toBe('NOTIFIED');
      expect(resolved.location_source).toBe('MANUAL_DISPATCHER');
      expect(resolved.location_state).toBe('LOCATION_CONFIRMED');
      expect(db.notifications.filter((notification) => notification.request_id === request.id)).toHaveLength(3);
      expect(db.history.filter((entry) => entry.request_id === request.id).map((entry) => entry.to_status)).toEqual(['CREATED', 'SEARCHING', 'NOTIFIED']);
    });

    it('blocks direct matching and cannot revive a cancelled location-review request', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput({ latitude: null, longitude: null, address: 'Unconfirmed address' }));

      await expect(service.updateStatus(request.id, 'SEARCHING', DISPATCHER)).rejects.toThrow('A confirmed location with valid coordinates is required');
      expect(db.notifications).toHaveLength(0);

      await service.updateStatus(request.id, 'CANCELLED', DISPATCHER, { cancelReason: 'no longer needed' });
      await expect(service.resolveLocationForDispatcher(request.id, {
        address: '1 Care Lane, Sandton', latitude: ORIGIN.latitude, longitude: ORIGIN.longitude,
      }, DISPATCHER)).rejects.toBeInstanceOf(ServiceRequestConflictError);
      expect(db.notifications).toHaveLength(0);
    });

    it('lands in NO_PROVIDER_FOUND when nothing is within the max radius', async () => {
      db.facilities = [facility('beyond', -26.1076 + 0.6, 28.0567)];
      const request = await service.createServiceRequest(createInput());
      expect(request.status).toBe('NO_PROVIDER_FOUND');
      expect(request.search_radius_km).toBe(50);
      expect(request.escalation_flag).toBe(true);
      expect(db.notifications).toHaveLength(0);
    });

    it('preserves fewer-than-minimum matches with the escalation flag at max radius', async () => {
      db.facilities = [NEAR, MID];
      const request = await service.createServiceRequest(createInput());
      expect(request.status).toBe('NOTIFIED');
      expect(request.escalation_flag).toBe(true);
      expect(request.facilities_notified).toBe(2);
      const matched = audits.find((a) => a.action === 'FACILITY_MATCHED');
      expect(matched?.metadata).toMatchObject({ matched: 2, escalation: true });
    });

    it('does not notify any facility twice', async () => {
      db.facilities = [NEAR, { ...NEAR }, MID, FAR];
      await service.createServiceRequest(createInput());
      const ids = db.notifications.map((n) => `${n.request_id}:${n.facility_id}`);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('real-time events', () => {
    it('publishes minimum-necessary payloads without requester identity', async () => {
      db.facilities = [NEAR, MID, FAR];
      await service.createServiceRequest(createInput());
      expect(events.map((e) => e.type)).toEqual(['service-request:created', 'service-request:status-changed', 'service-request:updated']);
      for (const event of events) {
        const payload = JSON.stringify(event.payload);
        expect(payload).not.toContain('+27820000001');
        expect(payload).not.toContain('user-patient-1');
        expect(Object.keys(event.payload).sort()).toEqual(
          ['assignedFacilityId', 'channel', 'escalationFlag', 'id', 'referenceCode', 'status', 'type', 'updatedAt', 'urgency'].sort(),
        );
      }
    });
  });

  describe('respondToNotification', () => {
    async function notifiedRequest() {
      db.facilities = [NEAR, MID, FAR];
      return service.createServiceRequest(createInput());
    }

    it('moves NOTIFIED → ACKNOWLEDGED and records REQUEST_ACKNOWLEDGED', async () => {
      const request = await notifiedRequest();
      const next = await service.respondToNotification(request.id, 'near', 'ACKNOWLEDGED', DISPATCHER);
      expect(next.status).toBe('ACKNOWLEDGED');
      expect(next.acknowledged_at).toBe(NOW_ISO);
      expect(audits.some((a) => a.action === 'REQUEST_ACKNOWLEDGED' && a.actorUserId === DISPATCHER)).toBe(true);
    });

    it('moves ACKNOWLEDGED → ACCEPTED on AVAILABLE or ACCEPTED responses', async () => {
      const request = await notifiedRequest();
      await service.respondToNotification(request.id, 'near', 'ACKNOWLEDGED', DISPATCHER);
      const next = await service.respondToNotification(request.id, 'near', 'AVAILABLE', DISPATCHER);
      expect(next.status).toBe('ACCEPTED');
    });

    it('accepts a facility directly from its first AVAILABLE response', async () => {
      const request = await notifiedRequest();
      const next = await service.respondToNotification(request.id, 'near', 'AVAILABLE', DISPATCHER);
      expect(next.status).toBe('ACCEPTED');
      expect(db.history.filter((entry) => entry.request_id === request.id).map((entry) => entry.to_status)).toContain('ACKNOWLEDGED');
    });

    it('records UNAVAILABLE without moving the request', async () => {
      const request = await notifiedRequest();
      const next = await service.respondToNotification(request.id, 'near', 'UNAVAILABLE', DISPATCHER);
      expect(next.status).toBe('NOTIFIED');
      expect(db.notifications.find((n) => n.facility_id === 'near')?.response_status).toBe('UNAVAILABLE');
    });

    it('escalates to NO_PROVIDER_FOUND when every notified facility is unavailable', async () => {
      const request = await notifiedRequest();
      await service.respondToNotification(request.id, 'near', 'UNAVAILABLE', DISPATCHER);
      await service.respondToNotification(request.id, 'mid', 'UNAVAILABLE', DISPATCHER);
      const next = await service.respondToNotification(request.id, 'far', 'UNAVAILABLE', DISPATCHER);
      expect(next.status).toBe('NO_PROVIDER_FOUND');
    });

    it('rejects a response once the facility has no pending notification', async () => {
      const request = await notifiedRequest();
      await service.respondToNotification(request.id, 'near', 'UNAVAILABLE', DISPATCHER);
      await expect(service.respondToNotification(request.id, 'near', 'AVAILABLE', DISPATCHER)).rejects.toBeInstanceOf(
        ServiceRequestConflictError,
      );
    });

    it('does not allow a facility response to regress from accepted to acknowledged', async () => {
      const request = await notifiedRequest();
      await service.respondToNotification(request.id, 'near', 'ACCEPTED', DISPATCHER);
      await expect(service.respondToNotification(request.id, 'near', 'ACKNOWLEDGED', DISPATCHER)).rejects.toBeInstanceOf(
        ServiceRequestConflictError,
      );
    });
  });

  describe('dispatcher assignment', () => {
    async function acceptedRequest(type: ServiceRequestType = 'AMBULANCE') {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput(type === 'HOME_VISIT' ? {
        type: 'HOME_VISIT',
        urgency: 'STANDARD',
        triage: { homeVisitReason: 'check-up', preferredResponder: 'EITHER' },
      } : {}));
      await service.respondToNotification(request.id, 'near', 'ACKNOWLEDGED', DISPATCHER);
      await service.respondToNotification(request.id, 'near', 'ACCEPTED', DISPATCHER);
      return service.getRequest(request.id);
    }

    it('assignFacility requires an ACCEPTED request', async () => {
      db.facilities = [NEAR, MID, FAR];
      const fresh = await service.createServiceRequest(createInput());
      await expect(service.assignFacility(fresh.id, 'near', DISPATCHER)).rejects.toMatchObject({
        name: 'InvalidTransitionError',
        from: 'NOTIFIED',
        to: 'ASSIGNED',
      });
      const request = await acceptedRequest();
      const assigned = await service.assignFacility(request!.id, 'near', DISPATCHER);
      expect(assigned.status).toBe('ASSIGNED');
      expect(assigned.assigned_facility_id).toBe('near');
      expect(assigned.assigned_at).toBe(NOW_ISO);
      expect(audits.some((a) => a.action === 'FACILITY_ASSIGNED')).toBe(true);
      expect(events.some((e) => e.type === 'service-request:assigned')).toBe(true);
    });

    it('assignFacility only permits a facility that accepted this request', async () => {
      const request = await acceptedRequest();
      await expect(service.assignFacility(request!.id, 'mid', DISPATCHER)).rejects.toBeInstanceOf(ServiceRequestConflictError);
    });

    it('assignResponder requires exactly one of responderId or unitId', async () => {
      const request = await acceptedRequest();
      await service.assignFacility(request!.id, 'near', DISPATCHER);
      await expect(service.assignResponder(request!.id, {}, DISPATCHER)).rejects.toBeInstanceOf(DispatchValidationError);
      await expect(service.assignResponder(request!.id, { responderId: 'm1', unitId: 'u1' }, DISPATCHER)).rejects.toBeInstanceOf(
        DispatchValidationError,
      );
    });

    it('assignResponder requires an ASSIGNED request', async () => {
      const request = await acceptedRequest();
      await expect(service.assignResponder(request!.id, { responderId: 'm1' }, DISPATCHER)).rejects.toMatchObject({
        name: 'InvalidTransitionError',
        from: 'ACCEPTED',
        to: 'DISPATCHED',
      });
    });

    it('claims an available on-duty responder and marks them BUSY', async () => {
      const request = await acceptedRequest('HOME_VISIT');
      await service.assignFacility(request!.id, 'near', DISPATCHER);
      db.memberships.set('m1', { id: 'm1', on_duty: true, availability: 'AVAILABLE', hospital_id: 'near', home_visit_eligible: true, role: 'nurse' });
      const dispatched = await service.assignResponder(request!.id, { responderId: 'm1' }, DISPATCHER);
      expect(dispatched.status).toBe('DISPATCHED');
      expect(dispatched.assigned_responder_id).toBe('m1');
      expect(db.memberships.get('m1')?.availability).toBe('BUSY');
      expect(audits.some((a) => a.action === 'RESPONDER_ASSIGNED')).toBe(true);
    });

    it('refuses a responder who is off duty or already busy', async () => {
      const request = await acceptedRequest('HOME_VISIT');
      await service.assignFacility(request!.id, 'near', DISPATCHER);
      db.memberships.set('m-off', { id: 'm-off', on_duty: false, availability: 'AVAILABLE', hospital_id: 'near', home_visit_eligible: true, role: 'nurse' });
      db.memberships.set('m-busy', { id: 'm-busy', on_duty: true, availability: 'BUSY', hospital_id: 'near', home_visit_eligible: true, role: 'nurse' });
      await expect(service.assignResponder(request!.id, { responderId: 'm-off' }, DISPATCHER)).rejects.toBeInstanceOf(
        ServiceRequestConflictError,
      );
      await expect(service.assignResponder(request!.id, { responderId: 'm-busy' }, DISPATCHER)).rejects.toBeInstanceOf(
        ServiceRequestConflictError,
      );
    });

    it('refuses a responder from another simulated facility', async () => {
      const request = await acceptedRequest('HOME_VISIT');
      await service.assignFacility(request!.id, 'near', DISPATCHER);
      db.memberships.set('m-other', { id: 'm-other', on_duty: true, availability: 'AVAILABLE', hospital_id: 'mid', home_visit_eligible: true, role: 'nurse' });
      await expect(service.assignResponder(request!.id, { responderId: 'm-other' }, DISPATCHER)).rejects.toBeInstanceOf(ServiceRequestConflictError);
    });

    it('claims an available response unit and marks it DISPATCHED', async () => {
      const request = await acceptedRequest();
      await service.assignFacility(request!.id, 'near', DISPATCHER);
      db.units.set('u1', { id: 'u1', active: true, status: 'AVAILABLE' });
      const dispatched = await service.assignResponder(request!.id, { unitId: 'u1' }, DISPATCHER);
      expect(dispatched.status).toBe('DISPATCHED');
      expect(dispatched.assigned_unit_id).toBe('u1');
      expect(db.units.get('u1')?.status).toBe('ASSIGNED');
    });

    it('refuses a unit that is not available', async () => {
      const request = await acceptedRequest();
      await service.assignFacility(request!.id, 'near', DISPATCHER);
      db.units.set('u-off', { id: 'u-off', active: true, status: 'OUT_OF_SERVICE' });
      await expect(service.assignResponder(request!.id, { unitId: 'u-off' }, DISPATCHER)).rejects.toBeInstanceOf(
        ServiceRequestConflictError,
      );
    });
  });

  describe('status updates and concurrency', () => {
    it('walks the full controlled lifecycle', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput());
      await service.respondToNotification(request.id, 'near', 'ACKNOWLEDGED', DISPATCHER);
      await service.respondToNotification(request.id, 'near', 'ACCEPTED', DISPATCHER);
      await service.assignFacility(request.id, 'near', DISPATCHER);
      db.units.set('u1', { id: 'u1', active: true, status: 'AVAILABLE' });
      await service.assignResponder(request.id, { unitId: 'u1' }, DISPATCHER);

      let current = await service.updateStatus(request.id, 'EN_ROUTE', DISPATCHER);
      expect(current.status).toBe('EN_ROUTE');
      current = await service.updateStatus(request.id, 'ARRIVED', DISPATCHER);
      current = await service.updateStatus(request.id, 'IN_PROGRESS', DISPATCHER);
      current = await service.updateStatus(request.id, 'COMPLETED', DISPATCHER);
      expect(current.status).toBe('COMPLETED');
      expect(current.completed_at).toBe(NOW_ISO);
      expect(db.units.get('u1')?.status).toBe('AVAILABLE');
      expect(audits.some((a) => a.action === 'REQUEST_COMPLETED')).toBe(true);

      const history = db.history.filter((h) => h.request_id === request.id).map((h) => h.to_status);
      expect(history).toEqual(['CREATED', 'SEARCHING', 'NOTIFIED', 'ACKNOWLEDGED', 'ACCEPTED', 'ASSIGNED', 'DISPATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']);
    });

    it('rejects skipping ahead in the workflow', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput());
      await expect(service.updateStatus(request.id, 'COMPLETED', DISPATCHER)).rejects.toBeInstanceOf(InvalidTransitionError);
    });

    it('cancels with a recorded reason', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput());
      const cancelled = await service.updateStatus(request.id, 'CANCELLED', DISPATCHER, { cancelReason: 'Called in error (demo).' });
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancel_reason).toBe('Called in error (demo).');
      expect(cancelled.cancelled_at).toBe(NOW_ISO);
      expect(audits.some((a) => a.action === 'REQUEST_CANCELLED')).toBe(true);
    });

    it('rejects unknown statuses', async () => {
      await expect(service.updateStatus('req-1', 'LOST' as never, DISPATCHER)).rejects.toBeInstanceOf(DispatchValidationError);
    });

    it('surfaces a conflict when the row changes mid-transition', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput());
      db.conflictOnNextTransitionUpdate = true;
      await expect(service.updateStatus(request.id, 'CANCELLED', DISPATCHER)).rejects.toBeInstanceOf(ServiceRequestConflictError);
    });

    it('allows only one request to claim the same simulated response unit', async () => {
      db.facilities = [NEAR, MID, FAR];
      const first = await service.createServiceRequest(createInput());
      const second = await service.createServiceRequest(createInput());
      for (const request of [first, second]) {
        await service.respondToNotification(request.id, 'near', 'ACCEPTED', DISPATCHER);
        await service.assignFacility(request.id, 'near', DISPATCHER);
      }
      db.units.set('u1', { id: 'u1', active: true, status: 'AVAILABLE', hospital_id: 'near' });

      const results = await Promise.allSettled([
        service.assignResponder(first.id, { unitId: 'u1' }, DISPATCHER),
        service.assignResponder(second.id, { unitId: 'u1' }, DISPATCHER),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(db.units.get('u1')?.status).toBe('ASSIGNED');
    });

    it('throws ServiceRequestNotFoundError for missing requests', async () => {
      await expect(service.getRequest('nope')).resolves.toBeNull();
      await expect(service.assignFacility('nope', 'near', DISPATCHER)).rejects.toBeInstanceOf(ServiceRequestNotFoundError);
      await expect(service.updateStatus('nope', 'CANCELLED', DISPATCHER)).rejects.toBeInstanceOf(ServiceRequestNotFoundError);
    });
  });

  describe('queue, metrics and requester views', () => {
    it('splits the queue into live and unresolved sections', async () => {
      db.facilities = [NEAR, MID, FAR];
      const matched = await service.createServiceRequest(createInput());
      const unmatched = await service.createServiceRequest(createInput({ latitude: null, longitude: null, address: '1 Demo Street' }));
      const queue = await service.listQueue();
      expect(queue.live.map((r) => r.id)).toContain(matched.id);
      expect(queue.live.map((r) => r.id)).not.toContain(unmatched.id);
      expect(queue.unresolved.map((r) => r.id)).toEqual([unmatched.id]);
    });

    it('reports dispatcher metrics', async () => {
      db.facilities = [NEAR, MID, FAR];
      await service.createServiceRequest(createInput());
      const home = await service.createServiceRequest(createInput({ type: 'HOME_VISIT', urgency: 'STANDARD', triage: { preferredResponder: 'EITHER' } }));
      await service.updateStatus(home.id, 'CANCELLED', DISPATCHER, { cancelReason: 'duplicate' });
      const metrics = await service.listMetrics();
      expect(metrics).toEqual({ active: 1, ambulance: 1, homeVisit: 0, awaitingAssignment: 1, dispatched: 0 });
    });

    it('scopes listForRequester to the owning user', async () => {
      db.facilities = [NEAR, MID, FAR];
      await service.createServiceRequest(createInput({ requesterUserId: 'user-a' }));
      await service.createServiceRequest(createInput({ requesterUserId: 'user-b' }));
      const mine = await service.listForRequester('user-a');
      expect(mine).toHaveLength(1);
      expect(mine[0]?.requester_user_id).toBe('user-a');
    });

    it('joins notifications to facility names', async () => {
      db.facilities = [NEAR, MID, FAR];
      const request = await service.createServiceRequest(createInput());
      const notifications = (await service.listNotifications(request.id)) as Array<{ facility_id: string; facility_name: string }>;
      expect(notifications).toHaveLength(3);
      expect(notifications[0]?.facility_name).toContain('Simulated Facility');
      const distances = notifications.map((n) => Number((n as unknown as { distance_km: number }).distance_km));
      for (let i = 1; i < distances.length; i += 1) {
        expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
      }
    });
  });
});

describe('dispatch service listAvailableResponders', () => {
  it('returns available responders and simulated units for the assignment form', async () => {
    const responders = [
      {
        id: 'm1', role: 'nurse', availability: 'AVAILABLE', home_visit_eligible: true, on_duty: true,
        display_name: 'Simulated Nurse', email: 'nurse@example.com', hospital_id: 'h1', hospital_name: 'Simulated Facility Near',
      },
    ];
    const units = [
      {
        id: 'u1', callsign: 'A01', unit_type: 'AMBULANCE', status: 'AVAILABLE',
        hospital_id: 'h1', hospital_name: 'Simulated Facility Near',
      },
    ];
    const query: QueryFn = async <T>(text: string) =>
      ok((text.includes('hospital_memberships') ? responders : units) as T[]) as QueryResult<T>;
    const service = createDispatchService({
      query,
      audit: async () => {},
      publish: () => {},
      now: () => NOW,
    });

    const data = await service.listAvailableResponders();
    expect(data.responders).toHaveLength(1);
    expect(data.responders[0]).toMatchObject({ id: 'm1', home_visit_eligible: true, hospital_name: 'Simulated Facility Near' });
    expect(data.units).toHaveLength(1);
    expect(data.units[0]).toMatchObject({ id: 'u1', callsign: 'A01', unit_type: 'AMBULANCE' });
  });
});
