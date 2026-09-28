import type { ChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import { normalizePhoneNumber } from './channels/request-context.service.js';
import { adaptSmsRequest } from './dispatch/channel-adapters.js';
import type { ServiceStatus } from './dispatch/domain.js';
import { sendSms } from './sms.client.js';
import type { ChannelDispatchService } from './ussd.service.js';

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
  now?: () => Date;
}

export const SMS_REPLY_AMBULANCE = 'NovaCare test: ambulance request received. Please send your address to 45854.';
export const SMS_REPLY_HOME = 'NovaCare test: home visit request received. Reply DOCTOR, NURSE, or EITHER to 45854.';
export const SMS_REPLY_FALLBACK = 'NovaCare test: Reply AMBULANCE or HOME to 45854.';

const SESSION_TTL_MS = 30 * 60 * 1000;

type SmsFlow = 'AMBULANCE' | 'HOME_VISIT';
type SmsStep = 'WAITING_FOR_ADDRESS' | 'WAITING_FOR_CONSCIOUSNESS' | 'WAITING_FOR_PREFERENCE' | 'WAITING_FOR_REASON' | 'WAITING_FOR_CONFIRMATION' | 'COMPLETED';

type SmsDraft = {
  address?: string;
  conscious?: 'YES' | 'NO';
  preferredResponder?: 'DOCTOR' | 'NURSE' | 'EITHER';
  reason?: string;
  referenceCode?: string;
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

function statusLabel(status: ServiceStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
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
  const requestedAddress = draft.address?.toUpperCase() === 'SAVED' ? requester.savedAddress : draft.address;
  if (!requestedAddress) return 'NovaCare could not use a saved address. Reply RESTART to 45854 and send an address.';
  const location = await deps.context.resolveLocation(requestedAddress);
  const request = await deps.dispatch.createServiceRequest(adaptSmsRequest({
    phoneNumber,
    type: flow === 'AMBULANCE' ? 'AMBULANCE' : 'HOME_VISIT',
    reason: draft.reason,
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    conscious: draft.conscious,
    preferredResponder: draft.preferredResponder,
    requesterUserId: requester.userId,
  }));
  await saveConversation(deps, phoneNumber, flow, 'COMPLETED', { ...draft, referenceCode: request.reference_code }, request.id);
  return `NovaCare demo request received. Reference: ${request.reference_code}. Reply STATUS ${request.reference_code} to 45854 for updates.`;
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
        ? `${request.reference_code} is currently ${statusLabel(request.status)}.`
        : 'NovaCare could not find that request reference for this number.',
    };
  }

  const command = normalizeCommand(text);
  if (command === 'ambulance' || command === 'home') {
    const flow: SmsFlow = command === 'ambulance' ? 'AMBULANCE' : 'HOME_VISIT';
    const step: SmsStep = flow === 'AMBULANCE' ? 'WAITING_FOR_ADDRESS' : 'WAITING_FOR_PREFERENCE';
    await saveConversation(deps, phoneNumber, flow, step, {});
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
    const next = flow === 'AMBULANCE' ? 'WAITING_FOR_CONSCIOUSNESS' : 'WAITING_FOR_REASON';
    await saveConversation(deps, phoneNumber, flow, next, { ...draft, address });
    return flow === 'AMBULANCE'
      ? { command: 'ambulance', reply: 'Is the patient conscious? Reply YES or NO to 45854.' }
      : { command: 'home', reply: 'Briefly describe the reason for the home visit. Reply CANCEL to stop or RESTART to begin again.' };
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
