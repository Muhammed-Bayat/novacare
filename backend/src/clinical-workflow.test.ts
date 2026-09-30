import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('./auth.js', () => ({
  requireAuth: (req: { auth?: unknown }, _res: unknown, next: () => void) => {
    req.auth = { subject: 'auth0|clinician', email: 'doctor@example.com', displayName: 'Dr Amina' };
    next();
  },
}));

vi.mock('./db.js', () => ({
  getPool: () => database,
}));

import { createApp } from './app.js';

function membership(role: 'administrator' | 'nurse' | 'doctor') {
  database.query.mockResolvedValueOnce({ rows: role === 'administrator' ? [] : [{ user_id: 'staff-1', hospital_id: 'hospital-1', role }], rowCount: role === 'administrator' ? 0 : 1 });
}

describe('clinical queue workflow', () => {
  beforeEach(() => {
    database.query.mockReset();
    database.connect.mockReset();
  });

  it('denies administrators access to clinical queues', async () => {
    membership('administrator');
    const response = await request(createApp()).get('/api/v1/staff/queue');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('reports transient database outages without a generic internal error', async () => {
    database.query.mockRejectedValueOnce(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' }));

    const response = await request(createApp()).get('/api/v1/staff/queue');

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'DATABASE_UNAVAILABLE',
      message: 'The database is temporarily unavailable. NovaCare will retry shortly.',
    });
  });

  it('requires a diagnosis before a doctor can complete a consultation', async () => {
    membership('doctor');
    const response = await request(createApp()).post('/api/v1/staff/queue/queue-1/complete').send({ notes: 'Follow up next week' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DIAGNOSIS_REQUIRED');
    expect(database.connect).not.toHaveBeenCalled();
  });

  it('records a diagnosis, audit event, and completion in one transaction', async () => {
    membership('doctor');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'queue-1', user_id: 'patient-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 'profile-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 'diagnosis-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    database.connect.mockResolvedValueOnce(client);

    const response = await request(createApp()).post('/api/v1/staff/queue/queue-1/complete').send({ diagnosis: 'Acute bronchitis', notes: 'Rest and hydrate.' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: 'queue-1', status: 'completed', diagnosisId: 'diagnosis-1' });
    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('INSERT INTO patient_profiles'),
      expect.stringContaining('INSERT INTO clinical_diagnoses'),
      expect.stringContaining("status = 'completed'"),
      expect.stringContaining('INSERT INTO audit_events'),
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back completion when diagnosis persistence fails', async () => {
    membership('doctor');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'queue-1', user_id: 'patient-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 'profile-1' }], rowCount: 1 })
        .mockRejectedValueOnce(new Error('database write failed'))
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    database.connect.mockResolvedValueOnce(client);

    const response = await request(createApp()).post('/api/v1/staff/queue/queue-1/complete').send({ diagnosis: 'Acute bronchitis' });

    expect(response.status).toBe(500);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('returns a clear conflict for duplicate active queue joins', async () => {
    database.query
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'patient-1', auth0_subject: 'auth0|clinician', email: 'doctor@example.com', display_name: 'Dr Amina' }], rowCount: 1 })
      .mockRejectedValueOnce({ code: '23505', constraint: 'queue_entries_one_active_service_per_day' });

    const response = await request(createApp()).post('/api/v1/queue').send({ hospitalId: 'hospital-1', serviceId: 'service-1' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_IN_QUEUE');
  });

  it('does not revive an entry cancelled while triage was being confirmed', async () => {
    membership('nurse');
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'queue-1', hospital_service_id: 'service-1', triage_urgency: 'routine' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await request(createApp()).post('/api/v1/staff/triage/queue-1/confirm').send({ category: 'routine' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ENTRY_NOT_AWAITING_TRIAGE');
    expect(String(database.query.mock.calls[2]![0])).toContain("status = 'awaiting_triage'");
  });

  it('shows AI red flags to nurses without using them to reorder unconfirmed triage', async () => {
    membership('nurse');
    database.query.mockResolvedValueOnce({
      rows: [{
        id: 'queue-1', joined_at: '2026-09-30T08:00:00.000Z', appointment_time: null, from_booking: false,
        service_id: 'service-1', service_name: 'General Medicine', patient_name: 'Patient One', patient_email: null,
        triage_urgency: 'emergency', triage_pathway: 'Chest pain', triage_department: 'Emergency Department',
        triage_summary: 'Chest pain at rest', triage_red_flags: ['Chest pain at rest'],
      }],
      rowCount: 1,
    });

    const response = await request(createApp()).get('/api/v1/staff/triage');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ critical: true, triageSummary: { urgency: 'emergency' } });
    const sql = String(database.query.mock.calls[1]![0]);
    expect(sql).toContain('ORDER BY q.joined_at');
    expect(sql).not.toContain('CASE q.triage_urgency');
  });

  it('lists current and upcoming hospital bookings for clinical staff', async () => {
    membership('doctor');
    database.query.mockResolvedValueOnce({
      rows: [{
        id: 'appointment-1', appointment_date: new Date(2026, 9, 2), appointment_time: '09:30:00', status: 'booked', is_today: false,
        service_id: 'service-1', service_name: 'General Medicine', patient_name: 'Patient One', patient_email: 'patient@example.com',
        queue_status: null,
      }],
      rowCount: 1,
    });

    const response = await request(createApp()).get('/api/v1/staff/appointments');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{
      id: 'appointment-1', patientName: 'Patient One', patientEmail: 'patient@example.com', serviceId: 'service-1',
      serviceName: 'General Medicine', date: '2026-10-02', time: '09:30', status: 'booked', isToday: false, queueStatus: null,
    }]);
    const sql = String(database.query.mock.calls[1]![0]);
    expect(sql).toContain('a.hospital_id = $1');
    expect(sql).toContain("a.status = 'booked'");
    expect(sql).not.toContain("a.status = 'cancelled'");
  });

  it('checks a routine booking directly into the live queue in one transaction', async () => {
    membership('nurse');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{
          id: 'appointment-1', user_id: 'patient-1', status: 'booked', is_today: true, hospital_id: 'hospital-1',
          hospital_service_id: 'service-1', triage_urgency: 'routine', triage_pathway: 'General', triage_department: 'General Medicine',
          triage_summary: 'Routine review', triage_red_flags: [],
        }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: 'queue-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    database.connect.mockResolvedValueOnce(client);

    const response = await request(createApp()).post('/api/v1/staff/appointments/appointment-1/check-in');

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ id: 'queue-1', status: 'waiting' });
    expect(client.query.mock.calls[3]![1]).toEqual([
      'patient-1', 'hospital-1', 'service-1', 'appointment-1', 'waiting',
      'routine', 'General', 'General Medicine', 'Routine review', [],
    ]);
    expect(client.query.mock.calls.map(([sql]) => String(sql)).at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('sends an emergency-flagged booking to nurse triage at check-in', async () => {
    membership('nurse');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{
          id: 'appointment-1', user_id: 'patient-1', status: 'booked', is_today: true, hospital_id: 'hospital-1',
          hospital_service_id: 'service-1', triage_urgency: 'emergency', triage_pathway: 'Chest pain', triage_department: 'Emergency',
          triage_summary: 'Chest pain at rest', triage_red_flags: ['Chest pain at rest'],
        }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: 'queue-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    database.connect.mockResolvedValueOnce(client);

    const response = await request(createApp()).post('/api/v1/staff/appointments/appointment-1/check-in');

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ id: 'queue-1', status: 'awaiting_triage' });
    expect(client.query.mock.calls[3]![1][4]).toBe('awaiting_triage');
  });

  it('locks and completes referral creation in one transaction', async () => {
    membership('doctor');
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'staff-1', auth0_subject: 'auth0|clinician', email: 'doctor@example.com', display_name: 'Dr Amina' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ name: 'Radiology' }], rowCount: 1 });
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'queue-1', user_id: 'patient-1', hospital_service_id: 'service-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 'referral-1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({}),
      release: vi.fn(),
    };
    database.connect.mockResolvedValueOnce(client);

    const response = await request(createApp()).post('/api/v1/staff/queue/queue-1/refer').send({ serviceId: 'service-2', reason: 'Needs chest imaging' });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe('referral-1');
    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[1]).toContain('FOR UPDATE');
    expect(statements[4]).toContain('INSERT INTO audit_events');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('returns only the authenticated patient profile diagnoses in deterministic order', async () => {
    database.query
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1', phone: null, date_of_birth: null, home_address: null, emergency_contact_name: null, emergency_contact_phone: null, chronic_conditions: [], allergies: [], medications: [], blood_type: null, access_needs: null, health_notes: null, health_data_consent: false }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'diagnosis-2', diagnosis: 'Acute bronchitis', diagnosed_on: '2026-09-30', clinician_name: 'Dr Amina', notes: 'Rest.' }], rowCount: 1 });

    const response = await request(createApp()).get('/api/v1/profile');

    expect(response.status).toBe(200);
    expect(response.body.data.diagnoses[0].diagnosis).toBe('Acute bronchitis');
    expect(String(database.query.mock.calls[1]![0])).toContain('created_at DESC, id DESC');
    expect(database.query.mock.calls[0]![1]).toEqual(['auth0|clinician']);
  });
});
