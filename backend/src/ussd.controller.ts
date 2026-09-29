import type { RequestHandler } from 'express';
import type { ChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import type { LocationResolutionService } from './location/location-resolution.service.js';
import { normalizePhoneNumber } from './channels/request-context.service.js';
import { USSD_INVALID_REQUEST_MESSAGE, processUssdRequest, type ChannelDispatchService } from './ussd.service.js';

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function maskPhone(phone: string): string {
  return phone.replace(/^(\+\d{3})\d+(\d{2})$/, '$1....$2');
}

export function createUssdCallbackHandler(deps: {
  dispatch: ChannelDispatchService;
  store: ChannelConversationStore;
  context: ChannelRequestContext;
  location: LocationResolutionService;
  expectedServiceCode: string;
}): RequestHandler {
  return async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = asText(body.sessionId);
      const serviceCode = asText(body.serviceCode);
      const phoneNumber = asText(body.phoneNumber);
      const text = asText(body.text);

      if (!sessionId || !serviceCode || !phoneNumber || serviceCode !== deps.expectedServiceCode) {
        console.log(JSON.stringify({ channel: 'ussd', event: 'callback.rejected', sessionId, serviceCode, phoneNumber: maskPhone(phoneNumber) }));
        res.status(200).type('text/plain').send(USSD_INVALID_REQUEST_MESSAGE);
        return;
      }

      const result = await processUssdRequest({ sessionId, phoneNumber: normalizePhoneNumber(phoneNumber), text }, deps);
      console.log(JSON.stringify({ channel: 'ussd', event: 'callback.received', sessionId, serviceCode, phoneNumber: maskPhone(phoneNumber), step: result.step }));
      res.status(200).type('text/plain').send(result.message);
    } catch (error) {
      console.error('[ussd] callback failed:', error);
      res.status(200).type('text/plain').send(USSD_INVALID_REQUEST_MESSAGE);
    }
  };
}
