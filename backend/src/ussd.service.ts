import type { ChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import { adaptUssdRequest } from './dispatch/channel-adapters.js';
import type { DispatchService } from './dispatch/dispatch.service.js';
import type { ServiceStatus } from './dispatch/domain.js';

export type ChannelDispatchService = Pick<
  DispatchService,
  'createServiceRequest' | 'getRequestByReferenceForPhone' | 'cancelRequestByReferenceForPhone'
>;

export type UssdStep =
  | 'main_menu'
  | 'ambulance_conscious'
  | 'ambulance_location'
  | 'ambulance_reason'
  | 'ambulance_confirm'
  | 'home_visit_practitioner'
  | 'home_visit_location'
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
  now?: () => Date;
}

export const USSD_INVALID_REQUEST_MESSAGE = 'END NovaCare could not process this request. Please try again.';

const MAIN_MENU = 'CON Welcome to NovaCare\n1. Request an ambulance\n2. Request a home visit\n3. Check a request';
const AMBULANCE_MENU = 'CON Ambulance request\nIs the patient conscious?\n1. Yes\n2. No';
const HOME_VISIT_MENU = 'CON Home visit request\nPlease select:\n1. Doctor\n2. Nurse\n3. Either';
const LOCATION_PROMPT = 'CON Send the address or location for the demo request. Reply SAVED to use a consented profile address, or DEMO SANDTON for simulated radius matching.';
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

function statusLabel(status: ServiceStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
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
  },
  deps: UssdWorkflowDeps,
): Promise<UssdResponse> {
  const existing = await deps.store.get('USSD', input.sessionId);
  if (existing?.requestId && existing.collectedData.inputText === input.text) {
    const reference = typeof existing.collectedData.referenceCode === 'string' ? existing.collectedData.referenceCode : null;
    if (reference) return response('confirmation', `END NovaCare demo request received.\nReference: ${reference}`);
  }

  const requester = await deps.context.resolveRequester(input.phoneNumber);
  const requestedAddress = input.address.toUpperCase() === 'SAVED' ? requester.savedAddress : input.address;
  if (!requestedAddress) {
    return response('invalid_selection', 'END No consented saved address is available. Please start again and enter an address.');
  }
  const location = await deps.context.resolveLocation(requestedAddress);
  const request = await deps.dispatch.createServiceRequest(adaptUssdRequest({
    phoneNumber: input.phoneNumber,
    type: input.type,
    reason: input.reason.slice(0, 240),
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    conscious: input.conscious,
    preferredResponder: input.preferredResponder,
    requesterUserId: requester.userId,
  }));
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
  return response('confirmation', `END NovaCare demo request received.\nReference: ${request.reference_code}`);
}

async function requestStatus(referenceCode: string, phoneNumber: string, dispatch: ChannelDispatchService): Promise<UssdResponse> {
  const request = await dispatch.getRequestByReferenceForPhone(referenceCode, phoneNumber);
  if (!request) return response('confirmation', 'END We could not find that request reference for this number.');
  return response('confirmation', `END ${request.reference_code} is currently ${statusLabel(request.status)}.`);
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
    if (parts.length === 3) return response('ambulance_reason', AMBULANCE_REASON_PROMPT);
    if (!parts[3]) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 4) return response('ambulance_confirm', CONFIRM_AMBULANCE);
    if (parts.length !== 5) return response('invalid_selection', INVALID_SELECTION);
    if (parts[4] === '2') {
      await deps.store.clear('USSD', input.sessionId);
      return response('confirmation', 'END Ambulance demo request cancelled.');
    }
    if (parts[4] !== '1') return response('invalid_selection', INVALID_SELECTION);
    return completeRequest({
      phoneNumber: input.phoneNumber,
      sessionId: input.sessionId,
      text,
      type: 'AMBULANCE',
      address: parts[2],
      reason: parts[3],
      conscious: parts[1] === '1' ? 'YES' : 'NO',
    }, deps);
  }

  if (first === '2') {
    if (parts.length === 1) return response('home_visit_practitioner', HOME_VISIT_MENU);
    if (!choice(parts[1], ['1', '2', '3'])) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 2) return response('home_visit_location', LOCATION_PROMPT);
    if (!parts[2]) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 3) return response('home_visit_reason', HOME_VISIT_REASON_PROMPT);
    if (!parts[3]) return response('invalid_selection', INVALID_SELECTION);
    if (parts.length === 4) return response('home_visit_confirm', CONFIRM_HOME_VISIT);
    if (parts.length !== 5) return response('invalid_selection', INVALID_SELECTION);
    if (parts[4] === '2') {
      await deps.store.clear('USSD', input.sessionId);
      return response('confirmation', 'END Home-visit demo request cancelled.');
    }
    if (parts[4] !== '1') return response('invalid_selection', INVALID_SELECTION);
    return completeRequest({
      phoneNumber: input.phoneNumber,
      sessionId: input.sessionId,
      text,
      type: 'HOME_VISIT',
      address: parts[2],
      reason: parts[3],
      preferredResponder: parts[1] === '1' ? 'DOCTOR' : parts[1] === '2' ? 'NURSE' : 'EITHER',
    }, deps);
  }

  return response('invalid_selection', INVALID_SELECTION);
}
