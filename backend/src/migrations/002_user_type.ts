export const migration = {
  name: '002_user_type',
  sql: `
    ALTER TABLE users
      ADD COLUMN user_type TEXT NOT NULL DEFAULT 'patient'
      CONSTRAINT users_user_type_check CHECK (user_type IN ('patient', 'staff', 'admin'));
  `,
};
