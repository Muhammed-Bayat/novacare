export const migration = {
  name: '002_booking_directory',
  sql: `
    CREATE TABLE hospitals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      province TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      UNIQUE (name, address)
    );

    CREATE TABLE hospital_services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      UNIQUE (hospital_id, name)
    );

    CREATE TABLE appointments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hospital_id UUID NOT NULL REFERENCES hospitals(id),
      hospital_service_id UUID NOT NULL REFERENCES hospital_services(id),
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (appointment_time >= TIME '07:00' AND appointment_time < TIME '19:00')
    );

    CREATE INDEX appointments_upcoming_by_user ON appointments (user_id, appointment_date, appointment_time)
      WHERE status = 'booked';

    INSERT INTO hospitals (name, province, address, latitude, longitude) VALUES
      ('Chris Hani Baragwanath Academic Hospital', 'Gauteng', '26 Chris Hani Road, Diepkloof, Soweto, 1864', -26.2617, 27.9428),
      ('Charlotte Maxeke Johannesburg Academic Hospital', 'Gauteng', '17 Jubilee Road, Parktown, Johannesburg, 2193', -26.1815, 28.0283),
      ('Steve Biko Academic Hospital', 'Gauteng', 'Steve Biko Road, Capital Park, Pretoria, 0001', -25.7307, 28.1979),
      ('Groote Schuur Hospital', 'Western Cape', 'Main Road, Observatory, Cape Town, 7925', -33.9401, 18.4628),
      ('Tygerberg Hospital', 'Western Cape', 'Francie van Zyl Drive, Parow Valley, Cape Town, 7505', -33.9128, 18.5974),
      ('King Edward VIII Hospital', 'KwaZulu-Natal', 'Sydney Road, Umbilo, Durban, 4001', -29.9027, 30.9991),
      ('Livingstone Hospital', 'Eastern Cape', 'Stanford Road, Korsten, Gqeberha, 6020', -33.9368, 25.5688),
      ('Universitas Academic Hospital', 'Free State', '1 Logeman Street, Universitas, Bloemfontein, 9321', -29.1237, 26.1596);

    INSERT INTO hospital_services (hospital_id, name)
    SELECT h.id, service.name
    FROM hospitals h
    JOIN (VALUES
      ('Chris Hani Baragwanath Academic Hospital', 'Cardiology'),
      ('Chris Hani Baragwanath Academic Hospital', 'Endocrinology'),
      ('Chris Hani Baragwanath Academic Hospital', 'Obstetrics and Gynaecology'),
      ('Chris Hani Baragwanath Academic Hospital', 'Orthopaedics'),
      ('Chris Hani Baragwanath Academic Hospital', 'Paediatrics'),
      ('Chris Hani Baragwanath Academic Hospital', 'Psychiatry'),
      ('Charlotte Maxeke Johannesburg Academic Hospital', 'Cardiology'),
      ('Charlotte Maxeke Johannesburg Academic Hospital', 'Neurology'),
      ('Charlotte Maxeke Johannesburg Academic Hospital', 'Oncology'),
      ('Charlotte Maxeke Johannesburg Academic Hospital', 'Obstetrics and Gynaecology'),
      ('Charlotte Maxeke Johannesburg Academic Hospital', 'Urology'),
      ('Steve Biko Academic Hospital', 'Cardiology'),
      ('Steve Biko Academic Hospital', 'Gastroenterology'),
      ('Steve Biko Academic Hospital', 'General Surgery'),
      ('Steve Biko Academic Hospital', 'Nephrology'),
      ('Steve Biko Academic Hospital', 'Paediatrics'),
      ('Groote Schuur Hospital', 'Cardiology'),
      ('Groote Schuur Hospital', 'Endocrinology'),
      ('Groote Schuur Hospital', 'General Surgery'),
      ('Groote Schuur Hospital', 'Oncology'),
      ('Groote Schuur Hospital', 'Obstetrics and Gynaecology'),
      ('Tygerberg Hospital', 'Cardiology'),
      ('Tygerberg Hospital', 'Gastroenterology'),
      ('Tygerberg Hospital', 'Neurology'),
      ('Tygerberg Hospital', 'Paediatrics'),
      ('King Edward VIII Hospital', 'General Surgery'),
      ('King Edward VIII Hospital', 'Obstetrics and Gynaecology'),
      ('King Edward VIII Hospital', 'Orthopaedics'),
      ('King Edward VIII Hospital', 'Psychiatry'),
      ('Livingstone Hospital', 'Emergency Care'),
      ('Livingstone Hospital', 'General Medicine'),
      ('Livingstone Hospital', 'Obstetrics and Gynaecology'),
      ('Livingstone Hospital', 'Paediatrics'),
      ('Universitas Academic Hospital', 'Cardiology'),
      ('Universitas Academic Hospital', 'Oncology'),
      ('Universitas Academic Hospital', 'Orthopaedics'),
      ('Universitas Academic Hospital', 'Urology')
    ) AS service(hospital_name, name) ON service.hospital_name = h.name;
  `,
};
