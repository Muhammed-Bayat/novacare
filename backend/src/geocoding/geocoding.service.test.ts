import { describe, expect, it, vi } from 'vitest';
import {
  createGeocodingService,
  type GeocodingProvider,
  type GeocodingResult,
} from './geocoding.service.js';

const candidate: GeocodingResult = {
  formattedAddress: 'Nelson Mandela Square, Sandton, South Africa',
  latitude: -26.1076,
  longitude: 28.0567,
  countryCode: 'za',
};

describe('GeocodingService', () => {
  it('trims valid addresses before passing only the address to its provider', async () => {
    const provider: GeocodingProvider = { geocode: vi.fn().mockResolvedValue([candidate]) };
    const service = createGeocodingService(provider);

    await expect(service.geocode('  Nelson Mandela Square, Sandton  ')).resolves.toEqual([candidate]);
    expect(provider.geocode).toHaveBeenCalledWith('Nelson Mandela Square, Sandton');
  });

  it.each(['', '   ', 'x'.repeat(301)])('rejects invalid address input', async (address) => {
    const provider: GeocodingProvider = { geocode: vi.fn() };
    const service = createGeocodingService(provider);

    await expect(service.geocode(address)).rejects.toMatchObject({
      code: 'GEOCODING_INVALID_INPUT',
    });
    expect(provider.geocode).not.toHaveBeenCalled();
  });
});
