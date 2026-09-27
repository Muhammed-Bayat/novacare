export const migration = {
  name: '017_dispatch_schema',
  sql: `
    -- Dispatch Core: hospitals double as dispatch facilities. Capability flags are
    -- clearly simulated — this is a development prototype, no real facilities.
    ALTER TABLE hospitals
      ADD COLUMN ambulance_available BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN home_visit_available BOOLEAN NOT NULL DEFAULT false;

    -- Dispatch Core §13: simulated response units (e.g. ambulance callsign A01).
    CREATE TABLE response_units (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      callsign TEXT NOT NULL UNIQUE,
      unit_type TEXT NOT NULL CHECK (unit_type IN ('AMBULANCE')),
      hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
       status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'OUT_OF_SERVICE')),
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Dispatch Core §2: one shared service request domain for WEB/USSD/SMS.
    CREATE TABLE service_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reference_code TEXT NOT NULL UNIQUE,
      requester_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      requester_phone TEXT,
      type TEXT NOT NULL CHECK (type IN ('AMBULANCE', 'HOME_VISIT')),
      channel TEXT NOT NULL CHECK (channel IN ('WEB', 'USSD', 'SMS')),
      status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN (
        'CREATED', 'SEARCHING', 'NOTIFIED', 'ACKNOWLEDGED', 'ACCEPTED',
        'ASSIGNED', 'DISPATCHED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS',
        'COMPLETED', 'CANCELLED', 'NO_PROVIDER_FOUND'
      )),
      urgency TEXT NOT NULL DEFAULT 'STANDARD' CHECK (urgency IN ('EMERGENCY', 'URGENT', 'STANDARD')),
      reason TEXT,
      triage JSONB NOT NULL DEFAULT '{}',
      address TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      search_radius_km DOUBLE PRECISION,
      facilities_notified INTEGER,
      escalation_flag BOOLEAN NOT NULL DEFAULT false,
      assigned_facility_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
      assigned_responder_id UUID REFERENCES hospital_memberships(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       notified_at TIMESTAMPTZ,
       acknowledged_at TIMESTAMPTZ,
       assigned_at TIMESTAMPTZ,
       dispatched_at TIMESTAMPTZ,
       en_route_at TIMESTAMPTZ,
       arrived_at TIMESTAMPTZ,
       in_progress_at TIMESTAMPTZ,
       completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT
    );

    CREATE INDEX service_requests_live_queue
      ON service_requests (status, created_at DESC)
      WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'NO_PROVIDER_FOUND');

    CREATE INDEX service_requests_requester ON service_requests (requester_user_id, created_at DESC);

    -- Dispatch Core §3: centralized transition validation records every move.
    CREATE TABLE service_request_status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX service_request_history_by_request
      ON service_request_status_history (request_id, created_at);

    -- Dispatch Core §2: reference codes NC-<year>-<sequence>, allocated atomically.
    CREATE TABLE service_reference_counters (
      year INTEGER PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );

    -- Dispatch Core §5: per-facility notification outcomes for one request.
    CREATE TABLE dispatch_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
      facility_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      distance_km DOUBLE PRECISION,
      notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      acknowledged_at TIMESTAMPTZ,
      response_status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (response_status IN ('PENDING', 'ACKNOWLEDGED', 'AVAILABLE', 'UNAVAILABLE', 'ACCEPTED')),
      responded_at TIMESTAMPTZ,
      UNIQUE (request_id, facility_id)
    );

    CREATE INDEX dispatch_notifications_by_request ON dispatch_notifications (request_id);
    CREATE INDEX dispatch_notifications_by_facility ON dispatch_notifications (facility_id, notified_at DESC);
  `,
};
