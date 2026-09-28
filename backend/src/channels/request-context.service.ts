import { getPool } from '../db.js';

export interface ChannelRequester {
  userId: string | null;
  savedAddress: string | null;
}

export interface ChannelLocation {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ChannelRequestContext {
  resolveRequester(phoneNumber: string): Promise<ChannelRequester>;
  resolveLocation(address: string): Promise<ChannelLocation>;
}

/** Keeps callback identities consistent without exposing the raw provider format to SQL lookups. */
export function normalizePhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : value.trim();
}

function coordinatePair(value: string): Pick<ChannelLocation, 'latitude' | 'longitude'> | null {
  const match = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function createChannelRequestContext(): ChannelRequestContext {
  return {
    async resolveRequester(phoneNumber) {
      const digits = normalizePhoneNumber(phoneNumber).replace(/\D/g, '');
      if (!digits) return { userId: null, savedAddress: null };
      const result = await getPool().query<{
        user_id: string;
        home_address: string | null;
        health_data_consent: boolean;
      }>(
        `SELECT pp.user_id, pp.home_address, pp.health_data_consent
         FROM patient_profiles pp
         WHERE regexp_replace(COALESCE(pp.phone, ''), '\\D', '', 'g') = $1
         ORDER BY pp.updated_at DESC
         LIMIT 2`,
        [digits],
      );
      // Ambiguous phone records are deliberately not linked to a patient account.
      if (result.rows.length !== 1) return { userId: null, savedAddress: null };
      const profile = result.rows[0];
      return {
        userId: profile.user_id,
        savedAddress: profile.health_data_consent ? profile.home_address : null,
      };
    },

    async resolveLocation(address) {
      const trimmed = address.trim().slice(0, 320);
      const coordinates = coordinatePair(trimmed);
      if (coordinates) return { address: trimmed, ...coordinates };

      // This prototype resolves only known simulated areas. It never fabricates a
      // real-world coordinate for an unmatched free-text address.
      const search = trimmed.replace(/^demo\s+/i, '');
      if (!search) return { address: trimmed, latitude: null, longitude: null };
      const result = await getPool().query<{ latitude: number; longitude: number }>(
        `SELECT latitude, longitude
         FROM hospitals
         WHERE active AND latitude IS NOT NULL AND longitude IS NOT NULL
           AND (
             lower(address) LIKE '%' || lower($1) || '%'
             OR lower($1) LIKE '%' || lower(address) || '%'
             OR lower(name) LIKE '%' || lower($1) || '%'
           )
         ORDER BY CASE WHEN name = 'NovaCare Demo Hospital' THEN 0 ELSE 1 END, name
         LIMIT 1`,
        [search],
      );
      const match = result.rows[0];
      return {
        address: trimmed,
        latitude: match?.latitude ?? null,
        longitude: match?.longitude ?? null,
      };
    },
  };
}
