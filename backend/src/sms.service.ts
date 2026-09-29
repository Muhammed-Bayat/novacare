import { randomUUID } from 'node:crypto';
import type { ChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import { normalizePhoneNumber } from './channels/request-context.service.js';
import { adaptSmsRequest } from './dispatch/channel-adapters.js';
import type { ServiceRequestRow } from './dispatch/domain.js';
import { sendSms } from './sms.client.js';
import type { ChannelDispatchService } from './ussd.service.js';
import {
  LocationConfirmationError,
  type LocationResolutionService,
} from './location/location-resolution.service.js';

export type SmsCommand = 'ambulance' | 'home' | 'unknown';

export type IncomingSms = {
  from: string;
  text: string;
  to?: string;
  linkId?: string;
  messageId?: string;
};

export type SmsWorkflowResult = { command: SmsCommand; reply: string; replayed: boolean };

export interface SmsWorkflowDeps {
  dispatch: ChannelDispatchService;
  store: ChannelConversationStore;
  context: ChannelRequestContext;
  location: LocationResolutionService;
  now?: () => Date;
}

export const SMS_REPLY_AMBULANCE = 'NovaCare test: ambulance request received. Please send your address to 45854.';
export const SMS_REPLY_HOME = 'NovaCare test: home visit request received. Reply DOCTOR, NURSE, or EITHER to 45854.';
export const SMS_REPLY_FALLBACK = 'NovaCare test: Reply AMBULANCE or HOME to 45854.';

const SESSION_TTL_MS = 30 * 60 * 1000;

type SmsFlow = 'AMBULANCE' | 'HOME_VISIT';
type SmsStep = 'WAITING_FOR_ADDRESS' | 'WAITING_FOR_LOCATION_SELECTION' | 'WAITING_FOR_CONSCIOUSNESS' | 'WAITING_FOR_PREFERENCE' | 'WAITING_FOR_REASON' | 'WAITING_FOR_CONFIRMATION' | 'COMPLETED';

type SmsDraft = {
  address?: string;
  conscious?: 'YES' | 'NO';
  preferredResponder?: 'DOCTOR' | 'NURSE' | 'EITHER';
  reason?: string;
  referenceCode?: string;
  pendingCandidateIds?: string[];
  confirmedCandidateId?: string;
  locationReview?: boolean;
  locationFailureCount?: number;
  submissionKey?: string;
};

export function maskPhone(phone: string): string {
  return phone.replace(/^(\+\d{3})\d+(\d{2})$/, '$1....$2');
}

export function logSms(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ channel: 'sms', event, ...fields }));
}

export function normalizeCommand(text: string): SmsCommand {
  const command = text.trim().toUpperCase();
  if (command === 'AMBULANCE') return 'ambulance';
  if (command === 'HOME') return 'home';
  return 'unknown';
}

export function replyForCommand(command: SmsCommand): string {
  if (command === 'ambulance') return SMS_REPLY_AMBULANCE;
  if (command === 'home') return SMS_REPLY_HOME;
  return SMS_REPLY_FALLBACK;
}

export async function sendSmsReply(input: IncomingSms & { reply: string; command: string }): Promise<void> {
  const masked = maskPhone(input.from);
  try {
    const delivery = await sendSms(input.from, input.reply);
    logSms('reply.sent', { from: masked, command: input.command, ...delivery });
  } catch (error) {
    logSms('reply.failed', { from: masked, command: input.command, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Retained as the focused transport entry point; workflows below supply stateful replies. */
export async function handleIncomingSms(message: IncomingSms): Promise<{ command: SmsCommand; reply: string }> {
  const command = normalizeCommand(message.text);
  const reply = replyForCommand(command);
  logSms('incoming.received', {
    from: maskPhone(message.from),
    to: message.to ?? null,
    linkId: message.linkId ?? null,
    messageId: message.messageId ?? null,
    command,
  });
  await sendSmsReply({ ...message, reply, command });
  return { command, reply };
}

function expiry(now: () => Date): string {
  return new Date(now().getTime() + SESSION_TTL_MS).toISOString();
}

function statusLabel(request: Pick<ServiceRequestRow, 'status' | 'location_state'>): string {
  if (request.location_state === 'DISPATCHER_LOCATION_REVIEW') return 'waiting for location review';
  return request.status.toLowerCase().replace(/_/g, ' ');
}

async function saveConversation(
  deps: SmsWorkflowDeps,
  phoneNumber: string,
  flow: SmsFlow,
  step: SmsStep,
  collectedData: SmsDraft,
  requestId: string | null = null,
): Promise<void> {
  await deps.store.save({
    channel: 'SMS',
    sessionKey: phoneNumber,
    phoneNumber,
    flow,
    step,
    collectedData,
    requestId,
    expiresAt: expiry(deps.now ?? (() => new Date())),
  });
}

function boundedReplyText(text: string): string {
  return text.trim().slice(0, 240);
}

async function completeRequest(
  phoneNumber: string,
  flow: SmsFlow,
  draft: SmsDraft,
  deps: SmsWorkflowDeps,
): Promise<string> {
  const requester = await deps.context.resolveRequester(phoneNumber);
  if (!draft.address) return 'NovaCare could not confirm the location. Reply RESTART to 45854 and send an address.';
  let confirmed: Awaited<ReturnType<LocationResolutionService['getConfirmed']>> | undefined;
  if (!draft.locationReview) {
    if (!draft.confirmedCandidateId) return 'NovaCare could not confirm the location. Reply RESTART to 45854 and send an address.';
    try {
      confirmed = await deps.location.getConfirmed({
        channel: 'SMS',
        ownerKey: phoneNumber,
        candidateId: draft.confirmedCandidateId,
      });
    } catch (error) {
      if (error instanceof LocationConfirmationError) {
        return 'That location confirmation expired. Reply RESTART to 45854 and enter the address again.';
      }
      throw error;
    }
  }
  const request = await deps.dispatch.createServiceRequest(adaptSmsRequest({
    phoneNumber,
    type: flow === 'AMBULANCE' ? 'AMBULANCE' : 'HOME_VISIT',
    reason: draft.reason,
    address: confirmed?.enteredAddress ?? draft.address,
    latitude: confirmed?.latitude ?? null,
    longitude: confirmed?.longitude ?? null,
    conscious: draft.conscious,
    preferredResponder: draft.preferredResponder,
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
        idempotencyKey: draft.submissionKey,
      }),
  }));
  if (confirmed) await deps.location.linkRequest(confirmed.id, request.id);
  await saveConversation(deps, phoneNumber, flow, 'COMPLETED', { ...draft, referenceCode: request.reference_code }, request.id);
  return draft.locationReview
    ? `NovaCare demo request received. Reference: ${request.reference_code}. Location needs dispatcher review. Reply STATUS ${request.reference_code} to 45854 for updates.`
    : `NovaCare demo request received. Reference: ${request.reference_code}. Reply STATUS ${request.reference_code} to 45854 for updates.`;
}

function locationLabel(candidate: { formattedAddress: string; city?: string; suburb?: string }): string {
  const locality = [candidate.suburb, candidate.city].filter(Boolean).join(', ');
  return locality && !candidate.formattedAddress.toLowerCase().includes(locality.toLowerCase())
    ? `${candidate.formattedAddress}, ${locality}`.slice(0, 130)
    : candidate.formattedAddress.slice(0, 130);
}

function nextAfterLocation(flow: SmsFlow): SmsStep {
  return flow === 'AMBULANCE' ? 'WAITING_FOR_CONSCIOUSNESS' : 'WAITING_FOR_REASON';
}

function promptAfterLocation(flow: SmsFlow): string {
  return flow === 'AMBULANCE'
    ? 'Is the patient conscious? Reply YES or NO to 45854.'
    : 'Briefly describe the reason for the home visit. Reply CANCEL to stop or RESTART to begin again.';
}

async function processConversation(phoneNumber: string, text: string, deps: SmsWorkflowDeps): Promise<{ command: SmsCommand; reply: string }> {
  const upper = text.trim().toUpperCase();
  const session = await deps.store.get('SMS', phoneNumber);

  if (upper === 'RESTART') {
    await deps.store.clear('SMS', phoneNumber);
    return { command: 'unknown', reply: 'NovaCare conversation restarted. Reply AMBULANCE or HOME to 45854.' };
  }

  if (upper === 'CANCEL') {
    const reference = typeof session?.collectedData.referenceCode === 'string' ? session.collectedData.referenceCode : null;
    await deps.store.clear('SMS', phoneNumber);
    if (reference) {
      const cancelled = await deps.dispatch.cancelRequestByReferenceForPhone(reference, phoneNumber);
      return {
        command: 'unknown',
        reply: cancelled?.status === 'CANCELLED'
          ? `NovaCare demo request ${reference} cancelled.`
          : `NovaCare could not cancel ${reference}. It may already be completed or unavailable.`,
      };
    }
    return { command: 'unknown', reply: 'NovaCare request setup cancelled. Reply AMBULANCE or HOME to 45854.' };
  }

  const statusMatch = /^STATUS\s+(NC-\d{4}-\d{6})$/i.exec(text.trim());
  if (statusMatch) {
    const request = await deps.dispatch.getRequestByReferenceForPhone(statusMatch[1], phoneNumber);
    return {
      command: 'unknown',
      reply: request
        ? `${request.reference_code} is currently ${statusLabel(request)}.`
        : 'NovaCare could not find that request reference for this number.',
    };
  }

  const command = normalizeCommand(text);
  if (command === 'ambulance' || command === 'home') {
    const flow: SmsFlow = command === 'ambulance' ? 'AMBULANCE' : 'HOME_VISIT';
    const step: SmsStep = flow === 'AMBULANCE' ? 'WAITING_FOR_ADDRESS' : 'WAITING_FOR_PREFERENCE';
    await saveConversation(deps, phoneNumber, flow, step, { submissionKey: randomUUID() });
    return { command, reply: replyForCommand(command) };
  }

  if (!session || session.step === 'COMPLETED') return { command: 'unknown', reply: SMS_REPLY_FALLBACK };
  const flow = session.flow === 'HOME_VISIT' ? 'HOME_VISIT' : 'AMBULANCE';
  const draft = session.collectedData as SmsDraft;

  if (session.step === 'WAITING_FOR_PREFERENCE') {
    const preferredResponder = upper === 'DOCTOR' ? 'DOCTOR' : upper === 'NURSE' ? 'NURSE' : upper === 'EITHER' ? 'EITHER' : null;
    if (!preferredResponder) return { command: 'home', reply: 'Reply DOCTOR, NURSE, or EITHER to 45854.' };
    await saveConversation(deps, phoneNumber, flow, 'WAITING_FOR_ADDRESS', { ...draft, preferredResponder });
    return { command: 'home', reply: 'Please send your address to 45854. Reply SAVED to use a consented profile address, or DEMO SANDTON for simulated radius matching.' };
  }

  if (session.step === 'WAITING_FOR_ADDRESS') {
    const address = boundedReplyText(text);
    if (!address) return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: 'Please send your address to 45854.' };
    if (upper === 'REVIEW' && draft.address && (draft.locationFailureCount ?? 0) >= 2) {
      await saveConversation(deps, phoneNumber, flow, nextAfterLocation(flow), { ...draft, locationReview: true });
      return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: promptAfterLocation(flow) };
    }
    const requester = address.toUpperCase() === 'SAVED' ? await deps.context.resolveRequester(phoneNumber) : null;
    const requestedAddress = address.toUpperCase() === 'SAVED' ? requester?.savedAddress : address;
    if (!requestedAddress) {
      return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: 'No consented saved address is available. Please send an address to 45854.' };
    }
    const outcome = await deps.location.resolve({ channel: 'SMS', ownerKey: phoneNumber, address: requestedAddress });
    if (outcome.status === 'unresolved') {
      const failures = (draft.locationFailureCount ?? 0) + 1;
      await saveConversation(deps, phoneNumber, flow, 'WAITING_FOR_ADDRESS', { ...draft, address: requestedAddress, locationFailureCount: failures });
      return {
        command: flow === 'AMBULANCE' ? 'ambulance' : 'home',
        reply: failures >= 2
          ? 'We could not confirm that location. Send a more complete address to 45854, or reply REVIEW to send it for dispatcher review.'
          : 'We could not confirm that location. Please send a more complete address to 45854, for example 12 Main Road, Sandton, Johannesburg.',
      };
    }
    const candidateIds = outcome.candidates.map((candidate) => candidate.id);
    await saveConversation(deps, phoneNumber, flow, 'WAITING_FOR_LOCATION_SELECTION', {
      ...draft,
      address: requestedAddress,
      pendingCandidateIds: candidateIds,
      confirmedCandidateId: undefined,
      locationReview: false,
    });
    if (outcome.candidates.length === 1) {
      return {
        command: flow === 'AMBULANCE' ? 'ambulance' : 'home',
        reply: `We found: ${locationLabel(outcome.candidates[0])}. Send YES to 45854 to confirm, or NO to enter the address again.`,
      };
    }
    return {
      command: flow === 'AMBULANCE' ? 'ambulance' : 'home',
      reply: `We found:\n${outcome.candidates.map((candidate, index) => `${index + 1}. ${locationLabel(candidate)}`).join('\n')}\nSend 1-${outcome.candidates.length} to 45854. Send 0 to enter the address again.`,
    };
  }

  if (session.step === 'WAITING_FOR_LOCATION_SELECTION') {
    const candidateIds = Array.isArray(draft.pendingCandidateIds) ? draft.pendingCandidateIds : [];
    const selectedIndex = candidateIds.length === 1
      ? upper === 'YES' ? 0 : -1
      : /^\d+$/.test(upper) ? Number(upper) - 1 : -1;
    if ((candidateIds.length === 1 && upper === 'NO') || (candidateIds.length > 1 && upper === '0')) {
      await saveConversation(deps, phoneNumber, flow, 'WAITING_FOR_ADDRESS', { ...draft, pendingCandidateIds: undefined, confirmedCandidateId: undefined });
      return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: 'Please send the address again to 45854.' };
    }
    if (selectedIndex < 0 || selectedIndex >= candidateIds.length) {
      return {
        command: flow === 'AMBULANCE' ? 'ambulance' : 'home',
        reply: candidateIds.length === 1 ? 'Reply YES to confirm or NO to enter the address again.' : `Reply 1-${candidateIds.length} to 45854, or 0 to enter the address again.`,
      };
    }
    const candidateId = candidateIds[selectedIndex];
    try {
      await deps.location.confirm({ channel: 'SMS', ownerKey: phoneNumber, candidateId });
    } catch (error) {
      if (error instanceof LocationConfirmationError) {
        await saveConversation(deps, phoneNumber, flow, 'WAITING_FOR_ADDRESS', { ...draft, pendingCandidateIds: undefined, confirmedCandidateId: undefined });
        return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: 'That location selection expired. Please send the address again to 45854.' };
      }
      throw error;
    }
    await saveConversation(deps, phoneNumber, flow, nextAfterLocation(flow), { ...draft, confirmedCandidateId: candidateId });
    return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: promptAfterLocation(flow) };
  }

  if (session.step === 'WAITING_FOR_CONSCIOUSNESS') {
    const conscious = upper === 'YES' ? 'YES' : upper === 'NO' ? 'NO' : null;
    if (!conscious) return { command: 'ambulance', reply: 'Reply YES or NO to 45854.' };
    await saveConversation(deps, phoneNumber, flow, 'WAITING_FOR_REASON', { ...draft, conscious });
    return { command: 'ambulance', reply: 'Briefly describe the emergency. Reply CANCEL to stop or RESTART to begin again.' };
  }

  if (session.step === 'WAITING_FOR_REASON') {
    const reason = boundedReplyText(text);
    if (!reason) return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: 'Please briefly describe the request, or reply CANCEL to 45854.' };
    await saveConversation(deps, phoneNumber, flow, 'WAITING_FOR_CONFIRMATION', { ...draft, reason });
    return {
      command: flow === 'AMBULANCE' ? 'ambulance' : 'home',
      reply: `Confirm this ${flow === 'AMBULANCE' ? 'ambulance' : 'home-visit'} demo request? Reply YES to submit or NO to cancel.`,
    };
  }

  if (session.step === 'WAITING_FOR_CONFIRMATION') {
    if (upper === 'NO') {
      await deps.store.clear('SMS', phoneNumber);
      return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: 'NovaCare request setup cancelled. Reply AMBULANCE or HOME to 45854.' };
    }
    if (upper !== 'YES') return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: 'Reply YES to submit or NO to cancel.' };
    return { command: flow === 'AMBULANCE' ? 'ambulance' : 'home', reply: await completeRequest(phoneNumber, flow, draft, deps) };
  }

  return { command: 'unknown', reply: SMS_REPLY_FALLBACK };
}

/** Persists each prompt before SMS delivery so a Render restart cannot lose the next step. */
export async function processSmsConversation(message: IncomingSms, deps: SmsWorkflowDeps): Promise<SmsWorkflowResult> {
  const phoneNumber = normalizePhoneNumber(message.from);
  if (message.messageId) {
    const receipt = await deps.store.getReceipt('SMS', message.messageId);
    if (receipt) return { command: 'unknown', reply: receipt, replayed: true };
  }
  const result = await processConversation(phoneNumber, message.text, deps);
  if (message.messageId) await deps.store.saveReceipt('SMS', message.messageId, result.reply);
  return { ...result, replayed: false };
}
