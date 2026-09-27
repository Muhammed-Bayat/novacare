export const migration = {
  name: '015_admin_settings',
  sql: `
    -- Plan §4: hospital administrators manage public display settings.
    -- The kiosk URL is /display/:token; the token is a hospital-level shared secret
    -- that is only ever returned to administrators (never logged, never in audit metadata).
    ALTER TABLE hospitals
      ADD COLUMN display_token TEXT UNIQUE,
      ADD COLUMN display_active BOOLEAN NOT NULL DEFAULT false;

    -- Plan §4 / §10: an invitation can carry optional department assignments
    -- (staff_invitations.department_ids), applied to the membership on claim.
    ALTER TABLE staff_invitations
      ADD COLUMN department_ids UUID[] NOT NULL DEFAULT '{}';

    -- Plan §11: nurses and doctors access only their assigned departments.
    -- Empty assignments = unrestricted within the hospital ("all specialties").
    CREATE TABLE membership_departments (
      membership_id UUID NOT NULL REFERENCES hospital_memberships(id) ON DELETE CASCADE,
      department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      PRIMARY KEY (membership_id, department_id)
    );

    CREATE INDEX membership_departments_by_department ON membership_departments (department_id);
  `,
};
