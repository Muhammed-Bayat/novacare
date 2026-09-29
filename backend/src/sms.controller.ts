import type { RequestHandler } from 'express';
import type { ChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import type { LocationResolutionService } from './location/location-resolution.service.js';
import { logSms, maskPhone, processSmsConversation, sendSmsReply, type IncomingSms } from './sms.service.js';
import type { ChannelDispatchService } from './ussd.service.js';

const SMS_SANDBOX_SHORTCODE = '45854';

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createSmsIncomingHandler(deps: {
  dispatch: ChannelDispatchService;
  store: ChannelConversationStore;
  context: ChannelRequestContext;
  location: LocationResolutionService;
}): RequestHandler {
  return async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const from = asText(body.from).trim();
      const text = asText(body.text);
      const to = asText(body.to);
      const linkId = asText(body.linkId);
      const messageId = asText(body.id);

      if (!from || !text.trim() || to !== SMS_SANDBOX_SHORTCODE) {
        logSms('incoming.rejected', { from: from ? maskPhone(from) : null, to: to || null });
        res.status(200).type('text/plain').send('ok');
        return;
      }

      const message: IncomingSms = { from, text, to: to || undefined, linkId: linkId || undefined, messageId: messageId || undefined };
      const result = await processSmsConversation(message, deps);
      logSms('incoming.received', {
        from: maskPhone(from),
        to: message.to ?? null,
        linkId: message.linkId ?? null,
        messageId: message.messageId ?? null,
        command: result.command,
        replayed: result.replayed,
      });
      res.status(200).type('text/plain').send('ok');
      if (!result.replayed) void sendSmsReply({ ...message, reply: result.reply, command: result.command });
    } catch (error) {
      console.error('[sms] incoming callback failed:', error);
      res.status(200).type('text/plain').send('ok');
    }
  };
}
