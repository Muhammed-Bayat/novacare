export const migration = {
  name: '014_admin_domain',
  sql: `
    -- Plan §10 models a single "departments" concept. The repo already had
    -- hospital_services as that concept, so we rename it instead of duplicating it.
    -- Legacy FK column names (appointments.hospital_service_id, queue_entries.hospital_service_id)
    -- keep pointing at departments(id) and are intentionally left untouched.
    ALTER TABLE hospital_services RENAME TO departments;
    ALTER TABLE departments
      ADD COLUMN average_consultation_minutes INT NOT NULL DEFAULT 15
      CHECK (average_consultation_minutes > 0);

    CREATE TABLE appointment_slots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      slot_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      capacity INT NOT NULL CHECK (capacity >= 1),
      reserved_count INT NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (end_time > start_time),
      UNIQUE (department_id, slot_date, start_time)
    );

    CREATE INDEX appointment_slots_by_hospital_day
      ON appointment_slots (hospital_id, slot_date, start_time);

    CREATE TABLE audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX audit_events_by_hospital ON audit_events (hospital_id, created_at DESC);
  `,
};
