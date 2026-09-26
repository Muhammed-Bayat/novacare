// Source: Healthsites South Africa (OpenStreetMap, ODbL), matched only to public/government facilities.
export const migration = {
  name: '005_import_verified_specialties',
  sql: `
    WITH service_map(hospital_name, services) AS (
      VALUES
        ('Boitumelo Hospital', ARRAY['General Surgery', 'General Medicine', 'Paediatrics', 'Obstetrics and Gynaecology', 'Orthopaedics', 'Ophthalmology', 'Maternity Care', 'Psychiatry']),
        ('Bongani Hospital', ARRAY['Emergency Care', 'Maternity Care', 'Paediatrics', 'Neonatal Intensive Care', 'Intensive Care', 'General Medicine', 'General Surgery', 'Orthopaedics', 'Obstetrics and Gynaecology', 'Burns Care', 'Physiotherapy', 'Occupational Therapy']),
        ('Diamond Diamant Hospital', ARRAY['Emergency Care', 'Maternity Care', 'Chronic Care']),
        ('Elizabeth Ross Hospital', ARRAY['General Medicine', 'General Surgery', 'Paediatrics', 'Maternity Care', 'Reproductive Health', 'Frail Care', 'Rehabilitation', 'Dental Care', 'Mental Health Care', 'Physiotherapy', 'Occupational Therapy']),
        ('Bertha Gxowa Hospital', ARRAY['Emergency Care', 'Paediatrics', 'HIV Prevention', 'Tuberculosis Care', 'Male Circumcision', 'Antenatal Care', 'General Surgery']),
        ('Bheki Mlangeni District Hospital', ARRAY['Paediatrics', 'Psychiatry', 'General Surgery']),
        ('Bronkhorstspruit Hospital', ARRAY['Emergency Care', 'Infectious Diseases', 'Paediatric Surgery', 'Psychiatry', 'Dental Care', 'General Surgery', 'Vaccination']),
        ('Carletonville Hospital', ARRAY['Emergency Care', 'Maternity Care']),
        ('Dr Yusuf Dadoo Hospital', ARRAY['Chronic Care', 'Maternity Care']),
        ('Edenvale Hospital', ARRAY['Chronic Care', 'Maternity Care']),
        ('Kalafong Hospital', ARRAY['Oncology', 'General Surgery', 'Paediatrics']),
        ('Benedictine Hospital', ARRAY['Emergency and Trauma Care', 'Crisis Support', 'Dental Care', 'Dietetics', 'Ophthalmology', 'Family Planning', 'General Medicine', 'General Surgery', 'Intensive Care', 'Maternity Care', 'Neonatal Care', 'Paediatrics']),
        ('Bethesda Hospital', ARRAY['Emergency Care', 'Orthopaedics', 'General Surgery']),
        ('Catherine Booth Hospital', ARRAY['HIV Care', 'Forensic Care', 'Dental Care', 'Dietetics', 'Ophthalmology', 'Family Planning', 'Maternal and Child Health', 'General Medicine', 'General Surgery']),
        ('Ceza Hospital', ARRAY['General Medicine', 'General Surgery', 'Dental Care', 'HIV Care', 'Obstetrics and Gynaecology', 'Paediatrics', 'Emergency Care', 'Chronic Care', 'Geriatrics', 'Forensic Care', 'Mental Health Care', 'Ophthalmology', 'Rehabilitation']),
        ('Church of Scotland Hospital', ARRAY['Chronic Care', 'Emergency and Trauma Care', 'Dental Care', 'General Medicine', 'General Surgery', 'Paediatrics', 'Infectious Diseases', 'Maternity Care']),
        ('Dundee Hospital', ARRAY['Emergency and Trauma Care', 'General Medicine', 'General Surgery', 'Infectious Diseases', 'Maternity Care', 'Orthopaedics', 'Physiotherapy', 'Dental Care', 'Ophthalmology', 'Family Planning', 'Crisis Support']),
        ('East Griqualand and Usher Memorial Hospital', ARRAY['Chronic Care', 'HIV Care', 'Antenatal Care', 'Dental Care', 'Ear, Nose and Throat', 'Ophthalmology', 'General Medicine', 'General Surgery', 'Infectious Diseases', 'Maternity Care', 'Mental Health Care']),
        ('Ekhombe Hospital', ARRAY['Obstetrics and Gynaecology', 'Antenatal Care', 'Infectious Diseases', 'Maternal and Child Health', 'Orthopaedics', 'General Surgery', 'Psychiatry', 'Ophthalmology', 'Chronic Care', 'Postnatal Care']),
        ('Dilokong Hospital', ARRAY['Chronic Care', 'Maternity Care']),
        ('Ellisras Hospital', ARRAY['Maternity Care', 'Paediatrics', 'HIV Care', 'Maternal and Women''s Health']),
        ('Helene Franz Hospital', ARRAY['Maternity Care', 'General Surgery', 'Emergency Care', 'Dental Care']),
        ('Lebowakgomo Hospital', ARRAY['Emergency Care', 'Maternity Care']),
        ('Barberton Hospital', ARRAY['Emergency Care', 'Maternity Care', 'Chronic Care']),
        ('Embhuleni Hospital', ARRAY['Family Medicine', 'Rehabilitation', 'General Medicine', 'General Surgery', 'Obstetrics and Gynaecology', 'Paediatrics', 'Ophthalmology', 'Geriatrics']),
        ('Ermelo Hospital', ARRAY['Family Medicine', 'Rehabilitation', 'General Medicine', 'General Surgery', 'Obstetrics and Gynaecology', 'Paediatrics', 'Ophthalmology', 'Geriatrics']),
        ('Mapulaneng Hospital', ARRAY['Obstetrics and Gynaecology', 'Occupational Therapy', 'Orthopaedics', 'Psychiatry', 'Paediatrics', 'Physiotherapy', 'General Surgery', 'Speech Therapy', 'Neonatal Care', 'Dental Care', 'Ophthalmology']),
        ('Brits Hospital', ARRAY['Emergency Care', 'HIV Care', 'Paediatrics', 'Physiotherapy', 'Social Work', 'Occupational Therapy', 'Speech Therapy', 'Dietetics', 'Dental Care']),
        ('Christiana Hospital', ARRAY['Emergency Care', 'Maternity Care']),
        ('Job Shimankana Tabane Hospital', ARRAY['Intensive Care', 'Obstetrics and Gynaecology', 'Paediatrics']),
        ('Klerksdorp-Tshepong Tertiary Hospital', ARRAY['Chronic Care', 'Maternity Care']),
        ('Koster Hospital', ARRAY['Maternity Care', 'Chronic Care']),
        ('Moses Kotane Hospital', ARRAY['Maternity Care']),
        ('Citrusdal Hospital', ARRAY['Chronic Care']),
        ('George Hospital', ARRAY['Internal Medicine', 'Paediatrics', 'Neonatal Care', 'General Surgery', 'Family Medicine', 'Emergency Care', 'Orthopaedics', 'Anaesthetics', 'Obstetrics and Gynaecology', 'Psychiatry', 'Ophthalmology']),
        ('Helderberg Hospital', ARRAY['Obstetrics and Gynaecology', 'Orthopaedics', 'Ophthalmology', 'General Surgery', 'Paediatrics']),
        ('Khayelitsha Hospital', ARRAY['Emergency Care', 'Maternity Care'])
    )
    INSERT INTO hospital_services (hospital_id, name)
    SELECT h.id, service.name
    FROM service_map sm
    JOIN hospitals h ON h.name = sm.hospital_name
    CROSS JOIN LATERAL unnest(sm.services) AS service(name)
    ON CONFLICT (hospital_id, name) DO NOTHING;
  `,
};
