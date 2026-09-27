import { describe, expect, it } from 'vitest';
import { adaptSmsRequest, adaptUssdRequest, adaptWebRequest } from './channel-adapters.js';
import { DispatchValidationError } from './dispatch.service.js';

describe('web channel adapter', () => {
  const requester = { userId: 'user-1', phone: '+27820000001' };

  it('adapts a complete ambulance request', () => {
    const input = adaptWebRequest(
      {
        type: 'AMBULANCE',
        urgency: 'EMERGENCY',
        reason: 'Chest pain demo',
        latitude: -26.1076,
        longitude: 28.0567,
        triage: { ambulanceReason: 'chest-pain', conscious: 'YES' },
      },
      requester,
    );
    expect(input).toEqual({
      channel: 'WEB',
      type: 'AMBULANCE',
      urgency: 'EMERGENCY',
      reason: 'Chest pain demo',
      triage: { ambulanceReason: 'chest-pain', conscious: 'YES' },
      address: undefined,
      latitude: -26.1076,
      longitude: 28.0567,
      requesterUserId: 'user-1',
      requesterPhone: '+27820000001',
    });
  });

  it('accepts a manual address when coordinates are absent', () => {
    const input = adaptWebRequest({ type: 'HOME_VISIT', address: '  1 Care Lane, Sandton  ', triage: { homeVisitReason: 'check-up', preferredResponder: 'NURSE' } }, requester);
    expect(input.address).toBe('1 Care Lane, Sandton');
    expect(input.latitude).toBeNull();
    expect(input.type).toBe('HOME_VISIT');
    expect(input.triage).toEqual({ homeVisitReason: 'check-up', preferredResponder: 'NURSE' });
  });

  it('requires location or address', () => {
    expect(() => adaptWebRequest({ type: 'AMBULANCE' }, requester)).toThrow(DispatchValidationError);
  });

  it('rejects an unknown type', () => {
    expect(() => adaptWebRequest({ type: 'HELICOPTER', latitude: 1, longitude: 1 }, requester)).toThrow(DispatchValidationError);
  });

  it('downgrades unknown urgency to STANDARD', () => {
    const input = adaptWebRequest({ type: 'AMBULANCE', urgency: 'SUPER_URGENT', latitude: 1, longitude: 1, triage: { ambulanceReason: 'chest-pain', conscious: 'YES' } }, requester);
    expect(input.urgency).toBe('STANDARD');
  });

  it('ignores triage fields that belong to the other request type', () => {
    const ambulance = adaptWebRequest(
      { type: 'AMBULANCE', latitude: 1, longitude: 1, triage: { ambulanceReason: 'chest-pain', homeVisitReason: 'check-up', conscious: 'NO' } },
      requester,
    );
    expect(ambulance.triage).toEqual({ ambulanceReason: 'chest-pain', conscious: 'NO' });

    const homeVisit = adaptWebRequest(
      { type: 'HOME_VISIT', address: '1 Demo Street', triage: { ambulanceReason: 'chest-pain', homeVisitReason: 'check-up', preferredResponder: 'EITHER' } },
      requester,
    );
    expect(homeVisit.triage).toEqual({ homeVisitReason: 'check-up', preferredResponder: 'EITHER' });
  });

  it('requires complete, type-specific web triage', () => {
    expect(() => adaptWebRequest({ type: 'AMBULANCE', latitude: 1, longitude: 1, triage: { ambulanceReason: 'made-up', conscious: 'YES' } }, requester)).toThrow(DispatchValidationError);
    expect(() => adaptWebRequest({ type: 'HOME_VISIT', latitude: 1, longitude: 1, triage: { homeVisitReason: 'check-up' } }, requester)).toThrow(DispatchValidationError);
  });
});

describe('USSD channel adapter', () => {
  it('defaults to AMBULANCE with URGENT priority for the sandbox flow', () => {
    const input = adaptUssdRequest({ phoneNumber: '+27820000002', type: 'AMBULANCE', conscious: 'NO' });
    expect(input.channel).toBe('USSD');
    expect(input.type).toBe('AMBULANCE');
    expect(input.urgency).toBe('URGENT');
    expect(input.triage).toEqual({ conscious: 'NO' });
    expect(input.requesterUserId).toBeNull();
    expect(input.requesterPhone).toBe('+27820000002');
  });

  it('maps HOME_VISIT without the ambulance triage fields', () => {
    const input = adaptUssdRequest({ phoneNumber: '+27820000002', type: 'HOME_VISIT', address: '2 Demo Avenue' });
    expect(input.type).toBe('HOME_VISIT');
    expect(input.urgency).toBe('STANDARD');
    expect(input.triage).toEqual({});
    expect(input.address).toBe('2 Demo Avenue');
  });
});

describe('SMS channel adapter', () => {
  it('treats HOME/VISIT keywords as a home visit and everything else as an ambulance request', () => {
    expect(adaptSmsRequest({ phoneNumber: '+27820000003', text: 'HOME fever since yesterday' }).type).toBe('HOME_VISIT');
    expect(adaptSmsRequest({ phoneNumber: '+27820000003', text: 'VISIT wound check' }).type).toBe('HOME_VISIT');
    expect(adaptSmsRequest({ phoneNumber: '+27820000003', text: 'AMBULANCE chest pain' }).type).toBe('AMBULANCE');
    expect(adaptSmsRequest({ phoneNumber: '+27820000003', text: 'anything at all' }).type).toBe('AMBULANCE');
  });

  it('keeps the original text as the reason and carries optional coordinates', () => {
    const input = adaptSmsRequest({ phoneNumber: '+27820000003', text: 'AMBULANCE fall', latitude: -26.1, longitude: 28.05 });
    expect(input.channel).toBe('SMS');
    expect(input.reason).toBe('AMBULANCE fall');
    expect(input.latitude).toBe(-26.1);
    expect(input.requesterPhone).toBe('+27820000003');
  });
});
