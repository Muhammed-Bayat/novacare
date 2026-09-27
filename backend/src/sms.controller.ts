import type { RequestHandler } from 'express';
import { handleIncomingSms, logSms, maskPhone } from './sms.service.js';

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const smsIncomingHandler: RequestHandler = (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const from = asText(body.from).trim();
    const text = asText(body.text);
    const to = asText(body.to);
    const linkId = asText(body.linkId);
    const messageId = asText(body.id);

    if (!from || !text.trim()) {
      logSms('incoming.rejected', { from: from ? maskPhone(from) : null, to: to || null });
      res.status(200).type('text/plain').send('ok');
      return;
    }

    // The reply SMS runs in the background so Africa's Talking gets its 200 immediately.
    void handleIncomingSms({ from, text, to: to || undefined, linkId: linkId || undefined, messageId: messageId || undefined });
    res.status(200).type('text/plain').send('ok');
  } catch (error) {
    console.error('[sms] incoming callback failed:', error);
    res.status(200).type('text/plain').send('ok');
  }
};
