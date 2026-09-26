export const migration = {
  name: '011_staff_roles',
  sql: `
    CREATE TABLE platform_operators (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE hospital_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      hospital_id UUID NOT NULL REFERENCES hospitals(id), role TEXT NOT NULL CHECK (role IN ('administrator', 'nurse', 'doctor')),
      active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (user_id, hospital_id)
    );
    CREATE TABLE staff_invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), hospital_id UUID NOT NULL REFERENCES hospitals(id), email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('administrator', 'nurse', 'doctor')), invited_by UUID NOT NULL REFERENCES users(id),
      claimed_by UUID REFERENCES users(id), claimed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (hospital_id, email, role)
    );
    INSERT INTO platform_operators (user_id)
    SELECT id FROM users WHERE lower(email) = '2811604@students.wits.ac.za'
    ON CONFLICT DO NOTHING;
  `,
};
