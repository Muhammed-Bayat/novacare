import facilityTypes from '../data/hospital-facility-types.json' with { type: 'json' };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const records = facilityTypes.map((hospital) => `(${sqlText(hospital.name)}, ${sqlText(hospital.province)}, ${sqlText(hospital.facilityType)})`).join(',\n');

// Source: Department of Health, Regulations Relating to Categories of Hospitals, 2011 (docs/DoH_doc.pdf).
export const migration = {
  name: '008_apply_doh_service_packages',
  sql: `
    ALTER TABLE hospitals ADD COLUMN facility_type TEXT;

    WITH source_types(name, province, facility_type) AS (VALUES
      ${records}
    )
    UPDATE hospitals h SET facility_type = source.facility_type
    FROM source_types source
    WHERE h.name = source.name AND h.province = source.province;

    WITH packages(facility_type, services) AS (
      VALUES
        ('District Hospital', ARRAY['General consultation', 'Emergency Care', 'Paediatrics', 'Obstetrics and Gynaecology', 'Internal Medicine', 'General Surgery']),
        ('Regional Hospital', ARRAY['General consultation', 'Internal Medicine', 'Paediatrics', 'Obstetrics and Gynaecology', 'General Surgery', 'Orthopaedics', 'Psychiatry', 'Anaesthetics', 'Diagnostic Radiology', 'Trauma and Emergency Services', 'Critical Care']),
        ('Provincial Tertiary Hospital', ARRAY['General consultation', 'Internal Medicine', 'Paediatrics', 'Obstetrics and Gynaecology', 'General Surgery', 'Orthopaedics', 'Psychiatry', 'Anaesthetics', 'Diagnostic Radiology', 'Trauma and Emergency Services', 'Critical Care', 'Intensive Care', 'Subspecialty Services']),
        ('National Central Hospital', ARRAY['General consultation', 'Internal Medicine', 'Paediatrics', 'Obstetrics and Gynaecology', 'General Surgery', 'Orthopaedics', 'Psychiatry', 'Anaesthetics', 'Diagnostic Radiology', 'Trauma and Emergency Services', 'Critical Care', 'Intensive Care', 'Subspecialty Services', 'Central Referral Services', 'National Referral Services', 'Heart and Lung Transplant', 'Bone Marrow Transplant', 'Liver Transplant', 'Cochlear Implants'])
    )
    INSERT INTO hospital_services (hospital_id, name)
    SELECT h.id, service.name
    FROM hospitals h
    JOIN packages package ON package.facility_type = h.facility_type
    CROSS JOIN LATERAL unnest(package.services) AS service(name)
    WHERE h.active
    ON CONFLICT (hospital_id, name) DO NOTHING;
  `,
};
