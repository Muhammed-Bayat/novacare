import { randomUUID } from 'node:crypto';
import { GeocodingError, type GeocodingResult, type GeocodingService } from '../geocoding/geocoding.service.js';
import type {
  LocationConfirmationChannel,
  LocationConfirmationStore,
  StoredLocationCandidate,
} from './location-confirmation.store.js';

const CANDIDATE_TTL_MS = 30 * 60 * 1000;
const MAX_CONFIRMATION_CANDIDATES = 3;
const MIN_CONFIDENCE = 0.6;

export interface LocationConfirmationCandidate {
  id: string;
  formattedAddress: string;
  province?: string;
  city?: string;
  suburb?: string;
}

type LocationResolutionFailureReason = 'NO_RESULTS' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'CONFIGURATION_ERROR';

export type LocationResolutionOutcome =
  | { status: 'confirmation_required'; candidates: LocationConfirmationCandidate[] }
  | { status: 'unresolved'; reason: LocationResolutionFailureReason };

export class LocationConfirmationError extends Error {
  constructor(public readonly code: 'INVALID_CANDIDATE' | 'EXPIRED_CANDIDATE' | 'UNCONFIRMED_CANDIDATE') {
    super(code === 'EXPIRED_CANDIDATE' ? 'This location selection has expired. Enter the address again.' : 'This location selection is not valid.');
    this.name = 'LocationConfirmationError';
  }
}

export interface LocationResolutionService {
  resolve(input: { channel: LocationConfirmationChannel; ownerKey: string; address: string }): Promise<LocationResolutionOutcome>;
  confirm(input: { channel: LocationConfirmationChannel; ownerKey: string; candidateId: string }): Promise<LocationConfirmationCandidate>;
  getConfirmed(input: { channel: LocationConfirmationChannel; ownerKey: string; candidateId: string }): Promise<StoredLocationCandidate>;
  linkRequest(candidateId: string, requestId: string): Promise<void>;
}

function resolutionFailure(error: unknown): LocationResolutionFailureReason {
  if (error instanceof GeocodingError) {
    if (error.code === 'GEOCODING_RATE_LIMITED') return 'RATE_LIMITED';
    if (error.code === 'GEOCODING_CONFIGURATION_ERROR') return 'CONFIGURATION_ERROR';
    if (error.code === 'GEOCODING_NO_RESULTS') return 'NO_RESULTS';
  }
  return 'UNAVAILABLE';
}

function queryWords(address: string): string[] {
  const ignored = new Set(['south', 'africa', 'the', 'and', 'road', 'street', 'drive']);
  return [...new Set(address.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((word) => word.length >= 3 && !ignored.has(word));
}

function candidateText(candidate: GeocodingResult): string {
  return [candidate.formattedAddress, candidate.city, candidate.suburb, candidate.province, candidate.street]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
}

/**
 * Geoapify rank confidence is a 0-1 score. Below 0.60 its result is too broad
 * for dispatch confirmation. Requiring an address-word match removes clearly
 * unrelated city-level suggestions while keeping candidates for user choice.
 */
function confirmationCandidates(address: string, candidates: GeocodingResult[]): GeocodingResult[] {
  const words = queryWords(address);
  return candidates
    .filter((candidate) => candidate.countryCode?.toLowerCase() === 'za')
    .filter((candidate) => candidate.confidence != null && candidate.confidence >= MIN_CONFIDENCE)
    .filter((candidate) => words.length === 0 || words.some((word) => candidateText(candidate).includes(word)))
    .sort((a, b) => {
      const matchScore = (candidate: GeocodingResult): number =>
        words.filter((word) => candidateText(candidate).includes(word)).length + (candidate.matchType === 'full_match' ? 1 : 0);
      return (b.confidence! - a.confidence!) || (matchScore(b) - matchScore(a));
    })
    .slice(0, MAX_CONFIRMATION_CANDIDATES);
}

function publicCandidate(candidate: StoredLocationCandidate): LocationConfirmationCandidate {
  return {
    id: candidate.id,
    formattedAddress: candidate.formattedAddress,
    ...(candidate.province ? { province: candidate.province } : {}),
    ...(candidate.city ? { city: candidate.city } : {}),
    ...(candidate.suburb ? { suburb: candidate.suburb } : {}),
  };
}

export function createLocationResolutionService(
  geocoding: GeocodingService,
  store: LocationConfirmationStore,
  now: () => Date = () => new Date(),
): LocationResolutionService {
  async function ownedCandidate(input: { channel: LocationConfirmationChannel; ownerKey: string; candidateId: string }): Promise<StoredLocationCandidate> {
    const candidate = await store.get(input.candidateId);
    if (!candidate || candidate.channel !== input.channel || candidate.ownerKey !== input.ownerKey) {
      throw new LocationConfirmationError('INVALID_CANDIDATE');
    }
    return candidate;
  }

  return {
    async resolve(input) {
      const address = input.address.trim();
      let results: GeocodingResult[];
      try {
        results = await geocoding.geocode(address);
      } catch (error) {
        return { status: 'unresolved', reason: resolutionFailure(error) };
      }

      const selected = confirmationCandidates(address, results);
      if (selected.length === 0) return { status: 'unresolved', reason: 'NO_RESULTS' };
      const expiresAt = new Date(now().getTime() + CANDIDATE_TTL_MS).toISOString();
      const stored: StoredLocationCandidate[] = selected.map((candidate) => ({
        id: randomUUID(),
        channel: input.channel,
        ownerKey: input.ownerKey,
        enteredAddress: address,
        formattedAddress: candidate.formattedAddress,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        ...(candidate.province ? { province: candidate.province } : {}),
        ...(candidate.city ? { city: candidate.city } : {}),
        ...(candidate.suburb ? { suburb: candidate.suburb } : {}),
        ...(candidate.placeId ? { placeId: candidate.placeId } : {}),
        ...(candidate.resultType ? { resultType: candidate.resultType } : {}),
        ...(candidate.confidence != null ? { confidence: candidate.confidence } : {}),
        ...(candidate.matchType ? { matchType: candidate.matchType } : {}),
        expiresAt,
        confirmedAt: null,
        requestId: null,
      }));
      await store.save(stored);
      return { status: 'confirmation_required', candidates: stored.map(publicCandidate) };
    },

    async confirm(input) {
      const candidate = await ownedCandidate(input);
      if (new Date(candidate.expiresAt).getTime() <= now().getTime()) {
        throw new LocationConfirmationError('EXPIRED_CANDIDATE');
      }
      await store.markConfirmed(candidate.id, now().toISOString());
      return publicCandidate(candidate);
    },

    async getConfirmed(input) {
      const candidate = await ownedCandidate(input);
      if (new Date(candidate.expiresAt).getTime() <= now().getTime()) {
        throw new LocationConfirmationError('EXPIRED_CANDIDATE');
      }
      if (!candidate.confirmedAt) throw new LocationConfirmationError('UNCONFIRMED_CANDIDATE');
      return candidate;
    },

    async linkRequest(candidateId, requestId) {
      await store.linkRequest(candidateId, requestId);
    },
  };
}
