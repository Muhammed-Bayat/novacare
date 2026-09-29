import { getPool } from '../db.js';

export type LocationConfirmationChannel = 'WEB' | 'SMS' | 'USSD';

export interface StoredLocationCandidate {
  id: string;
  channel: LocationConfirmationChannel;
  ownerKey: string;
  enteredAddress: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  province?: string;
  city?: string;
  suburb?: string;
  placeId?: string;
  resultType?: string;
  confidence?: number;
  matchType?: string;
  expiresAt: string;
  confirmedAt: string | null;
  requestId: string | null;
}

export interface LocationConfirmationStore {
  save(candidates: StoredLocationCandidate[]): Promise<void>;
  get(id: string): Promise<StoredLocationCandidate | null>;
  markConfirmed(id: string, confirmedAt: string): Promise<void>;
  linkRequest(id: string, requestId: string): Promise<void>;
}

type CandidateRow = {
  id: string;
  channel: LocationConfirmationChannel;
  owner_key: string;
  entered_address: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  province: string | null;
  city: string | null;
  suburb: string | null;
  place_id: string | null;
  result_type: string | null;
  confidence: number | null;
  match_type: string | null;
  expires_at: string | Date;
  confirmed_at: string | Date | null;
  request_id: string | null;
};

function timestamp(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function fromRow(row: CandidateRow): StoredLocationCandidate {
  return {
    id: row.id,
    channel: row.channel,
    ownerKey: row.owner_key,
    enteredAddress: row.entered_address,
    formattedAddress: row.formatted_address,
    latitude: row.latitude,
    longitude: row.longitude,
    ...(row.province ? { province: row.province } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(row.suburb ? { suburb: row.suburb } : {}),
    ...(row.place_id ? { placeId: row.place_id } : {}),
    ...(row.result_type ? { resultType: row.result_type } : {}),
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    ...(row.match_type ? { matchType: row.match_type } : {}),
    expiresAt: timestamp(row.expires_at)!,
    confirmedAt: timestamp(row.confirmed_at),
    requestId: row.request_id,
  };
}

export function createPostgresLocationConfirmationStore(): LocationConfirmationStore {
  return {
    async save(candidates) {
      for (const candidate of candidates) {
        await getPool().query(
          `INSERT INTO location_confirmation_candidates (
             id, channel, owner_key, entered_address, formatted_address, latitude, longitude,
             province, city, suburb, place_id, result_type, confidence, match_type, expires_at,
             confirmed_at, request_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            candidate.id, candidate.channel, candidate.ownerKey, candidate.enteredAddress,
            candidate.formattedAddress, candidate.latitude, candidate.longitude,
            candidate.province ?? null, candidate.city ?? null, candidate.suburb ?? null,
            candidate.placeId ?? null, candidate.resultType ?? null, candidate.confidence ?? null,
            candidate.matchType ?? null, candidate.expiresAt, candidate.confirmedAt, candidate.requestId,
          ],
        );
      }
    },

    async get(id) {
      const result = await getPool().query<CandidateRow>(
        `SELECT id, channel, owner_key, entered_address, formatted_address, latitude, longitude,
                province, city, suburb, place_id, result_type, confidence, match_type, expires_at,
                confirmed_at, request_id
         FROM location_confirmation_candidates
         WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    },

    async markConfirmed(id, confirmedAt) {
      await getPool().query(
        `UPDATE location_confirmation_candidates
         SET confirmed_at = COALESCE(confirmed_at, $2), updated_at = now()
         WHERE id = $1`,
        [id, confirmedAt],
      );
    },

    async linkRequest(id, requestId) {
      await getPool().query(
        `UPDATE location_confirmation_candidates
         SET request_id = COALESCE(request_id, $2), updated_at = now()
         WHERE id = $1`,
        [id, requestId],
      );
    },
  };
}

function copy(candidate: StoredLocationCandidate): StoredLocationCandidate {
  return { ...candidate };
}

export function createMemoryLocationConfirmationStore(): LocationConfirmationStore {
  const candidates = new Map<string, StoredLocationCandidate>();
  return {
    async save(entries) {
      for (const entry of entries) candidates.set(entry.id, copy(entry));
    },
    async get(id) {
      const candidate = candidates.get(id);
      return candidate ? copy(candidate) : null;
    },
    async markConfirmed(id, confirmedAt) {
      const candidate = candidates.get(id);
      if (candidate && !candidate.confirmedAt) candidate.confirmedAt = confirmedAt;
    },
    async linkRequest(id, requestId) {
      const candidate = candidates.get(id);
      if (candidate && !candidate.requestId) candidate.requestId = requestId;
    },
  };
}
