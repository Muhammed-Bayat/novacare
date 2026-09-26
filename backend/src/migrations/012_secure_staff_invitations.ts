export const migration = {
  name: '012_secure_staff_invitations',
  sql: `
    ALTER TABLE staff_invitations
      ADD COLUMN token_hash TEXT,
      ADD COLUMN expires_at TIMESTAMPTZ,
      ADD COLUMN sent_at TIMESTAMPTZ;

    CREATE UNIQUE INDEX staff_invitations_token_hash_key
      ON staff_invitations (token_hash)
      WHERE token_hash IS NOT NULL;
  `,
};
