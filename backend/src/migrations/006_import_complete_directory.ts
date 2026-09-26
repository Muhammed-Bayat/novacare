import hospitals from '../data/full-hospital-import.json' with { type: 'json' };

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const records = hospitals.map((hospital) => `(${sqlText(hospital.name)}, ${sqlText(hospital.province)}, ${sqlText(hospital.address)}, ${hospital.latitude}, ${hospital.longitude}, ARRAY[${hospital.services.map(sqlText).join(', ')}])`).join(',\n');

// The MFL identity/location layer is CC0. Services come from matched public/government Healthsites records (ODbL).
export const migration = {
  name: '006_import_complete_directory',
  sql: `
    WITH source_hospitals(name, province, address, latitude, longitude, services) AS (VALUES
      ${records}
    )
    INSERT INTO hospitals (name, province, address, latitude, longitude)
    SELECT name, province, address, latitude, longitude FROM source_hospitals
    ON CONFLICT (name, address) DO NOTHING;

    WITH source_hospitals(name, province, address, latitude, longitude, services) AS (VALUES
      ${records}
    )
    INSERT INTO hospital_services (hospital_id, name)
    SELECT h.id, service.name
    FROM source_hospitals source
    JOIN hospitals h ON h.name = source.name AND h.province = source.province
    CROSS JOIN LATERAL unnest(source.services) AS service(name)
    ON CONFLICT (hospital_id, name) DO NOTHING;
  `,
};
