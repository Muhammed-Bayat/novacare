import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeoapifyGeocodingProvider } from './geoapify-geocoding.provider.js';

function providerResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function configuredProvider(fetchImpl: typeof fetch, timeoutMs?: number): GeoapifyGeocodingProvider {
  vi.stubEnv('GEOCODING_PROVIDER', 'geoapify');
  vi.stubEnv('GEOAPIFY_API_KEY', 'configured-for-test');
  vi.stubEnv('GEOCODING_COUNTRY', 'za');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  return new GeoapifyGeocodingProvider({ fetchImpl, timeoutMs });
}

const southAfricanCandidate = {
  formatted: 'Nelson Mandela Square, Sandton, Johannesburg, South Africa',
  lat: -26.1076,
  lon: 28.0567,
  country: 'South Africa',
  country_code: 'ZA',
  state: 'Gauteng',
  city: 'Johannesburg',
  suburb: 'Sandton',
  postcode: '2196',
  street: 'Maude Street',
  housenumber: '2',
  place_id: 'example-place',
  result_type: 'amenity',
  rank: {
    confidence: 0.92,
    confidence_city_level: 1,
    confidence_street_level: 0.9,
    confidence_building_level: 0.8,
    match_type: 'full_match',
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GeoapifyGeocodingProvider', () => {
  it('fails without a valid Geoapify configuration and does not make a request', async () => {
    vi.stubEnv('GEOCODING_PROVIDER', 'geoapify');
    vi.stubEnv('GEOCODING_COUNTRY', 'za');
    vi.stubEnv('GEOAPIFY_API_KEY', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchMock = vi.fn();
    const provider = new GeoapifyGeocodingProvider({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(provider.geocode('Sandton')).rejects.toMatchObject({ code: 'GEOCODING_CONFIGURATION_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses one forward-geocoding request with the configured South Africa filter and limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(200, { results: [southAfricanCandidate] }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    await provider.geocode('Nelson Mandela Square, Sandton');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.origin).toBe('https://api.geoapify.com');
    expect(url.pathname).toBe('/v1/geocode/search');
    expect(url.searchParams.get('text')).toBe('Nelson Mandela Square, Sandton');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('filter')).toBe('countrycode:za');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('normalizes successful candidates without exposing the raw provider payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(200, {
      results: [{ ...southAfricanCandidate, provider_only_field: 'not returned' }],
      provider_metadata: { raw: 'not returned' },
    }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.geocode('Nelson Mandela Square, Sandton')).resolves.toEqual([{
      formattedAddress: southAfricanCandidate.formatted,
      latitude: southAfricanCandidate.lat,
      longitude: southAfricanCandidate.lon,
      country: 'South Africa',
      countryCode: 'za',
      province: 'Gauteng',
      city: 'Johannesburg',
      suburb: 'Sandton',
      postcode: '2196',
      street: 'Maude Street',
      houseNumber: '2',
      placeId: 'example-place',
      resultType: 'amenity',
      confidence: 0.92,
      confidenceCityLevel: 1,
      confidenceStreetLevel: 0.9,
      confidenceBuildingLevel: 0.8,
      matchType: 'full_match',
    }]);
  });

  it('normalizes multiple South African candidates', async () => {
    const second = {
      ...southAfricanCandidate,
      formatted: 'Sandton City, Sandton, Johannesburg, South Africa',
      lat: -26.1072,
      lon: 28.0536,
      place_id: 'second-place',
    };
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(200, { results: [southAfricanCandidate, second] }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    const candidates = await provider.geocode('Sandton, Johannesburg');

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.placeId)).toEqual(['example-place', 'second-place']);
  });

  it('discards non-South African candidates even when returned by the provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(200, {
      results: [
        { ...southAfricanCandidate, country_code: 'GB', formatted: 'London, United Kingdom' },
        southAfricanCandidate,
      ],
    }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.geocode('Sandton')).resolves.toEqual([
      expect.objectContaining({ countryCode: 'za', formattedAddress: southAfricanCandidate.formatted }),
    ]);
  });

  it('returns a no-results error when no South African candidate remains', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(200, { results: [] }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.geocode('Unknown place')).rejects.toMatchObject({ code: 'GEOCODING_NO_RESULTS' });
  });

  it('aborts a request that exceeds its timeout', async () => {
    let receivedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      receivedSignal = init?.signal as AbortSignal;
      receivedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch, 1);

    await expect(provider.geocode('Sandton')).rejects.toMatchObject({ code: 'GEOCODING_UNAVAILABLE' });
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('maps connection failures safely without retrying', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.geocode('Sandton')).rejects.toMatchObject({ code: 'GEOCODING_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'GEOCODING_CONFIGURATION_ERROR'],
    [403, 'GEOCODING_CONFIGURATION_ERROR'],
    [429, 'GEOCODING_RATE_LIMITED'],
    [500, 'GEOCODING_UNAVAILABLE'],
  ] as const)('maps Geoapify HTTP %i safely', async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(status, { error: 'not exposed' }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.geocode('Sandton')).rejects.toMatchObject({ code });
  });

  it('treats malformed Geoapify responses as unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(200, { unexpected: [] }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    await expect(provider.geocode('Sandton')).rejects.toMatchObject({ code: 'GEOCODING_UNAVAILABLE' });
  });

  it('logs only safe request metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(200, { results: [southAfricanCandidate] }));
    const provider = configuredProvider(fetchMock as unknown as typeof fetch);

    await provider.geocode('Private address that must not be logged');

    const logSpy = vi.mocked(console.log);
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
      provider: 'geoapify',
      operation: 'forward_geocode',
      success: true,
      resultCount: 1,
    });
  });
});
