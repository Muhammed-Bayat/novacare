export const migration = {
  name: '010_patient_health_records',
  sql: `
    CREATE TABLE patient_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      phone TEXT,
      date_of_birth DATE,
      home_address TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      chronic_conditions TEXT[] NOT NULL DEFAULT '{}',
      allergies TEXT[] NOT NULL DEFAULT '{}',
      medications TEXT[] NOT NULL DEFAULT '{}',
      blood_type TEXT,
      access_needs TEXT,
      health_notes TEXT,
      health_data_consent BOOLEAN NOT NULL DEFAULT false,
      consented_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE clinical_diagnoses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_profile_id UUID NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
      diagnosis TEXT NOT NULL,
      diagnosed_on DATE NOT NULL,
      clinician_name TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX clinical_diagnoses_by_profile ON clinical_diagnoses (patient_profile_id, diagnosed_on DESC);
  `,
};
