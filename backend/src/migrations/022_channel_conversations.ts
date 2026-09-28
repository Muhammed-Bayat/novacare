export const migration = {
  name: '022_channel_conversations',
  sql: `
    CREATE TABLE channel_conversations (
      channel TEXT NOT NULL CHECK (channel IN ('USSD', 'SMS')),
      session_key TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      flow TEXT NOT NULL,
      step TEXT NOT NULL,
      collected_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (channel, session_key)
    );

    CREATE INDEX channel_conversations_expires_at
      ON channel_conversations (expires_at);

    CREATE INDEX channel_conversations_phone_number
      ON channel_conversations (phone_number, created_at DESC);

    CREATE TABLE channel_callback_receipts (
      channel TEXT NOT NULL CHECK (channel IN ('USSD', 'SMS')),
      provider_message_id TEXT NOT NULL,
      response_text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (channel, provider_message_id)
    );
  `,
};
