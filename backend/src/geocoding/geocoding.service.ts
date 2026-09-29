export interface GeocodingResult {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  country?: string;
  countryCode?: string;
  province?: string;
  city?: string;
  suburb?: string;
  postcode?: string;
  street?: string;
  houseNumber?: string;
  placeId?: string;
  resultType?: string;
  confidence?: number;
  confidenceCityLevel?: number;
  confidenceStreetLevel?: number;
  confidenceBuildingLevel?: number;
  matchType?: string;
}

export interface GeocodingProvider {
  geocode(address: string): Promise<GeocodingResult[]>;
}

export type GeocodingErrorCode =
  | 'GEOCODING_INVALID_INPUT'
  | 'GEOCODING_NO_RESULTS'
  | 'GEOCODING_UNAVAILABLE'
  | 'GEOCODING_RATE_LIMITED'
  | 'GEOCODING_CONFIGURATION_ERROR';

export class GeocodingError extends Error {
  constructor(public readonly code: GeocodingErrorCode, message: string) {
    super(message);
    this.name = 'GeocodingError';
  }
}

export interface GeocodingService {
  geocode(address: string): Promise<GeocodingResult[]>;
}

const MAX_ADDRESS_LENGTH = 300;

export function createGeocodingService(provider: GeocodingProvider): GeocodingService {
  return {
    async geocode(address: string): Promise<GeocodingResult[]> {
      if (typeof address !== 'string') {
        throw new GeocodingError('GEOCODING_INVALID_INPUT', 'Provide an address.');
      }

      const normalizedAddress = address.trim();
      if (!normalizedAddress || normalizedAddress.length > MAX_ADDRESS_LENGTH) {
        throw new GeocodingError('GEOCODING_INVALID_INPUT', 'Provide an address of up to 300 characters.');
      }

      return provider.geocode(normalizedAddress);
    },
  };
}
