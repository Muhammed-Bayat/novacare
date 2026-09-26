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
}

export interface Hospital {
  id: string;
  name: string;
  province: string;
  address: string;
  latitude: number;
  longitude: number;
  facilityType: string | null;
  services: { id: string; name: string }[];
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

export interface QueueEntry {
  id: string;
  status: 'waiting' | 'called';
  hospitalName: string;
  serviceName: string;
  address: string;
  joinedAt: string;
  position: number;
  estimatedWaitMinutes: number;
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

export async function authenticatedRequest<T>(
  path: string,
  accessToken: string,
  options: { method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
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
