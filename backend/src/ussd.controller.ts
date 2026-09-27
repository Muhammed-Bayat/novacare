import type { RequestHandler } from 'express';
import { responseForText, USSD_INVALID_REQUEST_MESSAGE } from './ussd.service.js';

type UssdLogFields = Record<string, unknown>;

// TEMPORARY: phoneNumber is included for sandbox debugging only. Mask or drop it
// (remove the phoneNumber key here) before this channel is used with real patients.
function logUssd(event: string, fields: UssdLogFields): void {
  console.log(JSON.stringify({ channel: 'ussd', event, ...fields }));
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const ussdCallbackHandler: RequestHandler = (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionId = asText(body.sessionId);
    const serviceCode = asText(body.serviceCode);
    const phoneNumber = asText(body.phoneNumber);
    const text = asText(body.text);

    if (!sessionId || !serviceCode || !phoneNumber) {
      logUssd('callback.rejected', { sessionId, serviceCode, phoneNumber });
      res.status(200).type('text/plain').send(USSD_INVALID_REQUEST_MESSAGE);
      return;
    }

    const { step, message } = responseForText(text);
    logUssd('callback.received', { sessionId, serviceCode, phoneNumber, step, text });
    res.status(200).type('text/plain').send(message);
  } catch (error) {
    console.error('[ussd] callback failed:', error);
    res.status(200).type('text/plain').send(USSD_INVALID_REQUEST_MESSAGE);
  }
};
