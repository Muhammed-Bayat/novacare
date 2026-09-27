import { sendSms } from './sms.client.js';

export type SmsCommand = 'ambulance' | 'home' | 'unknown';

export type IncomingSms = {
  from: string;
  text: string;
  to?: string;
  linkId?: string;
  messageId?: string;
};

export const SMS_REPLY_AMBULANCE = 'NovaCare test: ambulance request received. Please enter your address.';
export const SMS_REPLY_HOME = 'NovaCare test: home visit request received. Please enter your address.';
export const SMS_REPLY_FALLBACK = 'NovaCare test: Reply AMBULANCE or HOME.';

type SmsLogFields = Record<string, unknown>;

// TEMPORARY: the sender is masked to +27••••61 style for sandbox debugging only. Keep only
// masked forms here so no full patient phone numbers end up in logs.
export function maskPhone(phone: string): string {
  return phone.replace(/^(\+\d{3})\d+(\d{2})$/, '$1••••$2');
}

export function logSms(event: string, fields: SmsLogFields): void {
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

export async function handleIncomingSms(message: IncomingSms): Promise<{ command: SmsCommand; reply: string }> {
  const command = normalizeCommand(message.text);
  const reply = replyForCommand(command);
  const masked = maskPhone(message.from);
  logSms('incoming.received', {
    from: masked,
    to: message.to ?? null,
    linkId: message.linkId ?? null,
    messageId: message.messageId ?? null,
    command,
  });
  try {
    const delivery = await sendSms(message.from, reply);
    logSms('reply.sent', { from: masked, command, ...delivery });
  } catch (error) {
    logSms('reply.failed', { from: masked, command, error: error instanceof Error ? error.message : String(error) });
  }
  return { command, reply };
}
