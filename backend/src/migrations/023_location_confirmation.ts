export const migration = {
  name: '023_location_confirmation',
  sql: `
    ALTER TABLE service_requests
      ADD COLUMN location_state TEXT NOT NULL DEFAULT 'LEGACY' CHECK (location_state IN (
        'LEGACY', 'ADDRESS_ENTERED', 'GEOCODED_PENDING_CONFIRMATION',
        'LOCATION_CONFIRMED', 'LOCATION_UNRESOLVED', 'DISPATCHER_LOCATION_REVIEW'
      )),
      ADD COLUMN location_confirmation_required BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN location_confirmed_at TIMESTAMPTZ,
      ADD COLUMN location_source TEXT NOT NULL DEFAULT 'LEGACY' CHECK (location_source IN ('GPS', 'GEOCODED_ADDRESS', 'MANUAL_DISPATCHER', 'UNRESOLVED', 'LEGACY')),
      ADD COLUMN geocoded_formatted_address TEXT,
      ADD COLUMN geocoding_place_id TEXT,
      ADD COLUMN geocoding_confidence DOUBLE PRECISION,
      ADD COLUMN idempotency_key TEXT;

    CREATE UNIQUE INDEX service_requests_idempotency_key
      ON service_requests (idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE TABLE location_confirmation_candidates (
      id UUID PRIMARY KEY,
      channel TEXT NOT NULL CHECK (channel IN ('WEB', 'SMS', 'USSD')),
      owner_key TEXT NOT NULL,
      entered_address TEXT NOT NULL,
      formatted_address TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      province TEXT,
      city TEXT,
      suburb TEXT,
      place_id TEXT,
      result_type TEXT,
      confidence DOUBLE PRECISION,
      match_type TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      confirmed_at TIMESTAMPTZ,
      request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX location_confirmation_candidates_owner_expiry
      ON location_confirmation_candidates (channel, owner_key, expires_at DESC);
  `,
};
