export type ServiceRequestType = 'AMBULANCE' | 'HOME_VISIT';
export type ServiceChannel = 'WEB' | 'USSD' | 'SMS';
export type ServiceUrgency = 'EMERGENCY' | 'URGENT' | 'STANDARD';

export type ServiceStatus =
  | 'CREATED'
  | 'SEARCHING'
  | 'NOTIFIED'
  | 'ACKNOWLEDGED'
  | 'ACCEPTED'
  | 'ASSIGNED'
  | 'DISPATCHED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_PROVIDER_FOUND';

export const SERVICE_STATUSES: readonly ServiceStatus[] = [
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
];

export const TERMINAL_STATUSES: readonly ServiceStatus[] = ['COMPLETED', 'CANCELLED', 'NO_PROVIDER_FOUND'];

/** Controlled workflow — the single source of truth for valid transitions. */
export const STATUS_TRANSITIONS: Readonly<Record<ServiceStatus, readonly ServiceStatus[]>> = {
  CREATED: ['SEARCHING', 'CANCELLED'],
  SEARCHING: ['NOTIFIED', 'NO_PROVIDER_FOUND', 'CANCELLED'],
  NOTIFIED: ['ACKNOWLEDGED', 'NO_PROVIDER_FOUND', 'CANCELLED'],
  ACKNOWLEDGED: ['ASSIGNED', 'NO_PROVIDER_FOUND', 'CANCELLED'],
  ACCEPTED: ['ASSIGNED', 'NO_PROVIDER_FOUND', 'CANCELLED'],
  ASSIGNED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_PROVIDER_FOUND: [],
};

export function canTransition(from: ServiceStatus, to: ServiceStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: ServiceStatus): readonly ServiceStatus[] {
  return STATUS_TRANSITIONS[from] ?? [];
}

export class InvalidTransitionError extends Error {
  readonly from: ServiceStatus;
  readonly to: ServiceStatus;

  constructor(from: ServiceStatus, to: ServiceStatus) {
    super(`Cannot move a service request from ${from} to ${to}.`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class ServiceRequestNotFoundError extends Error {
  constructor(id: string) {
    super(`Service request ${id} was not found.`);
    this.name = 'ServiceRequestNotFoundError';
  }
}

/** Optimistic/conditional-update conflict — the row changed under us. */
export class ServiceRequestConflictError extends Error {
  constructor(message = 'The service request changed concurrently. Retry the operation.') {
    super(message);
    this.name = 'ServiceRequestConflictError';
  }
}

export type NotificationResponseStatus = 'PENDING' | 'ACKNOWLEDGED' | 'AVAILABLE' | 'UNAVAILABLE' | 'ACCEPTED';

export const NOTIFICATION_RESPONSE_STATUSES: readonly NotificationResponseStatus[] = [
  'PENDING',
  'ACKNOWLEDGED',
  'AVAILABLE',
  'UNAVAILABLE',
  'ACCEPTED',
];

export type FacilityExclusionReason =
  | 'FACILITY_INACTIVE'
  | 'INVALID_COORDINATES'
  | 'NO_AMBULANCE_CAPABILITY'
  | 'NO_HOME_VISIT_CAPABILITY'
  | 'NO_AVAILABLE_AMBULANCE_UNIT'
  | 'NO_AVAILABLE_HOME_VISIT_RESPONDER'
  | 'OUTSIDE_SEARCH_RADIUS';

/** Dispatcher-only explanation of the current matching decision. */
export interface FacilityMatchingDiagnostic {
  facilityId: string;
  facilityName: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  eligible: boolean;
  exclusionReasons: FacilityExclusionReason[];
}

export interface ServiceRequestTriage {
  ambulanceReason?: string;
  conscious?: 'YES' | 'NO' | 'UNKNOWN';
  homeVisitReason?: string;
  preferredResponder?: 'DOCTOR' | 'NURSE' | 'EITHER';
}

export type LocationState =
  | 'LEGACY'
  | 'ADDRESS_ENTERED'
  | 'GEOCODED_PENDING_CONFIRMATION'
  | 'LOCATION_CONFIRMED'
  | 'LOCATION_UNRESOLVED'
  | 'DISPATCHER_LOCATION_REVIEW';

export type LocationSource = 'GPS' | 'GEOCODED_ADDRESS' | 'MANUAL_DISPATCHER' | 'UNRESOLVED' | 'LEGACY';

export interface ServiceRequestRow {
  id: string;
  reference_code: string;
  requester_user_id: string | null;
  requester_phone: string | null;
  type: ServiceRequestType;
  channel: ServiceChannel;
  status: ServiceStatus;
  urgency: ServiceUrgency;
  reason: string | null;
  triage: ServiceRequestTriage;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  location_state?: LocationState;
  location_confirmation_required?: boolean;
  location_confirmed_at?: string | null;
  location_source?: LocationSource | null;
  geocoded_formatted_address?: string | null;
  geocoding_place_id?: string | null;
  geocoding_confidence?: number | null;
  idempotency_key?: string | null;
  search_radius_km: number | null;
  facilities_notified: number | null;
  escalation_flag: boolean;
  assigned_facility_id: string | null;
  assigned_responder_id: string | null;
  assigned_unit_id: string | null;
  created_at: string;
  updated_at: string;
  notified_at: string | null;
  acknowledged_at: string | null;
  assigned_at: string | null;
  dispatched_at?: string | null;
  en_route_at?: string | null;
  arrived_at?: string | null;
  in_progress_at?: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

/** Reference codes look like NC-2026-000123. */
export function formatReferenceCode(year: number, seq: number): string {
  return `NC-${year}-${String(seq).padStart(6, '0')}`;
}

export interface AvailableResponderRow {
  id: string;
  role: string;
  availability: 'AVAILABLE' | 'BUSY' | 'OFF_DUTY';
  home_visit_eligible: boolean;
  on_duty: boolean;
  display_name: string | null;
  email: string | null;
  hospital_id: string;
  hospital_name: string;
}

export interface AvailableUnitRow {
  id: string;
  callsign: string;
  unit_type: 'AMBULANCE';
  status: 'AVAILABLE' | 'ASSIGNED' | 'EN_ROUTE' | 'OUT_OF_SERVICE';
  hospital_id: string;
  hospital_name: string;
}

export interface AvailableResponders {
  responders: AvailableResponderRow[];
  units: AvailableUnitRow[];
}
