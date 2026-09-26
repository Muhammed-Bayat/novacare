export const migration = {
  name: '013_appointment_triage_summary',
  sql: `
    ALTER TABLE appointments
      ADD COLUMN triage_urgency TEXT CHECK (triage_urgency IS NULL OR triage_urgency IN ('emergency', 'urgent', 'priority', 'routine')),
      ADD COLUMN triage_pathway TEXT,
      ADD COLUMN triage_department TEXT,
      ADD COLUMN triage_summary TEXT,
      ADD COLUMN triage_red_flags TEXT[] NOT NULL DEFAULT '{}';
  `,
};
