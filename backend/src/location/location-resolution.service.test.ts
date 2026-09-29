import { describe, expect, it } from 'vitest';
import { GeocodingError, type GeocodingResult, type GeocodingService } from '../geocoding/geocoding.service.js';
import { createMemoryLocationConfirmationStore } from './location-confirmation.store.js';
import { createLocationResolutionService, LocationConfirmationError } from './location-resolution.service.js';

function geocoding(results: GeocodingResult[]): GeocodingService {
  return { async geocode() { return results; } };
}

const baseResult: GeocodingResult = {
  formattedAddress: '1 Care Lane, Sandton, Johannesburg, South Africa',
  latitude: -26.1076,
  longitude: 28.0567,
  countryCode: 'za',
  city: 'Johannesburg',
  suburb: 'Sandton',
  confidence: 0.92,
  matchType: 'full_match',
};

describe('location resolution confirmation', () => {
  it('stores only relevant, high-confidence South African candidates and keeps coordinates server-side', async () => {
    const service = createLocationResolutionService(geocoding([
      baseResult,
      { ...baseResult, formattedAddress: 'Sandton, Johannesburg, South Africa', confidence: 0.4 },
      { ...baseResult, formattedAddress: 'Cape Town, South Africa', city: 'Cape Town', suburb: undefined },
      { ...baseResult, formattedAddress: '1 Care Lane, New York, United States', countryCode: 'us' },
    ]), createMemoryLocationConfirmationStore());

    const outcome = await service.resolve({ channel: 'WEB', ownerKey: 'auth0|patient', address: '1 Care Lane, Sandton' });

    expect(outcome.status).toBe('confirmation_required');
    if (outcome.status !== 'confirmation_required') return;
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0]).toMatchObject({ formattedAddress: baseResult.formattedAddress, suburb: 'Sandton' });
    expect(outcome.candidates[0]).not.toHaveProperty('latitude');
    await service.confirm({ channel: 'WEB', ownerKey: 'auth0|patient', candidateId: outcome.candidates[0].id });
    await expect(service.getConfirmed({ channel: 'WEB', ownerKey: 'auth0|patient', candidateId: outcome.candidates[0].id }))
      .resolves.toMatchObject({ latitude: -26.1076, longitude: 28.0567 });
  });

  it('rejects candidates owned by another channel user', async () => {
    const service = createLocationResolutionService(geocoding([baseResult]), createMemoryLocationConfirmationStore());
    const outcome = await service.resolve({ channel: 'SMS', ownerKey: '+27821234567', address: '1 Care Lane, Sandton' });
    if (outcome.status !== 'confirmation_required') throw new Error('Expected a candidate');

    await expect(service.confirm({ channel: 'SMS', ownerKey: '+27820000000', candidateId: outcome.candidates[0].id }))
      .rejects.toMatchObject({ code: 'INVALID_CANDIDATE' } satisfies Partial<LocationConfirmationError>);
  });

  it('fails closed when the provider is unavailable or candidate confirmation has expired', async () => {
    let now = new Date('2026-09-29T12:00:00.000Z');
    const service = createLocationResolutionService(geocoding([baseResult]), createMemoryLocationConfirmationStore(), () => now);
    const outcome = await service.resolve({ channel: 'USSD', ownerKey: '+27821234567:session-1', address: '1 Care Lane, Sandton' });
    if (outcome.status !== 'confirmation_required') throw new Error('Expected a candidate');
    now = new Date('2026-09-29T12:31:00.000Z');
    await expect(service.confirm({ channel: 'USSD', ownerKey: '+27821234567:session-1', candidateId: outcome.candidates[0].id }))
      .rejects.toMatchObject({ code: 'EXPIRED_CANDIDATE' } satisfies Partial<LocationConfirmationError>);

    const unavailable: GeocodingService = { async geocode() { throw new GeocodingError('GEOCODING_UNAVAILABLE', 'offline'); } };
    await expect(createLocationResolutionService(unavailable, createMemoryLocationConfirmationStore())
      .resolve({ channel: 'WEB', ownerKey: 'auth0|patient', address: '1 Care Lane, Sandton' }))
      .resolves.toMatchObject({ status: 'unresolved', reason: 'UNAVAILABLE' });
  });
});
