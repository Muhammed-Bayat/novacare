const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export type UserType = 'patient' | 'staff' | 'admin';

export interface CurrentUser {
  id: string;
  auth0Subject: string;
  email: string | null;
  displayName: string | null;
  userType: UserType;
  isPlatformOperator: boolean;
  staffRole: 'administrator' | 'nurse' | 'doctor' | null;
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
  summary: string;
  department: string;
  urgency: QuestionnaireUrgency;
  questions: QuestionnaireQuestion[];
  source: 'gemini' | 'local';
}

export interface AppointmentTriageSummary {
  urgency: QuestionnaireUrgency;
  pathwayName: string;
  department: string;
  summary: string;
  redFlags: string[];
}

export type IntakeChatQuestionType = 'yes_no' | 'single' | 'scale' | 'text';

export interface IntakeChatOption {
  id: string;
  label: string;
}

export interface IntakeChatQuestion {
  id: string;
  text: string;
  type: IntakeChatQuestionType;
  options?: IntakeChatOption[];
}

export interface IntakeChatConclusion {
  pathwayId: string;
  pathwayName: string;
  summary: string;
  department: string;
  urgency: QuestionnaireUrgency;
  redFlags: string[];
}

export type IntakeChatTurn =
  | { action: 'question'; question: IntakeChatQuestion }
  | { action: 'complete'; source: 'gemini' | 'local'; intake: IntakeChatConclusion };

export interface IntakeChatAnswer {
  question: string;
  answer: string;
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

export type TeamRole = 'administrator' | 'nurse' | 'doctor';

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
