import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { createMemoryChannelConversationStore, type ChannelConversationStore } from './channels/conversation.store.js';
import type { ChannelRequestContext } from './channels/request-context.service.js';
import type { CreateServiceRequestInput } from './dispatch/dispatch.service.js';
import type { ServiceRequestRow, ServiceStatus } from './dispatch/domain.js';
import { sendSms } from './sms.client.js';
import { SMS_REPLY_AMBULANCE, SMS_REPLY_FALLBACK, SMS_REPLY_HOME } from './sms.service.js';
import type { ChannelDispatchService } from './ussd.service.js';
import { createMemoryLocationConfirmationStore } from './location/location-confirmation.store.js';
import { createLocationResolutionService } from './location/location-resolution.service.js';
import type { GeocodingService } from './geocoding/geocoding.service.js';

vi.mock('./sms.client.js', () => ({
  sendSms: vi.fn(async () => ({ messageId: 'ATXid_test', status: 'Success', statusCode: 101 })),
}));

const CALLBACK_SECRET = 'test-only-callback-secret';
const SMS_SHORTCODE = '45854';
const SMS_URL = `/api/v1/channels/sms/incoming/${CALLBACK_SECRET}`;
const LEGACY_SMS_URL = '/api/v1/channels/sms/incoming';
const SENDER = '+27821234567';
const sendSmsMock = vi.mocked(sendSms);

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

function testApp(store: ChannelConversationStore = createMemoryChannelConversationStore()) {
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
  const location = testLocationResolver();
  return {
    app: createApp({
      channelDispatch: dispatch,
      channelStore: store,
      channelContext: context,
      locationResolutionService: location.resolver,
      channelCallbacks: { secret: CALLBACK_SECRET, ussdServiceCode: '*384*28149#' },
    }),
    calls,
    requests,
    store,
    geocode: location.geocode,
  };
}

async function postIncoming(app: ReturnType<typeof createApp>, fields: Record<string, string>) {
  return request(app).post(SMS_URL).type('form').send({ to: SMS_SHORTCODE, ...fields });
}

async function expectReply(message: string, count: number) {
  expect(message).not.toMatch(/demo|simulated|simulation/i);
  await vi.waitFor(() => expect(sendSmsMock).toHaveBeenCalledTimes(count));
  expect(sendSmsMock.mock.calls[count - 1]).toEqual([SENDER, message]);
}

describe('SMS incoming channel transport and shared dispatch workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a callback with the configured secret and shortcode', async () => {
    const { app } = testApp();
    const response = await postIncoming(app, { from: SENDER, to: '45854', text: 'AMBULANCE' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toBe('ok');
    await expectReply(SMS_REPLY_AMBULANCE, 1);
  });

  it('rejects missing or incorrect callback secrets before state, geocoding, dispatch, or SMS work', async () => {
    const store = createMemoryChannelConversationStore();
    const { app, calls, geocode } = testApp(store);
    const get = vi.spyOn(store, 'get');
    const save = vi.spyOn(store, 'save');

    const missing = await request(app).post(LEGACY_SMS_URL).type('form').send({ from: SENDER, to: SMS_SHORTCODE, text: 'AMBULANCE' });
    const incorrect = await request(app).post('/api/v1/channels/sms/incoming/wrong-secret').type('form').send({ from: SENDER, to: SMS_SHORTCODE, text: 'AMBULANCE' });

    expect(missing.status).toBe(404);
    expect(incorrect.status).toBe(403);
    expect(get).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(geocode).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('rejects an incoming SMS for a different or missing destination shortcode before processing', async () => {
    const store = createMemoryChannelConversationStore();
    const { app, calls, geocode } = testApp(store);
    const save = vi.spyOn(store, 'save');

    const wrong = await postIncoming(app, { from: SENDER, to: '99999', text: 'AMBULANCE' });
    const missing = await request(app).post(SMS_URL).type('form').send({ from: SENDER, text: 'AMBULANCE' });

    expect(wrong.status).toBe(200);
    expect(missing.status).toBe(200);
    expect(save).not.toHaveBeenCalled();
    expect(geocode).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('normalizes lowercase ambulance and persists the full flow through a restart', async () => {
    const store = createMemoryChannelConversationStore();
    const first = testApp(store);
    await postIncoming(first.app, { from: SENDER, text: ' ambulance ' });
    await expectReply(SMS_REPLY_AMBULANCE, 1);

    // A new app instance uses the same durable store just as a restarted Render process would.
    const restarted = testApp(store);
    await postIncoming(restarted.app, { from: SENDER, text: 'Sandton' });
    await expectReply('We found: Sandton, Johannesburg. Send YES to 45854 to confirm, or NO to enter the address again.', 2);
    await postIncoming(restarted.app, { from: SENDER, text: 'YES' });
    await expectReply('Is the patient conscious? Reply YES or NO to 45854.', 3);
    await postIncoming(restarted.app, { from: SENDER, text: 'YES' });
    await expectReply('Briefly describe the emergency. Reply to 45854, or reply CANCEL or RESTART to 45854.', 4);
    await postIncoming(restarted.app, { from: SENDER, text: 'chest pain' });
    await expectReply('Confirm this ambulance request? Send YES to 45854 to submit, or NO to 45854 to cancel.', 5);
    await postIncoming(restarted.app, { from: SENDER, text: 'YES' });
    await expectReply('NovaCare request received. Reference: NC-2026-000001. Reply STATUS NC-2026-000001 to 45854 for updates.', 6);

    expect(restarted.calls).toEqual([expect.objectContaining({
      channel: 'SMS',
      type: 'AMBULANCE',
      requesterUserId: 'patient-1',
      requesterPhone: SENDER,
      address: 'Sandton',
      latitude: -26.1076,
      longitude: 28.0567,
      triage: { conscious: 'YES' },
    })]);
  });

  it('creates a home visit through the same shared service', async () => {
    const { app, calls } = testApp();
    await postIncoming(app, { from: SENDER, text: 'HOME' });
    await expectReply(SMS_REPLY_HOME, 1);
    await postIncoming(app, { from: SENDER, text: 'EITHER' });
    await expectReply('Please send your address to 45854. Reply SAVED to use a consented profile address.', 2);
    await postIncoming(app, { from: SENDER, text: 'Sandton' });
    await expectReply('We found: Sandton, Johannesburg. Send YES to 45854 to confirm, or NO to enter the address again.', 3);
    await postIncoming(app, { from: SENDER, text: 'YES' });
    await expectReply('Briefly describe the reason for the home visit. Reply to 45854, or reply CANCEL or RESTART to 45854.', 4);
    await postIncoming(app, { from: SENDER, text: 'routine check up' });
    await expectReply('Confirm this home-visit request? Send YES to 45854 to submit, or NO to 45854 to cancel.', 5);
    await postIncoming(app, { from: SENDER, text: 'YES' });
    await expectReply('NovaCare request received. Reference: NC-2026-000001. Reply STATUS NC-2026-000001 to 45854 for updates.', 6);

    expect(calls).toEqual([expect.objectContaining({
      channel: 'SMS',
      type: 'HOME_VISIT',
      triage: { homeVisitReason: 'other-visit', preferredResponder: 'EITHER' },
    })]);
  });

  it('supports STATUS, CANCEL, and RESTART without exposing another caller request', async () => {
    const { app } = testApp();
    await postIncoming(app, { from: SENDER, text: 'AMBULANCE' });
    await postIncoming(app, { from: SENDER, text: 'Sandton' });
    await postIncoming(app, { from: SENDER, text: 'YES' });
    await postIncoming(app, { from: SENDER, text: 'NO' });
    await postIncoming(app, { from: SENDER, text: 'road accident' });
    await postIncoming(app, { from: SENDER, text: 'YES' });
    await postIncoming(app, { from: SENDER, text: 'STATUS NC-2026-000001' });
    await expectReply('NC-2026-000001 is currently notified.', 7);
    await postIncoming(app, { from: '+27820000000', text: 'STATUS NC-2026-000001' });
    await vi.waitFor(() => expect(sendSmsMock).toHaveBeenCalledTimes(8));
    expect(sendSmsMock.mock.calls[7]).toEqual(['+27820000000', 'NovaCare could not find that request reference for this number.']);
    await postIncoming(app, { from: SENDER, text: 'CANCEL' });
    await expectReply('NovaCare request NC-2026-000001 cancelled.', 9);
    await postIncoming(app, { from: SENDER, text: 'RESTART' });
    await expectReply('NovaCare conversation restarted. Reply AMBULANCE or HOME to 45854.', 10);
  });

  it('reports dispatcher location review instead of an operational dispatch status', async () => {
    const { app, requests } = testApp();
    const reference = 'NC-2026-000777';
    requests.set(reference, serviceRow({
      channel: 'SMS', type: 'AMBULANCE', requesterPhone: SENDER, latitude: null, longitude: null,
      locationState: 'DISPATCHER_LOCATION_REVIEW', locationSource: 'UNRESOLVED', triage: {},
    }, reference, 'CREATED'));

    await postIncoming(app, { from: SENDER, text: `STATUS ${reference}` });
    await expectReply(`${reference} is currently waiting for location review.`, 1);
  });

  it('deduplicates a provider message ID and keeps optional callback fields safe', async () => {
    const { app } = testApp();
    const callback = { from: SENDER, to: '45854', text: 'HOME', date: '2026-09-28 12:00:00', id: 'ATid_1', linkId: 'ATlink_1', networkCode: '65501' };
    const first = await postIncoming(app, callback);
    const replay = await postIncoming(app, callback);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    await expectReply(SMS_REPLY_HOME, 1);
  });

  it('fails safely for malformed input and returns the fallback for an unknown command', async () => {
    const { app } = testApp();
    const missingSender = await postIncoming(app, { to: '45854', text: 'AMBULANCE' });
    const missingText = await postIncoming(app, { from: SENDER, to: '45854' });
    await postIncoming(app, { from: SENDER, text: 'HELLO' });

    expect(missingSender.status).toBe(200);
    expect(missingText.status).toBe(200);
    await expectReply(SMS_REPLY_FALLBACK, 1);
  });
});
