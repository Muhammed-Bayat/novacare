import { getPool } from '../db.js';

export type ChannelConversationChannel = 'USSD' | 'SMS';

export interface ChannelConversation {
  channel: ChannelConversationChannel;
  sessionKey: string;
  phoneNumber: string;
  flow: string;
  step: string;
  collectedData: Record<string, unknown>;
  requestId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelConversationStore {
  get(channel: ChannelConversationChannel, sessionKey: string): Promise<ChannelConversation | null>;
  save(input: Omit<ChannelConversation, 'createdAt' | 'updatedAt'>): Promise<void>;
  clear(channel: ChannelConversationChannel, sessionKey: string): Promise<void>;
  getReceipt(channel: ChannelConversationChannel, providerMessageId: string): Promise<string | null>;
  saveReceipt(channel: ChannelConversationChannel, providerMessageId: string, responseText: string): Promise<void>;
}

type ChannelConversationRow = {
  channel: ChannelConversationChannel;
  session_key: string;
  phone_number: string;
  flow: string;
  step: string;
  collected_data: unknown;
  request_id: string | null;
  expires_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
};

function normaliseCollectedData(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return {};
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function timestampToString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function conversationFromRow(row: ChannelConversationRow): ChannelConversation {
  return {
    channel: row.channel,
    sessionKey: row.session_key,
    phoneNumber: row.phone_number,
    flow: row.flow,
    step: row.step,
    collectedData: normaliseCollectedData(row.collected_data),
    requestId: row.request_id,
    expiresAt: timestampToString(row.expires_at),
    createdAt: timestampToString(row.created_at),
    updatedAt: timestampToString(row.updated_at),
  };
}

export function createPostgresChannelConversationStore(): ChannelConversationStore {
  return {
    async get(channel, sessionKey) {
      const result = await getPool().query<ChannelConversationRow>(
        `SELECT channel, session_key, phone_number, flow, step, collected_data, request_id, expires_at, created_at, updated_at
         FROM channel_conversations
         WHERE channel = $1 AND session_key = $2 AND expires_at > now()`,
        [channel, sessionKey],
      );
      return result.rows[0] ? conversationFromRow(result.rows[0]) : null;
    },

    async save(input) {
      await getPool().query(
        `INSERT INTO channel_conversations (
           channel, session_key, phone_number, flow, step, collected_data, request_id, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (channel, session_key) DO UPDATE
         SET phone_number = EXCLUDED.phone_number,
             flow = EXCLUDED.flow,
             step = EXCLUDED.step,
             collected_data = EXCLUDED.collected_data,
             request_id = EXCLUDED.request_id,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()`,
        [
          input.channel,
          input.sessionKey,
          input.phoneNumber,
          input.flow,
          input.step,
          JSON.stringify(input.collectedData),
          input.requestId,
          input.expiresAt,
        ],
      );
    },

    async clear(channel, sessionKey) {
      await getPool().query(
        'DELETE FROM channel_conversations WHERE channel = $1 AND session_key = $2',
        [channel, sessionKey],
      );
    },

    async getReceipt(channel, providerMessageId) {
      const result = await getPool().query<{ response_text: string }>(
        `SELECT response_text
         FROM channel_callback_receipts
         WHERE channel = $1 AND provider_message_id = $2`,
        [channel, providerMessageId],
      );
      return result.rows[0]?.response_text ?? null;
    },

    async saveReceipt(channel, providerMessageId, responseText) {
      await getPool().query(
        `INSERT INTO channel_callback_receipts (channel, provider_message_id, response_text)
         VALUES ($1,$2,$3)
         ON CONFLICT (channel, provider_message_id) DO NOTHING`,
        [channel, providerMessageId, responseText],
      );
    },
  };
}

function memoryKey(channel: ChannelConversationChannel, value: string): string {
  return `${channel}:${value}`;
}

function copyConversation(conversation: ChannelConversation): ChannelConversation {
  return { ...conversation, collectedData: { ...conversation.collectedData } };
}

export function createMemoryChannelConversationStore(): ChannelConversationStore {
  const conversations = new Map<string, ChannelConversation>();
  const receipts = new Map<string, string>();

  return {
    async get(channel, sessionKey) {
      const key = memoryKey(channel, sessionKey);
      const conversation = conversations.get(key);
      if (!conversation) return null;
      if (new Date(conversation.expiresAt).getTime() <= Date.now()) {
        conversations.delete(key);
        return null;
      }
      return copyConversation(conversation);
    },

    async save(input) {
      const key = memoryKey(input.channel, input.sessionKey);
      const existing = conversations.get(key);
      const now = new Date().toISOString();
      conversations.set(key, {
        ...input,
        collectedData: { ...input.collectedData },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    },

    async clear(channel, sessionKey) {
      conversations.delete(memoryKey(channel, sessionKey));
    },

    async getReceipt(channel, providerMessageId) {
      return receipts.get(memoryKey(channel, providerMessageId)) ?? null;
    },

    async saveReceipt(channel, providerMessageId, responseText) {
      const key = memoryKey(channel, providerMessageId);
      if (!receipts.has(key)) receipts.set(key, responseText);
    },
  };
}
