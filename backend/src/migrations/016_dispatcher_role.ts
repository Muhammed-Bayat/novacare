export const migration = {
  name: '016_dispatcher_role',
  sql: `
    -- Dispatch Core: dispatchers coordinate service requests across the network.
    -- Existing roles keep working unchanged; the dispatcher role is additive.
    ALTER TABLE hospital_memberships
      DROP CONSTRAINT hospital_memberships_role_check;
    ALTER TABLE hospital_memberships
      ADD CONSTRAINT hospital_memberships_role_check
      CHECK (role IN ('administrator', 'nurse', 'doctor', 'dispatcher'));

    -- Dispatch Core §13: staff availability drives responder assignment eligibility.
    ALTER TABLE hospital_memberships
      ADD COLUMN availability TEXT NOT NULL DEFAULT 'AVAILABLE'
        CHECK (availability IN ('AVAILABLE', 'BUSY', 'OFF_DUTY')),
      ADD COLUMN home_visit_eligible BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN on_duty BOOLEAN NOT NULL DEFAULT true;
  `,
};
