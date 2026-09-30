export const migration = {
  name: '025_showcase_patient_seed_tracking',
  sql: `
    CREATE TABLE showcase_patient_seed_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      seed_date DATE NOT NULL,
      seed_version INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      rolled_back_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX showcase_patient_seed_one_active_run
      ON showcase_patient_seed_runs (hospital_id, seed_date, seed_version)
      WHERE rolled_back_at IS NULL;

    CREATE TABLE showcase_patient_seed_records (
      run_id UUID NOT NULL REFERENCES showcase_patient_seed_runs(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'appointment', 'queue_entry')),
      entity_id UUID NOT NULL,
      PRIMARY KEY (run_id, entity_type, entity_id)
    );

    CREATE INDEX showcase_patient_seed_records_by_entity
      ON showcase_patient_seed_records (entity_type, entity_id);
  `,
};
