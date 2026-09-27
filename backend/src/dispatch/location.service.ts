import type { ServiceRequestType } from './domain.js';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface FacilityCandidate extends GeoPoint {
  id: string;
  name: string;
  ambulanceAvailable: boolean;
  homeVisitAvailable: boolean;
}

export interface LocatedFacility extends FacilityCandidate {
  distanceKm: number;
}

/**
 * LocationService abstraction (Dispatch Core §8): Haversine today, PostGIS
 * swappable behind the same interface. Distances are always kilometres.
 */
export interface LocationService {
  distanceKm(a: GeoPoint, b: GeoPoint): number;
}

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function createHaversineLocationService(): LocationService {
  return { distanceKm: haversineKm };
}

export interface RadiusExpansionConfig {
  initialRadiusKm: number;
  radiusIncrementKm: number;
  minFacilities: number;
  maxRadiusKm: number;
}

export const DEFAULT_RADIUS_CONFIG: RadiusExpansionConfig = {
  initialRadiusKm: 5,
  radiusIncrementKm: 5,
  minFacilities: 3,
  maxRadiusKm: 50,
};

export function loadRadiusConfig(env: NodeJS.ProcessEnv = process.env): RadiusExpansionConfig {
  const num = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const maxRadiusKm = num(env.DISPATCH_MAX_RADIUS_KM, DEFAULT_RADIUS_CONFIG.maxRadiusKm);
  return {
    initialRadiusKm: Math.min(num(env.DISPATCH_INITIAL_RADIUS_KM, DEFAULT_RADIUS_CONFIG.initialRadiusKm), maxRadiusKm),
    radiusIncrementKm: num(env.DISPATCH_RADIUS_INCREMENT_KM, DEFAULT_RADIUS_CONFIG.radiusIncrementKm),
    minFacilities: Math.floor(num(env.DISPATCH_MIN_FACILITIES, DEFAULT_RADIUS_CONFIG.minFacilities)),
    maxRadiusKm,
  };
}

export interface RadiusExpansionResult {
  selected: LocatedFacility[];
  radiusKm: number;
  /** True when the search hit MAX_RADIUS_KM before reaching MIN_FACILITIES. */
  exhausted: boolean;
}

/**
 * Expands the radius (INITIAL → +INCREMENT → MAX) until at least MIN_FACILITIES
 * capable facilities fall inside it. Results are deduplicated by facility ID and
 * ordered by distance ascending.
 */
export function expandRadiusUntilCovered(
  candidates: FacilityCandidate[],
  origin: GeoPoint,
  type: ServiceRequestType,
  config: RadiusExpansionConfig,
  location: LocationService = createHaversineLocationService(),
): RadiusExpansionResult {
  if (config.initialRadiusKm <= 0 || config.radiusIncrementKm <= 0 || config.minFacilities <= 0 || config.maxRadiusKm <= 0) {
    throw new Error('Dispatch radius configuration must use positive values.');
  }
  const capable = candidates.filter((facility) =>
    type === 'AMBULANCE' ? facility.ambulanceAvailable : facility.homeVisitAvailable,
  );
  const within = new Map<string, LocatedFacility>();
  let radiusKm = Math.min(config.initialRadiusKm, config.maxRadiusKm);
  let exhausted = false;

  for (;;) {
    for (const facility of capable) {
      if (within.has(facility.id)) continue;
      const distanceKm = location.distanceKm(origin, facility);
      if (distanceKm <= radiusKm) within.set(facility.id, { ...facility, distanceKm });
    }
    if (within.size >= config.minFacilities || radiusKm >= config.maxRadiusKm) {
      exhausted = within.size < config.minFacilities && radiusKm >= config.maxRadiusKm;
      break;
    }
    radiusKm = Math.min(radiusKm + config.radiusIncrementKm, config.maxRadiusKm);
  }

  const selected = [...within.values()].sort((a, b) => a.distanceKm - b.distanceKm);
  return { selected, radiusKm, exhausted };
}
