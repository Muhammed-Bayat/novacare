export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export type UserType = 'patient' | 'staff' | 'admin';

export interface CurrentUser {
  id: string;
  auth0Subject: string;
  email: string | null;
  displayName: string | null;
  userType: UserType;
  isPlatformOperator: boolean;
  staffRole: 'administrator' | 'nurse' | 'doctor' | 'dispatcher' | null;
  hospitalId: string | null;
  hospitalName: string | null;
}

export interface Hospital {
  id: string;
  name: string;
  province: string;
  address: string;
  latitude: number;
  longitude: number;
  facilityType: string | null;
  services: { id: string; name: string; waitingCount?: number }[];
}

export interface Appointment {
  id: string;
  hospitalId: string;
  serviceId: string;
  date: string;
  time: string;
  status: string;
  hospitalName: string;
  serviceName: string;
  address: string;
  triageSummary: AppointmentTriageSummary | null;
}

export type QueueEntryStatus = 'awaiting_triage' | 'waiting' | 'called' | 'in_consultation';

export interface QueueEntry {
  id: string;
  status: QueueEntryStatus;
  hospitalName: string;
  serviceName: string;
  address: string;
  joinedAt: string;
  position: number | null;
  estimatedWaitMinutes: number | null;
  category: QuestionnaireUrgency | null;
  triageSummary: AppointmentTriageSummary | null;
}

export interface StaffTriageEntry {
  id: string;
  patientName: string;
  patientEmail: string | null;
  source: 'booking' | 'walk_in';
  serviceId: string;
  serviceName: string;
  appointmentTime: string | null;
  joinedAt: string;
  critical: boolean;
  intakeNote: string | null;
  triageSummary: AppointmentTriageSummary | null;
}

export interface StaffAppointment {
  id: string;
  patientName: string;
  patientEmail: string | null;
  serviceId: string;
  serviceName: string;
  date: string;
  time: string;
  status: 'booked' | 'checked_in';
  isToday: boolean;
  queueStatus: 'awaiting_triage' | 'waiting' | 'called' | 'in_consultation' | 'referred' | 'completed' | 'cancelled' | null;
}

export interface StaffQueueEntry {
  id: string;
  patientName: string;
  serviceId: string;
  serviceName: string;
  status: 'waiting' | 'called' | 'in_consultation';
  category: QuestionnaireUrgency | null;
  position: number | null;
  joinedAt: string;
  triagedAt: string | null;
  calledAt: string | null;
}

export interface DisplayData {
  hospitalName: string;
  generatedAt: string;
  services: {
    serviceName: string;
    nowServing: number | null;
    awaitingTriage: number;
    waiting: { ticket: number; category: QuestionnaireUrgency | null }[];
  }[];
}

export type QuestionnaireUrgency = 'emergency' | 'urgent' | 'priority' | 'routine';
export type QuestionnaireQuestionType = 'single' | 'yes-no' | 'scale';
export type IntakeSource = 'ai' | 'local-fallback';
export type FallbackReason =
  | 'missing-api-key'
  | 'provider-auth'
  | 'provider-rate-limit'
  | 'provider-quota'
  | 'provider-billing'
  | 'provider-model'
  | 'provider-request'
  | 'provider-server-error'
  | 'network'
  | 'timeout'
  | 'invalid-json'
  | 'schema-validation'
  | 'invalid-pathway';

export interface QuestionnaireOption {
  id: string;
  label: string;
  value: string | number | boolean;
}

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  helper?: string;
  type: QuestionnaireQuestionType;
  options?: QuestionnaireOption[];
  min?: number;
  max?: number;
}

export interface QuestionnaireIntake {
  pathwayId: string;
  pathwayName: string;
  questions: QuestionnaireQuestion[];
  source: IntakeSource;
  fallbackReason?: FallbackReason;
}

export interface QuestionnaireAnswer {
  questionId: string;
  value: string | number | boolean;
}

export interface QuestionnaireAssessment {
  pathwayId: string;
  pathwayName: string;
  summary: string;
  department: string;
  urgency: QuestionnaireUrgency;
  redFlags: string[];
}

export type QuestionnaireInterpretationType = 'answer' | 'explanation' | 'clarification-needed' | 'conversation';
export type QuestionnaireInterpretationStatus = 'success' | 'failed';

export interface QuestionnaireInterpretation {
  type: QuestionnaireInterpretationType;
  answerId: string | null;
  confidence: number | null;
  message: string;
  interpretationStatus: QuestionnaireInterpretationStatus;
}

export interface AppointmentTriageSummary {
  urgency: QuestionnaireUrgency;
  pathwayName: string;
  department: string;
  summary: string;
  redFlags: string[];
}

export interface PatientProfile {
  phone: string | null;
  dateOfBirth: string | null;
  homeAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  chronicConditions: string[];
  allergies: string[];
  medications: string[];
  bloodType: string | null;
  accessNeeds: string | null;
  healthNotes: string | null;
  healthDataConsent: boolean;
}

export interface ClinicalDiagnosis {
  id: string;
  diagnosis: string;
  diagnosedOn: string;
  clinicianName: string | null;
  notes: string | null;
}

export interface HospitalAccess {
  administrators: { email: string | null; displayName: string | null; since: string }[];
  pendingInvitations: { email: string; expiresAt: string; sentAt: string | null }[];
}

export type TeamRole = 'administrator' | 'nurse' | 'doctor' | 'dispatcher';

export interface TeamDepartment {
  id: string;
  name: string;
}

export interface HospitalTeamMember {
  membershipId: string;
  email: string | null;
  displayName: string | null;
  role: TeamRole;
  active: boolean;
  since: string;
  departments: TeamDepartment[];
}

export interface PendingInvitation {
  email: string;
  role: TeamRole;
  departmentIds: string[];
  expiresAt: string;
  sentAt: string | null;
}

export interface HospitalTeam {
  hospitalId: string;
  hospitalName: string;
  displayPath?: string | null;
  members: HospitalTeamMember[];
  pendingInvitations: PendingInvitation[];
}

export interface Department {
  id: string;
  name: string;
  averageConsultationMinutes: number;
}

export interface AdminDepartment {
  id: string;
  name: string;
  averageConsultationMinutes: number;
  active: boolean;
  slotCount: number;
  appointmentCount: number;
}

export interface DisplaySettings {
  token: string | null;
  active: boolean;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { displayName: string | null; email: string | null } | null;
}

export interface OverviewDepartmentRow {
  id: string;
  name: string;
  averageConsultationMinutes: number;
  slotsToday: number;
  capacityToday: number;
  reservedToday: number;
  appointmentsBooked: number;
  appointmentsCancelled: number;
  queueWaiting: number;
  queueCalled: number;
}

export interface AdminOverview {
  date: string;
  totals: {
    slotsToday: number;
    capacityToday: number;
    reservedToday: number;
    appointmentsBooked: number;
    appointmentsCancelled: number;
    queueWaiting: number;
    queueCalled: number;
    activeMembers: number;
    pendingInvitations: number;
  };
  departments: OverviewDepartmentRow[];
}

export interface HospitalDepartments {
  hospitalId: string;
  hospitalName: string;
  departments: Department[];
}

export interface AppointmentSlot {
  id: string;
  departmentId: string;
  departmentName: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  reservedCount: number;
}

export interface SlotCreateResult {
  created: number;
  departmentId: string;
  departmentName: string;
  date: string;
}

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

export interface ServiceRequestTriage {
  ambulanceReason?: string;
  conscious?: 'YES' | 'NO' | 'UNKNOWN';
  homeVisitReason?: string;
  preferredResponder?: 'DOCTOR' | 'NURSE' | 'EITHER';
}

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
  location_state?: 'LEGACY' | 'ADDRESS_ENTERED' | 'GEOCODED_PENDING_CONFIRMATION' | 'LOCATION_CONFIRMED' | 'LOCATION_UNRESOLVED' | 'DISPATCHER_LOCATION_REVIEW';
  location_confirmation_required?: boolean;
  location_source?: 'GPS' | 'GEOCODED_ADDRESS' | 'MANUAL_DISPATCHER' | 'UNRESOLVED' | 'LEGACY';
  geocoded_formatted_address?: string | null;
  geocoding_place_id?: string | null;
  geocoding_confidence?: number | null;
}

export interface LocationCandidate {
  id: string;
  formattedAddress: string;
  suburb?: string;
  city?: string;
}

export interface DispatchMetrics {
  active: number;
  ambulance: number;
  homeVisit: number;
  awaitingAssignment: number;
  dispatched: number;
}

export interface DispatcherQueue {
  live: ServiceRequestRow[];
  unresolved: ServiceRequestRow[];
  metrics: DispatchMetrics;
}

export interface ServiceRequestHistoryEntry {
  id: string;
  from_status: ServiceStatus | null;
  to_status: ServiceStatus;
  actor_user_id: string | null;
  note: string | null;
  created_at: string;
}

export type NotificationResponseStatus = 'PENDING' | 'ACKNOWLEDGED' | 'AVAILABLE' | 'UNAVAILABLE' | 'ACCEPTED';

export interface DispatchNotificationEntry {
  id: string;
  request_id: string;
  facility_id: string;
  distance_km: number | null;
  notified_at: string;
  acknowledged_at: string | null;
  response_status: NotificationResponseStatus;
  responded_at: string | null;
  facility_name: string;
}

export interface ServiceRequestDetail extends ServiceRequestRow {
  history: ServiceRequestHistoryEntry[];
  notifications: DispatchNotificationEntry[];
}

export interface AvailableResponder {
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

export interface AvailableUnit {
  id: string;
  callsign: string;
  unit_type: 'AMBULANCE';
  status: 'AVAILABLE' | 'ASSIGNED' | 'EN_ROUTE' | 'OUT_OF_SERVICE';
  hospital_id: string;
  hospital_name: string;
}

export interface AvailableResponders {
  responders: AvailableResponder[];
  units: AvailableUnit[];
}

export async function publicGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = isErrorPayload(payload) ? payload.error.message : 'Request failed';
    throw new Error(message);
  }
  return payload as T;
}

export async function authenticatedRequest<T>(
  path: string,
  accessToken: string | undefined,
  options: { method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  if (!accessToken) throw new Error('Your sign-in session could not be verified. Please sign in again.');
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json();

  if (!response.ok) {
    const message = isErrorPayload(payload) ? payload.error.message : 'Request failed';
    throw new Error(message);
  }

  return payload as T;
}

function isErrorPayload(payload: unknown): payload is { error: { message: string } } {
  return typeof payload === 'object' && payload !== null &&
    'error' in payload && typeof payload.error === 'object' && payload.error !== null &&
    'message' in payload.error && typeof payload.error.message === 'string';
}
