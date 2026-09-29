import type { ChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import { adaptUssdRequest } from './dispatch/channel-adapters.js';
import type { DispatchService } from './dispatch/dispatch.service.js';
import type { ServiceRequestRow } from './dispatch/domain.js';
import {
  LocationConfirmationError,
  type LocationResolutionService,
} from './location/location-resolution.service.js';

export type ChannelDispatchService = Pick<
  DispatchService,
  'createServiceRequest' | 'getRequestByReferenceForPhone' | 'cancelRequestByReferenceForPhone'
>;

export type UssdStep =
  | 'main_menu'
  | 'ambulance_conscious'
  | 'ambulance_location'
  | 'ambulance_location_selection'
  | 'ambulance_reason'
  | 'ambulance_confirm'
  | 'home_visit_practitioner'
  | 'home_visit_location'
  | 'home_visit_location_selection'
  | 'home_visit_reason'
  | 'home_visit_confirm'
  | 'reference_prompt'
  | 'confirmation'
  | 'invalid_selection';

export type UssdResponse = { step: UssdStep; message: string };

export interface UssdWorkflowDeps {
  dispatch: ChannelDispatchService;
  store: ChannelConversationStore;
  context: ChannelRequestContext;
  location: LocationResolutionService;
  now?: () => Date;
}

export const USSD_INVALID_REQUEST_MESSAGE = 'END NovaCare could not process this request. Please try again.';

const MAIN_MENU = 'CON Welcome to NovaCare\n1. Request an ambulance\n2. Request a home visit\n3. Check a request';
const AMBULANCE_MENU = 'CON Ambulance request\nIs the patient conscious?\n1. Yes\n2. No';
const HOME_VISIT_MENU = 'CON Home visit request\nPlease select:\n1. Doctor\n2. Nurse\n3. Either';
const LOCATION_PROMPT = 'CON Enter the address for this demo request. Reply SAVED to use a consented profile address.';
const AMBULANCE_REASON_PROMPT = 'CON Briefly describe the emergency.';
const HOME_VISIT_REASON_PROMPT = 'CON Briefly describe the reason for the home visit.';
const CONFIRM_AMBULANCE = 'CON Confirm this ambulance demo request?\n1. Yes\n2. Cancel';
const CONFIRM_HOME_VISIT = 'CON Confirm this home-visit demo request?\n1. Yes\n2. Cancel';
const REFERENCE_PROMPT = 'CON Enter your NovaCare request reference';
const INVALID_SELECTION = 'END Invalid selection. Please try again.';
const SESSION_TTL_MS = 30 * 60 * 1000;

function response(step: UssdStep, message: string): UssdResponse {
  return { step, message };
}

function statusLabel(request: Pick<ServiceRequestRow, 'status' | 'location_state'>): string {
  if (request.location_state === 'DISPATCHER_LOCATION_REVIEW') return 'waiting for location review';
  return request.status.toLowerCase().replace(/_/g, ' ');
}

function expiry(now: () => Date): string {
  return new Date(now().getTime() + SESSION_TTL_MS).toISOString();
}

function partsFor(text: string): string[] {
  return text.split('*').map((part) => part.trim());
}

function choice(value: string, choices: readonly string[]): boolean {
  return choices.includes(value.toUpperCase());
}

async function completeRequest(
  input: {
    phoneNumber: string;
    sessionId: string;
    text: string;
    type: 'AMBULANCE' | 'HOME_VISIT';
    address: string;
    reason: string;
    conscious?: 'YES' | 'NO';
    preferredResponder?: 'DOCTOR' | 'NURSE' | 'EITHER';
    candidateId?: string;
    locationReview?: boolean;
  },
  deps: UssdWorkflowDeps,
): Promise<UssdResponse> {
  const existing = await deps.store.get('USSD', input.sessionId);
  if (existing?.requestId && existing.collectedData.inputText === input.text) {
    const reference = typeof existing.collectedData.referenceCode === 'string' ? existing.collectedData.referenceCode : null;
    if (reference) return response('confirmation', `END NovaCare demo request received.\nReference: ${reference}`);
  }

  const requester = await deps.context.resolveRequester(input.phoneNumber);
  let confirmed: Awaited<ReturnType<LocationResolutionService['getConfirmed']>> | undefined;
  if (!input.locationReview) {
    if (!input.candidateId) return response('invalid_selection', 'END The location confirmation is missing. Please start again.');
    try {
      confirmed = await deps.location.getConfirmed({
        channel: 'USSD',
        ownerKey: `${input.phoneNumber}:${input.sessionId}`,
        candidateId: input.candidateId,
      });
    } catch (error) {
      if (error instanceof LocationConfirmationError) {
        return response('invalid_selection', 'END That location selection expired. Please start again.');
      }
      throw error;
    }
  }
  const request = await deps.dispatch.createServiceRequest(adaptUssdRequest({
    phoneNumber: input.phoneNumber,
    type: input.type,
    reason: input.reason.slice(0, 240),
    address: confirmed?.enteredAddress ?? input.address,
    latitude: confirmed?.latitude ?? null,
    longitude: confirmed?.longitude ?? null,
    conscious: input.conscious,
    preferredResponder: input.preferredResponder,
    requesterUserId: requester.userId,
    ...(confirmed
      ? {
        locationState: 'LOCATION_CONFIRMED' as const,
        locationSource: 'GEOCODED_ADDRESS' as const,
        geocodedFormattedAddress: confirmed.formattedAddress,
        geocodingPlaceId: confirmed.placeId,
        geocodingConfidence: confirmed.confidence,
        idempotencyKey: `location:${confirmed.id}`,
      }
      : {
        locationState: 'DISPATCHER_LOCATION_REVIEW' as const,
        locationSource: 'UNRESOLVED' as const,
        idempotencyKey: `ussd:${input.sessionId}:${input.text}`,
      }),
  }));
  if (confirmed) await deps.location.linkRequest(confirmed.id, request.id);
  await deps.store.save({
    channel: 'USSD',
    sessionKey: input.sessionId,
    phoneNumber: input.phoneNumber,
    flow: input.type,
    step: 'COMPLETED',
    collectedData: { inputText: input.text, referenceCode: request.reference_code },
    requestId: request.id,
    expiresAt: expiry(deps.now ?? (() => new Date())),
  });
  return response('confirmation', input.locationReview
    ? `END NovaCare demo request received.\nReference: ${request.reference_code}\nLocation needs dispatcher review.`
    : `END NovaCare demo request received.\nReference: ${request.reference_code}`);
}

type UssdLocationDraft = {
  address?: string;
  candidateIds?: string[];
  candidateLabels?: string[];
  unresolved?: boolean;
};

function locationLabel(candidate: { formattedAddress: string; suburb?: string; city?: string }): string {
  const locality = [candidate.suburb, candidate.city].filter(Boolean).join(', ');
  return (locality || candidate.formattedAddress.split(',').slice(0, 2).join(',')).slice(0, 52);
}

async function locationChoice(
  input: { sessionId: string; phoneNumber: string; flow: 'AMBULANCE' | 'HOME_VISIT'; address: string },
  deps: UssdWorkflowDeps,
): Promise<UssdResponse> {
  const existing = await deps.store.get('USSD', input.sessionId);
  const existingDraft = existing?.collectedData as UssdLocationDraft | undefined;
  if (existingDraft?.address === input.address && Array.isArray(existingDraft.candidateIds) && Array.isArray(existingDraft.candidateLabels)) {
    const labels = existingDraft.candidateLabels;
    return response(input.flow === 'AMBULANCE' ? 'ambulance_location_selection' : 'home_visit_location_selection',
      labels.length === 1
        ? `CON We found:\n${labels[0]}\n1. Confirm\n2. Enter again`
        : `CON Choose location:\n${labels.map((label, index) => `${index + 1}. ${label}`).join('\n')}\n${labels.length + 1}. Enter again`);
  }
  const requester = input.address.toUpperCase() === 'SAVED' ? await deps.context.resolveRequester(input.phoneNumber) : null;
  const address = input.address.toUpperCase() === 'SAVED' ? requester?.savedAddress : input.address;
  if (!address) return response('invalid_selection', 'END No consented saved address is available. Please start again and enter an address.');
  const outcome = await deps.location.resolve({ channel: 'USSD', ownerKey: `${input.phoneNumber}:${input.sessionId}`, address });
  if (outcome.status === 'unresolved') {
    await deps.store.save({
      channel: 'USSD', sessionKey: input.sessionId, phoneNumber: input.phoneNumber, flow: input.flow,
      step: 'WAITING_FOR_LOCATION_SELECTION', collectedData: { address, unresolved: true }, requestId: null,
      expiresAt: expiry(deps.now ?? (() => new Date())),
    });
    return response(input.flow === 'AMBULANCE' ? 'ambulance_location_selection' : 'home_visit_location_selection',
      'CON We could not confirm that location.\n1. Enter again\n2. Send for dispatcher review');
  }
  const candidateIds = outcome.candidates.map((candidate) => candidate.id);
  const candidateLabels = outcome.candidates.map(locationLabel);
  await deps.store.save({
    channel: 'USSD', sessionKey: input.sessionId, phoneNumber: input.phoneNumber, flow: input.flow,
    step: 'WAITING_FOR_LOCATION_SELECTION', collectedData: { address, candidateIds, candidateLabels }, requestId: null,
    expiresAt: expiry(deps.now ?? (() => new Date())),
  });
  return response(input.flow === 'AMBULANCE' ? 'ambulance_location_selection' : 'home_visit_location_selection',
    candidateLabels.length === 1
      ? `CON We found:\n${candidateLabels[0]}\n1. Confirm\n2. Enter again`
      : `CON Choose location:\n${candidateLabels.map((label, index) => `${index + 1}. ${label}`).join('\n')}\n${candidateLabels.length + 1}. Enter again`);
}

async function selectedLocation(
  input: { sessionId: string; phoneNumber: string; flow: 'AMBULANCE' | 'HOME_VISIT'; selection: string },
  deps: UssdWorkflowDeps,
): Promise<{ address: string; candidateId?: string; locationReview?: boolean; restart?: boolean } | null> {
  const session = await deps.store.get('USSD', input.sessionId);
  const draft = session?.collectedData as UssdLocationDraft | undefined;
  if (!draft?.address) return null;
  if (draft.unresolved) {
    if (input.selection === '1') return { address: draft.address, restart: true };
    if (input.selection === '2') return { address: draft.address, locationReview: true };
    return null;
  }
  const candidateIds = Array.isArray(draft.candidateIds) ? draft.candidateIds : [];
  if (input.selection === String(candidateIds.length + 1)) return { address: draft.address, restart: true };
  const index = candidateIds.length === 1 ? input.selection === '1' ? 0 : -1 : Number(input.selection) - 1;
  if (index < 0 || index >= candidateIds.length) return null;
  const candidateId = candidateIds[index];
  try {
    await deps.location.confirm({ channel: 'USSD', ownerKey: `${input.phoneNumber}:${input.sessionId}`, candidateId });
  } catch (error) {
    if (error instanceof LocationConfirmationError) return null;
    throw error;
  }
  return { address: draft.address, candidateId };
}

async function requestStatus(referenceCode: string, phoneNumber: string, dispatch: ChannelDispatchService): Promise<UssdResponse> {
  const request = await dispatch.getRequestByReferenceForPhone(referenceCode, phoneNumber);
  if (!request) return response('confirmation', 'END We could not find that request reference for this number.');
  return response('confirmation', `END ${request.reference_code} is currently ${statusLabel(request)}.`);
}

/** Runs the Africa's Talking accumulated-text flow and delegates only final creates to DispatchService. */
export async function processUssdRequest(
  input: { sessionId: string; phoneNumber: string; text: string },
  deps: UssdWorkflowDeps,
): Promise<UssdResponse> {
  const text = input.text.trim();
  if (!text) return response('main_menu', MAIN_MENU);
  const parts = partsFor(text);
  const first = parts[0];

  if (first === '3') {
    if (parts.length === 1) return response('reference_prompt', REFERENCE_PROMPT);
    return parts.length === 2 && parts[1] ? requestStatus(parts[1], input.phoneNumber, deps.dispatch) : response('invalid_selection', INVALID_SELECTION);
  }

  if (first === '1') {
    if (parts.length === 1) return response('ambulance_conscious', AMBULANCE_MENU);
    if (!choice(parts[1], ['1', '2'])) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 2) return response('ambulance_location', LOCATION_PROMPT);
    if (!parts[2]) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 6) {
      const existing = await deps.store.get('USSD', input.sessionId);
      if (existing?.requestId && existing.collectedData.inputText === text && typeof existing.collectedData.referenceCode === 'string') {
        return response('confirmation', `END NovaCare demo request received.\nReference: ${existing.collectedData.referenceCode}`);
      }
    }
    if (parts.length === 3) return locationChoice({ sessionId: input.sessionId, phoneNumber: input.phoneNumber, flow: 'AMBULANCE', address: parts[2] }, deps);
    const selected = await selectedLocation({ sessionId: input.sessionId, phoneNumber: input.phoneNumber, flow: 'AMBULANCE', selection: parts[3] }, deps);
    if (!selected) return response('invalid_selection', 'END Location selection is invalid or expired. Please start again.');
    if (selected.restart) {
      await deps.store.clear('USSD', input.sessionId);
      return response('ambulance_location', 'END Please start again to enter another address.');
    }
    if (parts.length === 4) return response('ambulance_reason', AMBULANCE_REASON_PROMPT);
    if (!parts[4]) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 5) return response('ambulance_confirm', CONFIRM_AMBULANCE);
    if (parts.length !== 6) return response('invalid_selection', INVALID_SELECTION);
    if (parts[5] === '2') {
      await deps.store.clear('USSD', input.sessionId);
      return response('confirmation', 'END Ambulance demo request cancelled.');
    }
    if (parts[5] !== '1') return response('invalid_selection', INVALID_SELECTION);
    return completeRequest({
      phoneNumber: input.phoneNumber,
      sessionId: input.sessionId,
      text,
      type: 'AMBULANCE',
      address: selected.address,
      candidateId: selected.candidateId,
      locationReview: selected.locationReview,
      reason: parts[4],
      conscious: parts[1] === '1' ? 'YES' : 'NO',
    }, deps);
  }

  if (first === '2') {
    if (parts.length === 1) return response('home_visit_practitioner', HOME_VISIT_MENU);
    if (!choice(parts[1], ['1', '2', '3'])) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 2) return response('home_visit_location', LOCATION_PROMPT);
    if (!parts[2]) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 6) {
      const existing = await deps.store.get('USSD', input.sessionId);
      if (existing?.requestId && existing.collectedData.inputText === text && typeof existing.collectedData.referenceCode === 'string') {
        return response('confirmation', `END NovaCare demo request received.\nReference: ${existing.collectedData.referenceCode}`);
      }
    }
    if (parts.length === 3) return locationChoice({ sessionId: input.sessionId, phoneNumber: input.phoneNumber, flow: 'HOME_VISIT', address: parts[2] }, deps);
    const selected = await selectedLocation({ sessionId: input.sessionId, phoneNumber: input.phoneNumber, flow: 'HOME_VISIT', selection: parts[3] }, deps);
    if (!selected) return response('invalid_selection', 'END Location selection is invalid or expired. Please start again.');
    if (selected.restart) {
      await deps.store.clear('USSD', input.sessionId);
      return response('home_visit_location', 'END Please start again to enter another address.');
    }
    if (parts.length === 4) return response('home_visit_reason', HOME_VISIT_REASON_PROMPT);
    if (!parts[4]) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 5) return response('home_visit_confirm', CONFIRM_HOME_VISIT);
    if (parts.length !== 6) return response('invalid_selection', INVALID_SELECTION);
    if (parts[5] === '2') {
      await deps.store.clear('USSD', input.sessionId);
      return response('confirmation', 'END Home-visit demo request cancelled.');
    }
    if (parts[5] !== '1') return response('invalid_selection', INVALID_SELECTION);
    return completeRequest({
      phoneNumber: input.phoneNumber,
      sessionId: input.sessionId,
      text,
      type: 'HOME_VISIT',
      address: selected.address,
      candidateId: selected.candidateId,
      locationReview: selected.locationReview,
      reason: parts[4],
      preferredResponder: parts[1] === '1' ? 'DOCTOR' : parts[1] === '2' ? 'NURSE' : 'EITHER',
    }, deps);
  }

  return response('invalid_selection', INVALID_SELECTION);
}
