export const migration = {
  name: '019_dispatcher_invitations',
  sql: `
    -- Dispatchers are invited operational users, not implicit administrators.
    ALTER TABLE staff_invitations
      DROP CONSTRAINT IF EXISTS staff_invitations_role_check;
    ALTER TABLE staff_invitations
      ADD CONSTRAINT staff_invitations_role_check
      CHECK (role IN ('administrator', 'nurse', 'doctor', 'dispatcher'));
  `,
};
