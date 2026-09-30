export const migration = {
  name: '024_clinical_queue_completion',
  sql: `
    -- Keep only the earliest active entry when upgrading databases that allowed
    -- duplicate awaiting-triage records.
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, hospital_service_id, queue_date
               ORDER BY CASE status
                 WHEN 'in_consultation' THEN 0
                 WHEN 'called' THEN 1
                 WHEN 'waiting' THEN 2
                 ELSE 3
               END,
               updated_at DESC,
               joined_at,
               id
             ) AS position
      FROM queue_entries
      WHERE status IN ('awaiting_triage', 'waiting', 'called', 'in_consultation')
    )
    UPDATE queue_entries q
    SET status = 'cancelled', updated_at = now()
    FROM ranked r
    WHERE q.id = r.id AND r.position > 1;

    DROP INDEX queue_entries_one_active_service_per_day;
    CREATE UNIQUE INDEX queue_entries_one_active_service_per_day
      ON queue_entries (user_id, hospital_service_id, queue_date)
      WHERE status IN ('awaiting_triage', 'waiting', 'called', 'in_consultation');

    ALTER TABLE clinical_diagnoses
      ADD COLUMN queue_entry_id UUID REFERENCES queue_entries(id) ON DELETE SET NULL,
      ADD COLUMN hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
      ADD COLUMN diagnosed_by UUID REFERENCES users(id) ON DELETE SET NULL;

    CREATE UNIQUE INDEX clinical_diagnoses_one_per_queue_entry
      ON clinical_diagnoses (queue_entry_id)
      WHERE queue_entry_id IS NOT NULL;
    CREATE INDEX clinical_diagnoses_by_patient_hospital
      ON clinical_diagnoses (patient_profile_id, hospital_id, diagnosed_on DESC);
  `,
};
