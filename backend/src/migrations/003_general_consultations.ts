export const migration = {
  name: '003_general_consultations',
  sql: `
    INSERT INTO hospital_services (hospital_id, name)
    SELECT id, 'General consultation'
    FROM hospitals
    ON CONFLICT (hospital_id, name) DO NOTHING;
  `,
};
