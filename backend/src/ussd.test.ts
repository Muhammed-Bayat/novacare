import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { createMemoryChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import type { CreateServiceRequestInput } from './dispatch/dispatch.service.js';
import type { ServiceRequestRow, ServiceStatus } from './dispatch/domain.js';
import type { ChannelDispatchService } from './ussd.service.js';
import { createMemoryLocationConfirmationStore } from './location/location-confirmation.store.js';
import { createLocationResolutionService } from './location/location-resolution.service.js';
import type { GeocodingService } from './geocoding/geocoding.service.js';

const CALLBACK_SECRET = 'test-only-callback-secret';
const USSD_URL = `/api/v1/channels/ussd/${CALLBACK_SECRET}`;
const LEGACY_USSD_URL = '/api/v1/channels/ussd';
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
    location_state: input.locationState,
    location_confirmation_required: input.locationState !== 'LOCATION_CONFIRMED',
    location_confirmed_at: null,
    location_source: input.locationSource,
    geocoded_formatted_address: null,
    geocoding_place_id: null,
    geocoding_confidence: null,
    idempotency_key: input.idempotencyKey ?? null,
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

function testLocationResolver() {
  const geocode = vi.fn(async (address: string) => [{
    formattedAddress: `${address}, Johannesburg`,
    latitude: -26.1076,
    longitude: 28.0567,
    countryCode: 'za' as const,
    city: 'Johannesburg',
    suburb: 'Sandton',
    confidence: 0.95,
    matchType: 'full_match',
  }]);
  const geocoding: GeocodingService = {
    geocode,
  };
  return { resolver: createLocationResolutionService(geocoding, createMemoryLocationConfirmationStore()), geocode };
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
  const store = createMemoryChannelConversationStore();
  const location = testLocationResolver();
  return {
    app: createApp({
      channelDispatch: dispatch,
      channelStore: store,
      channelContext: context,
      locationResolutionService: location.resolver,
      channelCallbacks: { secret: CALLBACK_SECRET, ussdServiceCode: SESSION.serviceCode },
    }),
    calls,
    requests,
    store,
    geocode: location.geocode,
  };
}

describe('USSD channel transport and shared dispatch workflow', () => {
  it('shows the protected form-encoded main menu with the configured service code', async () => {
    const { app } = testApp();
    const response = await request(app).post(USSD_URL).type('form').send(SESSION);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toMatch(/^CON Welcome to NovaCare/);
    expect(response.text).toContain('1. Request an ambulance');
    expect(response.text).toContain('2. Request a home visit');
    expect(response.text).toContain('3. Check a request');
  });

  it('rejects missing or incorrect callback secrets before state, geocoding, or dispatch work', async () => {
    const { app, calls, store, geocode } = testApp();
    const get = vi.spyOn(store, 'get');
    const save = vi.spyOn(store, 'save');

    const missing = await request(app).post(LEGACY_USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON' });
    const incorrect = await request(app).post('/api/v1/channels/ussd/wrong-secret').type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON' });

    expect(missing.status).toBe(404);
    expect(incorrect.status).toBe(403);
    expect(get).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(geocode).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('rejects an unexpected USSD service code before state, geocoding, or dispatch work', async () => {
    const { app, calls, store, geocode } = testApp();
    const save = vi.spyOn(store, 'save');
    const response = await request(app).post(USSD_URL).type('form').send({ ...SESSION, serviceCode: '*999#', text: '1*1*DEMO SANDTON' });

    expect(response.status).toBe(200);
    expect(response.text).toBe('END NovaCare could not process this request. Please try again.');
    expect(save).not.toHaveBeenCalled();
    expect(geocode).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('creates an ambulance request through the shared service and returns its real reference', async () => {
    const { app, calls } = testApp();
    const prompt = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1' });
    const locations = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON' });
    const reason = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON*1' });
    const response = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON*1*chest pain*1' });

    expect(prompt.text).toMatch(/^CON Enter the address/);
    expect(locations.text).toMatch(/^CON We found:/);
    expect(reason.text).toBe('CON Briefly describe the emergency.');
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

    const replay = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON*1*chest pain*1' });
    expect(replay.text).toContain('NC-2026-000001');
    expect(calls).toHaveLength(1);
  });

  it('creates a home-visit request through the shared service', async () => {
    const { app, calls } = testApp();
    await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '2*3*DEMO SANDTON' });
    await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '2*3*DEMO SANDTON*1' });
    const response = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '2*3*DEMO SANDTON*1*check up*1' });

    expect(response.text).toContain('Reference: NC-2026-000001');
    expect(calls[0]).toEqual(expect.objectContaining({
      channel: 'USSD',
      type: 'HOME_VISIT',
      triage: { homeVisitReason: 'other-visit', preferredResponder: 'EITHER' },
    }));
  });

  it('looks up only the caller-owned real request reference', async () => {
    const { app } = testApp();
    await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*2*DEMO SANDTON' });
    await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*2*DEMO SANDTON*1' });
    await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*2*DEMO SANDTON*1*road accident*1' });

    const found = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '3*NC-2026-000001' });
    const hidden = await request(app).post(USSD_URL).type('form').send({ ...SESSION, phoneNumber: '+27820000000', text: '3*NC-2026-000001' });

    expect(found.text).toBe('END NC-2026-000001 is currently notified.');
    expect(hidden.text).toBe('END We could not find that request reference for this number.');
  });

  it('reports dispatcher location review instead of an operational dispatch status', async () => {
    const { app, requests } = testApp();
    const reference = 'NC-2026-000777';
    requests.set(reference, serviceRow({
      channel: 'USSD', type: 'AMBULANCE', requesterPhone: SESSION.phoneNumber, latitude: null, longitude: null,
      locationState: 'DISPATCHER_LOCATION_REVIEW', locationSource: 'UNRESOLVED', triage: {},
    }, reference, 'CREATED'));

    const response = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: `3*${reference}` });
    expect(response.text).toBe(`END ${reference} is currently waiting for location review.`);
  });

  it('ends invalid selections safely and keeps malformed callbacks unauthenticated', async () => {
    const { app } = testApp();
    const invalid = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*9' });
    await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON' });
    const enterAgain = await request(app).post(USSD_URL).type('form').send({ ...SESSION, text: '1*1*DEMO SANDTON*2' });
    const missing = await request(app).post(USSD_URL).type('form').send({ sessionId: SESSION.sessionId, text: '1' });
    const nonForm = await request(app)
      .post(USSD_URL)
      .set('Content-Type', 'text/plain')
      .send('sessionId=AT-session-001&serviceCode=*384*28149%23&phoneNumber=%2B27821234567&text=1');

    expect(invalid.status).toBe(200);
    expect(invalid.text).toBe('END Invalid selection. Please try again.');
    expect(enterAgain.text).toBe('END Please start again to enter another address.');
    expect(missing.status).toBe(200);
    expect(missing.text).toBe('END NovaCare could not process this request. Please try again.');
    expect(nonForm.status).toBe(200);
    expect(nonForm.headers['content-type']).toMatch(/text\/plain/);
    expect(nonForm.text).toBe('END NovaCare could not process this request. Please try again.');
  });
});
