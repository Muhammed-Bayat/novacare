export const migration = {
  name: '015_appointment_checkedin_status',
  sql: `
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
    ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
      CHECK (status IN ('booked', 'cancelled', 'checked_in'));
  `,
};
