import { DispatchValidationError, type CreateServiceRequestInput } from './dispatch.service.js';
import type { LocationSource, LocationState, ServiceRequestTriage } from './domain.js';

/**
 * Channel adapter boundary (Dispatch Core §19): Web, USSD and SMS each adapt
 * their own payload shape onto the shared CreateServiceRequestInput, and every
 * channel calls the same createServiceRequest(). Channel controllers gather and
 * normalize only their own conversational inputs before crossing this boundary.
 */

export const AMBULANCE_REASONS = [
  'chest-pain',
  'breathing-difficulty',
  'severe-bleeding',
  'road-accident',
  'unconscious-person',
  'other-emergency',
] as const;

export const HOME_VISIT_REASONS = [
  'check-up',
  'chronic-care',
  'medication-review',
  'wound-care',
  'other-visit',
] as const;

const MAX_ADDRESS_LENGTH = 320;
const MAX_REASON_LENGTH = 240;

export function adaptWebRequest(
  body: Record<string, unknown>,
  requester: { userId: string; phone?: string | null },
): CreateServiceRequestInput {
  const type = body.type === 'AMBULANCE' || body.type === 'HOME_VISIT' ? body.type : null;
  if (!type) throw new DispatchValidationError('type must be AMBULANCE or HOME_VISIT.');
  const candidateId = boundedText(body.locationCandidateId, 80);
  const locationReview = body.locationReview === true;
  const latitude = candidateId ? null : parseCoordinate(body.latitude);
  const longitude = candidateId ? null : parseCoordinate(body.longitude);
  const address = boundedText(body.address, MAX_ADDRESS_LENGTH);
  if (!candidateId && (latitude == null || longitude == null) && !address) {
    throw new DispatchValidationError('Provide browser location (latitude/longitude) or a manual address.');
  }
  if (candidateId && (body.latitude != null || body.longitude != null)) {
    throw new DispatchValidationError('Confirmed address locations cannot include client coordinates.');
  }
  if (locationReview && (candidateId || latitude != null || longitude != null || !address)) {
    throw new DispatchValidationError('Location review requires an address without a candidate or coordinates.');
  }
  if (!candidateId && address && latitude == null && longitude == null && !locationReview) {
    throw new DispatchValidationError('Confirm an address match before sending this request.');
  }
  const urgency = body.urgency === 'EMERGENCY' || body.urgency === 'URGENT' ? body.urgency : 'STANDARD';
  const triage = adaptTriage(body.triage, type);
  if (type === 'AMBULANCE') {
    if (!triage?.ambulanceReason || !AMBULANCE_REASONS.includes(triage.ambulanceReason as typeof AMBULANCE_REASONS[number])) {
      throw new DispatchValidationError('Choose a valid ambulance reason.');
    }
    if (!triage.conscious) throw new DispatchValidationError('Specify whether the patient is conscious.');
  } else {
    if (!triage?.homeVisitReason || !HOME_VISIT_REASONS.includes(triage.homeVisitReason as typeof HOME_VISIT_REASONS[number])) {
      throw new DispatchValidationError('Choose a valid home-visit reason.');
    }
    if (!triage.preferredResponder) throw new DispatchValidationError('Choose a preferred home-visit responder.');
  }
  return {
    channel: 'WEB',
    type,
    urgency,
    reason: boundedText(body.reason, MAX_REASON_LENGTH) || undefined,
    triage,
    address: address || undefined,
    latitude,
    longitude,
    requesterUserId: requester.userId,
    requesterPhone: requester.phone ?? null,
    ...(candidateId ? { locationCandidateId: candidateId } : {}),
    ...(candidateId ? { locationState: 'LOCATION_CONFIRMED' as const, locationSource: 'GEOCODED_ADDRESS' as const } : {}),
    ...(!candidateId && latitude != null && longitude != null ? { locationState: 'LOCATION_CONFIRMED' as const, locationSource: 'GPS' as const } : {}),
    ...(locationReview ? { locationState: 'DISPATCHER_LOCATION_REVIEW' as const, locationSource: 'UNRESOLVED' as const } : {}),
  };
}

export function adaptUssdRequest(input: {
  phoneNumber: string;
  type: ServiceRequestTriageInput['type'];
  reason?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  conscious?: 'YES' | 'NO' | 'UNKNOWN';
  preferredResponder?: 'DOCTOR' | 'NURSE' | 'EITHER';
  requesterUserId?: string | null;
  locationState?: LocationState;
  locationSource?: LocationSource;
  geocodedFormattedAddress?: string;
  geocodingPlaceId?: string;
  geocodingConfidence?: number;
  idempotencyKey?: string;
}): CreateServiceRequestInput {
  const type = input.type === 'HOME_VISIT' ? 'HOME_VISIT' : 'AMBULANCE';
  return {
    channel: 'USSD',
    type,
    urgency: type === 'AMBULANCE' ? 'URGENT' : 'STANDARD',
    reason: input.reason,
    triage: {
      ...(type === 'AMBULANCE' && input.conscious ? { conscious: input.conscious } : {}),
      ...(type === 'HOME_VISIT'
        ? { homeVisitReason: 'other-visit', ...(input.preferredResponder ? { preferredResponder: input.preferredResponder } : {}) }
        : {}),
    },
    address: input.address,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    requesterUserId: input.requesterUserId ?? null,
    requesterPhone: input.phoneNumber,
    locationState: input.locationState,
    locationSource: input.locationSource,
    geocodedFormattedAddress: input.geocodedFormattedAddress,
    geocodingPlaceId: input.geocodingPlaceId,
    geocodingConfidence: input.geocodingConfidence,
    idempotencyKey: input.idempotencyKey,
  };
}

export function adaptSmsRequest(input: {
  phoneNumber: string;
  text?: string;
  type?: ServiceRequestTriageInput['type'];
  reason?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  conscious?: 'YES' | 'NO' | 'UNKNOWN';
  preferredResponder?: 'DOCTOR' | 'NURSE' | 'EITHER';
  requesterUserId?: string | null;
  locationState?: LocationState;
  locationSource?: LocationSource;
  geocodedFormattedAddress?: string;
  geocodingPlaceId?: string;
  geocodingConfidence?: number;
  idempotencyKey?: string;
}): CreateServiceRequestInput {
  const text = input.text?.trim() ?? input.reason?.trim() ?? '';
  const keyword = text.split(/\s+/)[0]?.toUpperCase();
  const type = input.type === 'HOME_VISIT' || input.type === 'AMBULANCE'
    ? input.type
    : keyword === 'HOME' || keyword === 'VISIT' || keyword === 'HOME_VISIT' ? 'HOME_VISIT' : 'AMBULANCE';
  return {
    channel: 'SMS',
    type,
    urgency: type === 'AMBULANCE' ? 'URGENT' : 'STANDARD',
    reason: input.reason?.trim() || text || undefined,
    triage: {
      ...(type === 'AMBULANCE' && input.conscious ? { conscious: input.conscious } : {}),
      ...(type === 'HOME_VISIT'
        ? { homeVisitReason: 'other-visit', ...(input.preferredResponder ? { preferredResponder: input.preferredResponder } : {}) }
        : {}),
    },
    address: input.address?.trim() || undefined,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    requesterUserId: input.requesterUserId ?? null,
    requesterPhone: input.phoneNumber,
    locationState: input.locationState,
    locationSource: input.locationSource,
    geocodedFormattedAddress: input.geocodedFormattedAddress,
    geocodingPlaceId: input.geocodingPlaceId,
    geocodingConfidence: input.geocodingConfidence,
    idempotencyKey: input.idempotencyKey,
  };
}

interface ServiceRequestTriageInput {
  type?: string;
}

function parseCoordinate(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function adaptTriage(raw: unknown, type: CreateServiceRequestInput['type']): ServiceRequestTriage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const triage = raw as Record<string, unknown>;
  const result: ServiceRequestTriage = {};
  if (type === 'AMBULANCE') {
    if (typeof triage.ambulanceReason === 'string') result.ambulanceReason = triage.ambulanceReason;
    if (triage.conscious === 'YES' || triage.conscious === 'NO' || triage.conscious === 'UNKNOWN') {
      result.conscious = triage.conscious;
    }
  } else {
    if (typeof triage.homeVisitReason === 'string') result.homeVisitReason = triage.homeVisitReason;
    if (triage.preferredResponder === 'DOCTOR' || triage.preferredResponder === 'NURSE' || triage.preferredResponder === 'EITHER') {
      result.preferredResponder = triage.preferredResponder;
    }
  }
  return result;
}
