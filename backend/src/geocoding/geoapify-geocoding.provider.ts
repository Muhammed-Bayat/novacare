import {
  GeocodingError,
  type GeocodingErrorCode,
  type GeocodingProvider,
  type GeocodingResult,
} from './geocoding.service.js';

const GEOAPIFY_URL = 'https://api.geoapify.com/v1/geocode/search';
const DEFAULT_TIMEOUT_MS = 7_000;

type GeoapifyProviderOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeLog(success: boolean, resultCount?: number, errorCode?: GeocodingErrorCode): void {
  console.log(JSON.stringify({
    provider: 'geoapify',
    operation: 'forward_geocode',
    success,
    ...(success ? { resultCount: resultCount ?? 0 } : { errorCode }),
  }));
}

function normalizedError(error: unknown): GeocodingError {
  if (error instanceof GeocodingError) return error;
  return new GeocodingError('GEOCODING_UNAVAILABLE', 'The geocoding service is unavailable. Please try again shortly.');
}

function normalizeCandidate(value: unknown): GeocodingResult | undefined {
  const candidate = asRecord(value);
  if (!candidate) return undefined;

  const countryCode = stringValue(candidate.country_code)?.trim().toLowerCase();
  if (countryCode !== 'za') return undefined;

  const formattedAddress = stringValue(candidate.formatted);
  const latitude = numberValue(candidate.lat);
  const longitude = numberValue(candidate.lon);
  if (!formattedAddress || latitude === undefined || longitude === undefined) return undefined;

  const rank = asRecord(candidate.rank);
  return {
    formattedAddress,
    latitude,
    longitude,
    countryCode,
    ...(stringValue(candidate.country) ? { country: stringValue(candidate.country) } : {}),
    ...(stringValue(candidate.state) ? { province: stringValue(candidate.state) } : {}),
    ...(stringValue(candidate.city) ? { city: stringValue(candidate.city) } : {}),
    ...(stringValue(candidate.suburb) ? { suburb: stringValue(candidate.suburb) } : {}),
    ...(stringValue(candidate.postcode) ? { postcode: stringValue(candidate.postcode) } : {}),
    ...(stringValue(candidate.street) ? { street: stringValue(candidate.street) } : {}),
    ...(stringValue(candidate.housenumber) ? { houseNumber: stringValue(candidate.housenumber) } : {}),
    ...(stringValue(candidate.place_id) ? { placeId: stringValue(candidate.place_id) } : {}),
    ...(stringValue(candidate.result_type) ? { resultType: stringValue(candidate.result_type) } : {}),
    ...(numberValue(rank?.confidence) !== undefined ? { confidence: numberValue(rank?.confidence) } : {}),
    ...(numberValue(rank?.confidence_city_level) !== undefined ? { confidenceCityLevel: numberValue(rank?.confidence_city_level) } : {}),
    ...(numberValue(rank?.confidence_street_level) !== undefined ? { confidenceStreetLevel: numberValue(rank?.confidence_street_level) } : {}),
    ...(numberValue(rank?.confidence_building_level) !== undefined ? { confidenceBuildingLevel: numberValue(rank?.confidence_building_level) } : {}),
    ...(stringValue(rank?.match_type) ? { matchType: stringValue(rank?.match_type) } : {}),
  };
}

export class GeoapifyGeocodingProvider implements GeocodingProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GeoapifyProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async geocode(address: string): Promise<GeocodingResult[]> {
    try {
      const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
      const country = process.env.GEOCODING_COUNTRY?.trim().toLowerCase();
      const provider = process.env.GEOCODING_PROVIDER?.trim().toLowerCase();
      if (provider !== 'geoapify' || !apiKey || country !== 'za') {
        throw new GeocodingError('GEOCODING_CONFIGURATION_ERROR', 'Geocoding is not configured.');
      }

      const url = new URL(GEOAPIFY_URL);
      url.searchParams.set('text', address);
      url.searchParams.set('format', 'json');
      url.searchParams.set('filter', `countrycode:${country}`);
      url.searchParams.set('limit', '5');
      url.searchParams.set('apiKey', apiKey);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url, { method: 'GET', signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw new GeocodingError('GEOCODING_UNAVAILABLE', 'The geocoding service timed out. Please try again shortly.');
        }
        throw new GeocodingError('GEOCODING_UNAVAILABLE', 'The geocoding service is unavailable. Please try again shortly.');
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401 || response.status === 403) {
        throw new GeocodingError('GEOCODING_CONFIGURATION_ERROR', 'Geocoding is not configured.');
      }
      if (response.status === 429) {
        throw new GeocodingError('GEOCODING_RATE_LIMITED', 'Geocoding is temporarily rate limited. Please try again later.');
      }
      if (!response.ok) {
        throw new GeocodingError('GEOCODING_UNAVAILABLE', 'The geocoding service is unavailable. Please try again shortly.');
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new GeocodingError('GEOCODING_UNAVAILABLE', 'The geocoding service returned an invalid response.');
      }
      const results = asRecord(payload)?.results;
      if (!Array.isArray(results)) {
        throw new GeocodingError('GEOCODING_UNAVAILABLE', 'The geocoding service returned an invalid response.');
      }

      const candidates = results.flatMap((candidate) => {
        const normalized = normalizeCandidate(candidate);
        return normalized ? [normalized] : [];
      });
      if (candidates.length === 0) {
        throw new GeocodingError('GEOCODING_NO_RESULTS', 'No South African address candidates were found.');
      }

      safeLog(true, candidates.length);
      return candidates;
    } catch (error) {
      const geocodingError = normalizedError(error);
      safeLog(false, undefined, geocodingError.code);
      throw geocodingError;
    }
  }
}
