export const migration = {
  name: '014_queue_triage_workflow',
  sql: `
    ALTER TABLE queue_entries DROP CONSTRAINT queue_entries_status_check;
    ALTER TABLE queue_entries ADD CONSTRAINT queue_entries_status_check
      CHECK (status IN ('awaiting_triage', 'waiting', 'called', 'in_consultation', 'referred', 'completed', 'cancelled'));

    ALTER TABLE queue_entries
      ADD COLUMN appointment_id UUID REFERENCES appointments(id),
      ADD COLUMN triage_urgency TEXT CHECK (triage_urgency IS NULL OR triage_urgency IN ('emergency', 'urgent', 'priority', 'routine')),
      ADD COLUMN triage_pathway TEXT,
      ADD COLUMN triage_department TEXT,
      ADD COLUMN triage_summary TEXT,
      ADD COLUMN triage_red_flags TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN category TEXT CHECK (category IS NULL OR category IN ('emergency', 'urgent', 'priority', 'routine')),
      ADD COLUMN override_reason TEXT,
      ADD COLUMN triaged_at TIMESTAMPTZ,
      ADD COLUMN triaged_by UUID REFERENCES users(id),
      ADD COLUMN acknowledged_at TIMESTAMPTZ,
      ADD COLUMN acknowledged_by UUID REFERENCES users(id),
      ADD COLUMN called_at TIMESTAMPTZ,
      ADD COLUMN completed_at TIMESTAMPTZ;

    CREATE INDEX queue_entries_staff_worklist ON queue_entries (hospital_id, queue_date, status, joined_at);

    CREATE TABLE hospital_display_tokens (
      hospital_id UUID PRIMARY KEY REFERENCES hospitals(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO hospital_display_tokens (hospital_id)
      SELECT id FROM hospitals
      ON CONFLICT DO NOTHING;
  `,
};
