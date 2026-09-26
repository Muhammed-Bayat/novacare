export const migration = {
  name: '009_patient_queues',
  sql: `
    CREATE TABLE queue_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hospital_id UUID NOT NULL REFERENCES hospitals(id),
      hospital_service_id UUID NOT NULL REFERENCES hospital_services(id),
      queue_date DATE NOT NULL DEFAULT CURRENT_DATE,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'completed', 'cancelled')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX queue_entries_one_active_service_per_day
      ON queue_entries (user_id, hospital_service_id, queue_date)
      WHERE status IN ('waiting', 'called');

    CREATE INDEX queue_entries_position_lookup
      ON queue_entries (hospital_service_id, queue_date, joined_at)
      WHERE status = 'waiting';
  `,
};
