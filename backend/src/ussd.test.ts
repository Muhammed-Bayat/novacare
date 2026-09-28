import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createMemoryChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import type { CreateServiceRequestInput } from './dispatch/dispatch.service.js';
import type { ServiceRequestRow, ServiceStatus } from './dispatch/domain.js';
import type { ChannelDispatchService } from './ussd.service.js';

const USSD_URL = '/api/v1/channels/ussd';
const SESSION = { sessionId: 'AT-session-001', serviceCode: '*384*28149#', phoneNumber: '+27821234567' };

function serviceRow(input: CreateServiceRequestInput, reference: string, status: ServiceStatus = 'NOTIFIED'): ServiceRequestRow {
  return {
    id: `request-${reference}`,
    reference_code: reference,
    requester_user_id: input.requesterUserId ?? null,
    requester_phone: input.requesterPhone ?? null,
    type: input.type,
    channel: input.channel,
    status,
    urgency: input.urgency ?? 'STANDARD',
    reason: input.reason ?? null,
    triage: input.triage ?? {},
    address: input.address ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    search_radius_km: 10,
    facilities_notified: 3,
    escalation_flag: false,
    assigned_facility_id: null,
    assigned_responder_id: null,
    assigned_unit_id: null,
    created_at: '2026-09-28T00:00:00.000Z',
    updated_at: '2026-09-28T00:00:00.000Z',
    notified_at: '2026-09-28T00:00:00.000Z',
    acknowledged_at: null,
    assigned_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
  };
}

function testApp() {
  const calls: CreateServiceRequestInput[] = [];
  const requests = new Map<string, ServiceRequestRow>();
  const dispatch: ChannelDispatchService = {
    async createServiceRequest(input) {
      calls.push(input);
      const row = serviceRow(input, `NC-2026-${String(calls.length).padStart(6, '0')}`);
      requests.set(row.reference_code, row);
      return row;
    },
    async getRequestByReferenceForPhone(referenceCode, phoneNumber) {
      const row = requests.get(referenceCode);
      return row?.requester_phone === phoneNumber ? row : null;
    },
    async cancelRequestByReferenceForPhone(referenceCode, phoneNumber) {
      const row = await dispatch.getRequestByReferenceForPhone(referenceCode, phoneNumber);
      if (!row) return null;
      row.status = 'CANCELLED';
      return row;
    },
  };
  const context: ChannelRequestContext = {
    async resolveRequester() {
      return { userId: 'patient-1', savedAddress: '1 Care Lane, Sandton' };
    },
    async resolveLocation(address) {
      return { address, latitude: -26.1076, longitude: 28.0567 };
    },
  };
  return {
    app: createApp({ channelDispatch: dispatch, channelStore: createMemoryChannelConversationStore(), channelContext: context }),
    calls,
  };
}

describe('USSD channel transport and shared dispatch workflow', () => {
  it('shows the unauthenticated form-encoded main menu', async () => {
    const { app } = testApp();
    const response = await request(app).post(USSD_URL).type('form').send(SESSION);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toMatch(/^CON Welcome to NovaCare/);
    expect(response.text).toContain('1. Request an ambulance');
    expect(response.text).toContain('2. Request a home visit');
    expect(response.text).toContain('3. Check a request');
  });

  it('creates an ambulance request through the shared service and returns its real reference', async () => {
    const { app, calls } = testApp();
    const prompt = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1' });
    const response = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON*chest pain*1' });

    expect(prompt.text).toMatch(/^CON Send the address/);
    expect(response.status).toBe(200);
    expect(response.text).toBe('END NovaCare demo request received.\nReference: NC-2026-000001');
    expect(calls).toEqual([expect.objectContaining({
      channel: 'USSD',
      type: 'AMBULANCE',
      requesterUserId: 'patient-1',
      requesterPhone: SESSION.phoneNumber,
      address: 'DEMO SANDTON',
      latitude: -26.1076,
      longitude: 28.0567,
      triage: { conscious: 'YES' },
    })]);

    const replay = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON*chest pain*1' });
    expect(replay.text).toContain('NC-2026-000001');
    expect(calls).toHaveLength(1);
  });

  it('creates a home-visit request through the shared service', async () => {
    const { app, calls } = testApp();
    const response = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '2*3*DEMO SANDTON*check up*1' });

    expect(response.text).toContain('Reference: NC-2026-000001');
    expect(calls[0]).toEqual(expect.objectContaining({
      channel: 'USSD',
      type: 'HOME_VISIT',
      triage: { homeVisitReason: 'other-visit', preferredResponder: 'EITHER' },
    }));
  });

  it('looks up only the caller-owned real request reference', async () => {
    const { app } = testApp();
    await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*2*DEMO SANDTON*road accident*1' });

    const found = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '3*NC-2026-000001' });
    const hidden = await request(app).post(USSD_URL).type('form').send({ ...SESSION, phoneNumber: '+27820000000', text: '3*NC-2026-000001' });

    expect(found.text).toBe('END NC-2026-000001 is currently notified.');
    expect(hidden.text).toBe('END We could not find that request reference for this number.');
  });

  it('ends invalid selections safely and keeps malformed callbacks unauthenticated', async () => {
    const { app } = testApp();
    const invalid = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*9' });
    const missing = await request(app).post(USSD_URL).type('form').send({ sessionId: SESSION.sessionId, text: '1' });
    const nonForm = await request(app)
      .post(USSD_URL)
      .set('Content-Type', 'text/plain')
      .send('sessionId=AT-session-001&serviceCode=*384*28149%23&phoneNumber=%2B27821234567&text=1');

    expect(invalid.status).toBe(200);
    expect(invalid.text).toBe('END Invalid selection. Please try again.');
    expect(missing.status).toBe(200);
    expect(missing.text).toBe('END NovaCare could not process this request. Please try again.');
    expect(nonForm.status).toBe(200);
    expect(nonForm.headers['content-type']).toMatch(/text\/plain/);
    expect(nonForm.text).toBe('END NovaCare could not process this request. Please try again.');
  });
});
