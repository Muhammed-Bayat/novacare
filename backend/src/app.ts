import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { requireAuth } from './auth.js';
import { getPool } from './db.js';

type UserRow = { id: string; auth0_subject: string; email: string | null; display_name: string | null };

function isBookingTime(date: string, time: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)
    && date >= new Date().toISOString().slice(0, 10) && time >= '07:00' && time < '19:00';
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return value.map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

async function synchronizeUser(subject: string, email: string | null, displayName: string | null): Promise<UserRow> {
  const result = await getPool().query<UserRow>(
    `INSERT INTO users (auth0_subject, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (auth0_subject) DO UPDATE
     SET email = COALESCE(EXCLUDED.email, users.email),
         display_name = COALESCE(EXCLUDED.display_name, users.display_name),
         updated_at = now()
     RETURNING id, auth0_subject, email, display_name`,
    [subject, email, displayName],
  );
  return result.rows[0]!;
}

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp() {
  const app = express();
  const origins = allowedOrigins();

  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
  }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/v1/me', requireAuth, async (req, res, next) => {
    try {
      const auth = req.auth!;
      const user = await synchronizeUser(auth.subject, auth.email, auth.displayName);
      await getPool().query(
        `UPDATE staff_invitations SET claimed_by = $1, claimed_at = now()
         WHERE lower(email) = lower($2::text) AND claimed_by IS NULL`, [user.id, user.email],
      );
      await getPool().query(
        `INSERT INTO hospital_memberships (user_id, hospital_id, role)
         SELECT $1, hospital_id, role FROM staff_invitations WHERE claimed_by = $1
         ON CONFLICT (user_id) DO NOTHING`, [user.id],
      );
      const roles = await getPool().query<{ operator: boolean; role: string | null; hospital_id: string | null }>(
        `SELECT EXISTS(SELECT 1 FROM platform_operators WHERE user_id = $1) AS operator,
                (SELECT role FROM hospital_memberships WHERE user_id = $1 AND active) AS role,
                (SELECT hospital_id FROM hospital_memberships WHERE user_id = $1 AND active) AS hospital_id`, [user.id],
      );
      const access = roles.rows[0]!;
      const userType = await getPool().query<{ user_type: string }>('SELECT user_type FROM users WHERE id = $1', [user.id]);
      res.json({ data: { id: user.id, auth0Subject: user.auth0_subject, email: user.email, displayName: user.display_name, userType: userType.rows[0]?.user_type ?? 'patient', isPlatformOperator: access.operator, staffRole: access.role, hospitalId: access.hospital_id } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/hospitals', requireAuth, async (req, res, next) => {
    try {
      const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
      const area = typeof req.query.area === 'string' ? req.query.area.trim() : '';
      const service = typeof req.query.service === 'string' ? req.query.service.trim() : '';
      const result = await getPool().query<{
        id: string; name: string; province: string; address: string; latitude: number; longitude: number; facility_type: string | null;
        service_id: string; service_name: string;
      }>(
        `SELECT h.id, h.name, h.province, h.address, h.latitude, h.longitude, h.facility_type,
                hs.id AS service_id, hs.name AS service_name
         FROM hospitals h
         JOIN hospital_services hs ON hs.hospital_id = h.id AND hs.active
         WHERE h.active AND ($1 = '' OR h.name ILIKE '%' || $1 || '%')
           AND ($2 = '' OR h.province ILIKE '%' || $2 || '%' OR h.address ILIKE '%' || $2 || '%')
           AND ($3 = '' OR EXISTS (
             SELECT 1 FROM hospital_services matching_service
             WHERE matching_service.hospital_id = h.id AND matching_service.active AND matching_service.name ILIKE '%' || $3 || '%'
           ))
         ORDER BY h.name, hs.name`,
        [name, area, service],
      );
      const hospitals = new Map<string, { id: string; name: string; province: string; address: string; latitude: number; longitude: number; facilityType: string | null; services: { id: string; name: string }[] }>();
      for (const row of result.rows) {
        const hospital = hospitals.get(row.id) ?? { id: row.id, name: row.name, province: row.province, address: row.address, latitude: row.latitude, longitude: row.longitude, facilityType: row.facility_type, services: [] };
        hospital.services.push({ id: row.service_id, name: row.service_name });
        hospitals.set(row.id, hospital);
      }
      res.json({ data: [...hospitals.values()] });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/overseer/administrators', requireAuth, async (req, res, next) => {
    try {
      const operator = await getPool().query('SELECT 1 FROM platform_operators p JOIN users u ON u.id = p.user_id WHERE u.auth0_subject = $1', [req.auth!.subject]);
      if (!operator.rowCount) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Platform overseer access is required.' } }); return; }
      const { hospitalId, email } = req.body as { hospitalId?: unknown; email?: unknown };
      if (typeof hospitalId !== 'string' || typeof email !== 'string' || !email.includes('@')) { res.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'Choose a hospital and valid administrator email.' } }); return; }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      await getPool().query(`INSERT INTO staff_invitations (hospital_id, email, role, invited_by) VALUES ($1, lower($2), 'administrator', $3) ON CONFLICT (hospital_id, email, role) DO UPDATE SET invited_by = EXCLUDED.invited_by`, [hospitalId, email, user.id]);
      res.status(201).json({ data: { message: 'Administrator invitation created. It is claimed when that user signs in.' } });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/admin/staff', requireAuth, async (req, res, next) => {
    try {
      const membership = await getPool().query<{ hospital_id: string }>(`SELECT hm.hospital_id FROM hospital_memberships hm JOIN users u ON u.id = hm.user_id WHERE u.auth0_subject = $1 AND hm.role = 'administrator' AND hm.active`, [req.auth!.subject]);
      const hospitalId = membership.rows[0]?.hospital_id;
      const { email, role } = req.body as { email?: unknown; role?: unknown };
      if (!hospitalId || typeof email !== 'string' || !email.includes('@') || (role !== 'nurse' && role !== 'doctor')) { res.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'Choose a valid nurse or doctor email.' } }); return; }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      await getPool().query(`INSERT INTO staff_invitations (hospital_id, email, role, invited_by) VALUES ($1, lower($2), $3, $4) ON CONFLICT (hospital_id, email, role) DO UPDATE SET invited_by = EXCLUDED.invited_by`, [hospitalId, email, role, user.id]);
      res.status(201).json({ data: { message: `${role === 'nurse' ? 'Nurse' : 'Doctor'} invitation created.` } });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/appointments', requireAuth, async (req, res, next) => {
    try {
      const result = await getPool().query<{
        id: string; appointment_date: string; appointment_time: string; status: string; hospital_id: string; service_id: string; hospital_name: string; service_name: string; address: string;
      }>(
        `SELECT a.id, a.appointment_date, a.appointment_time, a.status, a.hospital_id, a.hospital_service_id AS service_id, h.name AS hospital_name, hs.name AS service_name, h.address
         FROM appointments a
         JOIN users u ON u.id = a.user_id
         JOIN hospitals h ON h.id = a.hospital_id
         JOIN hospital_services hs ON hs.id = a.hospital_service_id
         WHERE u.auth0_subject = $1 AND (a.status = 'cancelled' OR (a.status = 'booked' AND a.appointment_date >= CURRENT_DATE))
         ORDER BY a.status, a.appointment_date, a.appointment_time`,
        [req.auth!.subject],
      );
      res.json({ data: result.rows.map((row) => ({ id: row.id, hospitalId: row.hospital_id, serviceId: row.service_id, date: row.appointment_date, time: row.appointment_time.slice(0, 5), status: row.status, hospitalName: row.hospital_name, serviceName: row.service_name, address: row.address })) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/appointments', requireAuth, async (req, res, next) => {
    try {
      const { hospitalId, serviceId, date, time } = req.body as { hospitalId?: unknown; serviceId?: unknown; date?: unknown; time?: unknown };
      if (typeof hospitalId !== 'string' || typeof serviceId !== 'string' || typeof date !== 'string' || typeof time !== 'string') {
        res.status(400).json({ error: { code: 'INVALID_BOOKING', message: 'Choose a hospital, service, date, and time.' } });
        return;
      }
      if (!isBookingTime(date, time)) {
        res.status(400).json({ error: { code: 'INVALID_BOOKING_TIME', message: 'Bookings are available from 07:00 to 19:00 on future dates.' } });
        return;
      }
      const service = await getPool().query('SELECT 1 FROM hospital_services WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, hospitalId]);
      if (!service.rowCount) {
        res.status(400).json({ error: { code: 'INVALID_SERVICE', message: 'That service is not available at the selected hospital.' } });
        return;
      }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const result = await getPool().query<{ id: string }>(
        `INSERT INTO appointments (user_id, hospital_id, hospital_service_id, appointment_date, appointment_time)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [user.id, hospitalId, serviceId, date, time],
      );
      res.status(201).json({ data: { id: result.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v1/appointments/:id', requireAuth, async (req, res, next) => {
    try {
      const { serviceId, date, time } = req.body as { serviceId?: unknown; date?: unknown; time?: unknown };
      if (typeof serviceId !== 'string' || typeof date !== 'string' || typeof time !== 'string' || !isBookingTime(date, time)) {
        res.status(400).json({ error: { code: 'INVALID_BOOKING', message: 'Choose an available service, future date, and time between 07:00 and 19:00.' } });
        return;
      }
      const result = await getPool().query<{ id: string }>(
        `UPDATE appointments a SET hospital_service_id = $1, appointment_date = $2, appointment_time = $3
         FROM users u
         WHERE a.id = $4 AND a.user_id = u.id AND u.auth0_subject = $5 AND a.status = 'booked'
           AND EXISTS (SELECT 1 FROM hospital_services hs WHERE hs.id = $1 AND hs.hospital_id = a.hospital_id AND hs.active)
         RETURNING a.id`,
        [serviceId, date, time, req.params.id, req.auth!.subject],
      );
      if (!result.rowCount) {
        res.status(404).json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'That active appointment was not found.' } });
        return;
      }
      res.json({ data: { id: result.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/v1/appointments/:id', requireAuth, async (req, res, next) => {
    try {
      const result = await getPool().query<{ id: string }>(
        `UPDATE appointments a SET status = 'cancelled'
         FROM users u
         WHERE a.id = $1 AND a.user_id = u.id AND u.auth0_subject = $2 AND a.status = 'booked'
         RETURNING a.id`,
        [req.params.id, req.auth!.subject],
      );
      if (!result.rowCount) {
        res.status(404).json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'That active appointment was not found.' } });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/appointments/:id/rebook', requireAuth, async (req, res, next) => {
    try {
      const { serviceId, date, time } = req.body as { serviceId?: unknown; date?: unknown; time?: unknown };
      if (typeof serviceId !== 'string' || typeof date !== 'string' || typeof time !== 'string' || !isBookingTime(date, time)) {
        res.status(400).json({ error: { code: 'INVALID_BOOKING', message: 'Choose an available service, future date, and time between 07:00 and 19:00.' } });
        return;
      }
      const result = await getPool().query<{ id: string }>(
        `UPDATE appointments a SET hospital_service_id = $1, appointment_date = $2, appointment_time = $3, status = 'booked'
         FROM users u
         WHERE a.id = $4 AND a.user_id = u.id AND u.auth0_subject = $5 AND a.status = 'cancelled'
           AND EXISTS (SELECT 1 FROM hospital_services hs WHERE hs.id = $1 AND hs.hospital_id = a.hospital_id AND hs.active)
         RETURNING a.id`,
        [serviceId, date, time, req.params.id, req.auth!.subject],
      );
      if (!result.rowCount) {
        res.status(404).json({ error: { code: 'APPOINTMENT_NOT_FOUND', message: 'That cancelled appointment was not found.' } });
        return;
      }
      res.json({ data: { id: result.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/queue', requireAuth, async (req, res, next) => {
    try {
      const result = await getPool().query<{
        id: string; status: string; hospital_name: string; service_name: string; address: string; joined_at: string; position: string;
      }>(
        `SELECT q.id, q.status, h.name AS hospital_name, hs.name AS service_name, h.address, q.joined_at,
                (SELECT count(*) FROM queue_entries ahead
                 WHERE ahead.hospital_service_id = q.hospital_service_id AND ahead.queue_date = q.queue_date
                   AND ahead.status = 'waiting' AND ahead.joined_at <= q.joined_at) AS position
         FROM queue_entries q
         JOIN users u ON u.id = q.user_id
         JOIN hospitals h ON h.id = q.hospital_id
         JOIN hospital_services hs ON hs.id = q.hospital_service_id
         WHERE u.auth0_subject = $1 AND q.queue_date = CURRENT_DATE AND q.status IN ('waiting', 'called')
         ORDER BY q.joined_at`,
        [req.auth!.subject],
      );
      res.json({ data: result.rows.map((row) => ({ id: row.id, status: row.status, hospitalName: row.hospital_name, serviceName: row.service_name, address: row.address, joinedAt: row.joined_at, position: Number(row.position), estimatedWaitMinutes: Math.max(0, Number(row.position) - 1) * 15 })) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/profile', requireAuth, async (req, res, next) => {
    try {
      const profileResult = await getPool().query<{
        id: string; phone: string | null; date_of_birth: string | null; home_address: string | null; emergency_contact_name: string | null; emergency_contact_phone: string | null; chronic_conditions: string[]; allergies: string[]; medications: string[]; blood_type: string | null; access_needs: string | null; health_notes: string | null; health_data_consent: boolean;
      }>(
        `SELECT p.id, p.phone, p.date_of_birth, p.home_address, p.emergency_contact_name, p.emergency_contact_phone,
                p.chronic_conditions, p.allergies, p.medications, p.blood_type, p.access_needs, p.health_notes, p.health_data_consent
         FROM patient_profiles p JOIN users u ON u.id = p.user_id WHERE u.auth0_subject = $1`,
        [req.auth!.subject],
      );
      const profile = profileResult.rows[0];
      if (!profile) {
        res.json({ data: { profile: null, diagnoses: [] } });
        return;
      }
      const diagnosesResult = await getPool().query<{ id: string; diagnosis: string; diagnosed_on: string; clinician_name: string | null; notes: string | null }>(
        `SELECT id, diagnosis, diagnosed_on, clinician_name, notes FROM clinical_diagnoses WHERE patient_profile_id = $1 ORDER BY diagnosed_on DESC`,
        [profile.id],
      );
      res.json({ data: { profile: { phone: profile.phone, dateOfBirth: profile.date_of_birth, homeAddress: profile.home_address, emergencyContactName: profile.emergency_contact_name, emergencyContactPhone: profile.emergency_contact_phone, chronicConditions: profile.chronic_conditions, allergies: profile.allergies, medications: profile.medications, bloodType: profile.blood_type, accessNeeds: profile.access_needs, healthNotes: profile.health_notes, healthDataConsent: profile.health_data_consent }, diagnoses: diagnosesResult.rows.map((item) => ({ id: item.id, diagnosis: item.diagnosis, diagnosedOn: item.diagnosed_on, clinicianName: item.clinician_name, notes: item.notes })) } });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/v1/profile', requireAuth, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const chronicConditions = textList(body.chronicConditions);
      const allergies = textList(body.allergies);
      const medications = textList(body.medications);
      if (!chronicConditions || !allergies || !medications || typeof body.healthDataConsent !== 'boolean') {
        res.status(400).json({ error: { code: 'INVALID_PROFILE', message: 'Please provide valid health-profile details and consent.' } });
        return;
      }
      const strings = ['phone', 'dateOfBirth', 'homeAddress', 'emergencyContactName', 'emergencyContactPhone', 'bloodType', 'accessNeeds', 'healthNotes'] as const;
      if (strings.some((key) => body[key] !== null && body[key] !== undefined && typeof body[key] !== 'string')) {
        res.status(400).json({ error: { code: 'INVALID_PROFILE', message: 'Profile text fields must be valid text.' } });
        return;
      }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      await getPool().query(
        `INSERT INTO patient_profiles (user_id, phone, date_of_birth, home_address, emergency_contact_name, emergency_contact_phone, chronic_conditions, allergies, medications, blood_type, access_needs, health_notes, health_data_consent, consented_at)
         VALUES ($1, $2, NULLIF($3, '')::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $13 THEN now() ELSE NULL END)
         ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone, date_of_birth = EXCLUDED.date_of_birth, home_address = EXCLUDED.home_address, emergency_contact_name = EXCLUDED.emergency_contact_name, emergency_contact_phone = EXCLUDED.emergency_contact_phone, chronic_conditions = EXCLUDED.chronic_conditions, allergies = EXCLUDED.allergies, medications = EXCLUDED.medications, blood_type = EXCLUDED.blood_type, access_needs = EXCLUDED.access_needs, health_notes = EXCLUDED.health_notes, health_data_consent = EXCLUDED.health_data_consent, consented_at = CASE WHEN EXCLUDED.health_data_consent THEN COALESCE(patient_profiles.consented_at, now()) ELSE NULL END, updated_at = now()`,
        [user.id, body.phone ?? null, body.dateOfBirth ?? '', body.homeAddress ?? null, body.emergencyContactName ?? null, body.emergencyContactPhone ?? null, chronicConditions, allergies, medications, body.bloodType ?? null, body.accessNeeds ?? null, body.healthNotes ?? null, body.healthDataConsent],
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/queue', requireAuth, async (req, res, next) => {
    try {
      const { hospitalId, serviceId } = req.body as { hospitalId?: unknown; serviceId?: unknown };
      if (typeof hospitalId !== 'string' || typeof serviceId !== 'string') {
        res.status(400).json({ error: { code: 'INVALID_QUEUE', message: 'Choose a hospital and service to join the queue.' } });
        return;
      }
      const service = await getPool().query('SELECT 1 FROM hospital_services WHERE id = $1 AND hospital_id = $2 AND active', [serviceId, hospitalId]);
      if (!service.rowCount) {
        res.status(400).json({ error: { code: 'INVALID_SERVICE', message: 'That service is not available at the selected hospital.' } });
        return;
      }
      const user = await synchronizeUser(req.auth!.subject, req.auth!.email, req.auth!.displayName);
      const result = await getPool().query<{ id: string }>(
        `INSERT INTO queue_entries (user_id, hospital_id, hospital_service_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [user.id, hospitalId, serviceId],
      );
      res.status(201).json({ data: { id: result.rows[0]!.id } });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/v1/queue/:id', requireAuth, async (req, res, next) => {
    try {
      const result = await getPool().query<{ id: string }>(
        `UPDATE queue_entries q SET status = 'cancelled', updated_at = now()
         FROM users u
         WHERE q.id = $1 AND q.user_id = u.id AND u.auth0_subject = $2
           AND q.queue_date = CURRENT_DATE AND q.status = 'waiting'
         RETURNING q.id`,
        [req.params.id, req.auth!.subject],
      );
      if (!result.rowCount) {
        res.status(404).json({ error: { code: 'QUEUE_ENTRY_NOT_FOUND', message: 'That active queue entry was not found.' } });
        return;
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/sample', requireAuth, async (req, res, next) => {
    try {
      const existing = await getPool().query('SELECT 1 FROM users WHERE auth0_subject = $1', [req.auth!.subject]);
      if (!existing.rowCount) {
        res.status(403).json({ error: { code: 'USER_NOT_SYNCHRONIZED', message: 'Call /api/v1/me first' } });
        return;
      }
      res.json({ data: { message: 'Your protected NovaCare API connection is active.' } });
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
    console.error(error);
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'appointments_booked_service_slot_key') {
      res.status(409).json({ error: { code: 'SLOT_UNAVAILABLE', message: 'This appointment slot is no longer available. Please choose another time.' } });
      return;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'queue_entries_one_active_service_per_day') {
      res.status(409).json({ error: { code: 'ALREADY_IN_QUEUE', message: 'You are already in this service queue today.' } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  return app;
}
