// Sources: Wits clinical department facility pages and UFS School of Medicine clinical-platform page.
export const migration = {
  name: '007_correct_major_hospital_services',
  sql: `
    WITH service_map(hospital_name, services) AS (
      VALUES
        ('Helen Joseph Hospital', ARRAY['Orthopaedics']),
        ('Rahima Moosa Hospital', ARRAY['Paediatrics']),
        ('Nelson Mandela Academic Hospital', ARRAY['Gastrointestinal Endoscopy', 'Breast Diagnostics']),
        ('Frere Hospital', ARRAY['Theatre Services']),
        ('Universitas Academic Hospital', ARRAY['Anaesthetics', 'Cardiothoracic Surgery', 'Critical Care', 'Dermatology', 'Diagnostic Radiology', 'Internal Medicine', 'Neurology', 'Neurosurgery', 'Nuclear Medicine', 'Obstetrics and Gynaecology', 'Ophthalmology', 'Otorhinolaryngology', 'Paediatrics', 'Plastic Surgery', 'Psychiatry', 'General Surgery']),
        ('Pelonomi Hospital', ARRAY['Anaesthetics', 'Cardiology', 'Cardiothoracic Surgery', 'Critical Care', 'Dermatology', 'Diagnostic Radiology', 'Internal Medicine', 'Neurology', 'Neurosurgery', 'Nuclear Medicine', 'Ophthalmology', 'Otorhinolaryngology', 'Paediatrics', 'Plastic Surgery', 'Psychiatry', 'Urology'])
    )
    INSERT INTO hospital_services (hospital_id, name)
    SELECT h.id, service.name
    FROM service_map sm
    JOIN hospitals h ON h.name = sm.hospital_name
    CROSS JOIN LATERAL unnest(sm.services) AS service(name)
    ON CONFLICT (hospital_id, name) DO NOTHING;

    -- These shorter names duplicate the active academic-hospital records above.
    UPDATE hospitals SET active = false
    WHERE name IN ('Charlotte Maxeke Hospital', 'Universitas C Hospital');
  `,
};
