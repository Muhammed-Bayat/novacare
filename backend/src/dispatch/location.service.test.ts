import { describe, expect, it } from 'vitest';
import {
  createHaversineLocationService,
  expandRadiusUntilCovered,
  haversineKm,
  loadRadiusConfig,
  type FacilityCandidate,
  type RadiusExpansionConfig,
} from './location.service.js';

const ORIGIN = { latitude: -26.1076, longitude: 28.0567 }; // Sandton demo hospital

function facility(id: string, latitude: number, longitude: number, caps: Partial<Pick<FacilityCandidate, 'ambulanceAvailable' | 'homeVisitAvailable'>> = {}): FacilityCandidate {
  return {
    id,
    name: `Facility ${id}`,
    latitude,
    longitude,
    ambulanceAvailable: caps.ambulanceAvailable ?? true,
    homeVisitAvailable: caps.homeVisitAvailable ?? true,
  };
}

// Approximate offsets: 0.01° latitude ≈ 1.11 km; at 26°S, 0.01° longitude ≈ 1.00 km.
const NEAR = facility('near', -26.1076, 28.0567 + 0.03); // ~3.0 km
const MID = facility('mid', -26.1076 + 0.07, 28.0567); // ~7.8 km
const FAR = facility('far', -26.1076 + 0.13, 28.0567); // ~14.5 km
const VERY_FAR = facility('very-far', -26.1076 + 0.3, 28.0567); // ~33 km

const CONFIG: RadiusExpansionConfig = { initialRadiusKm: 5, radiusIncrementKm: 5, minFacilities: 3, maxRadiusKm: 50 };

describe('haversine location service', () => {
  it('computes ~0 km for identical points', () => {
    expect(haversineKm(ORIGIN, ORIGIN)).toBe(0);
  });

  it('computes a known Johannesburg distance', () => {
    const sandtonToRosebank = haversineKm({ latitude: -26.1076, longitude: 28.0567 }, { latitude: -26.1467, longitude: 28.0417 });
    expect(sandtonToRosebank).toBeGreaterThan(4);
    expect(sandtonToRosebank).toBeLessThan(5.5);
  });

  it('is symmetric', () => {
    const a = haversineKm(NEAR, FAR);
    const b = haversineKm(FAR, NEAR);
    expect(a).toBeCloseTo(b, 10);
  });

  it('returns kilometres, not metres', () => {
    const service = createHaversineLocationService();
    expect(service.distanceKm(ORIGIN, MID)).toBeGreaterThan(5);
    expect(service.distanceKm(ORIGIN, MID)).toBeLessThan(10);
  });
});

describe('radius expansion', () => {
  it('stays at the initial radius when 3 capable facilities are within 5 km', () => {
    const candidates = [NEAR, facility('n2', -26.1076, 28.0567 + 0.04), facility('n3', -26.1076 + 0.04, 28.0567)];
    const result = expandRadiusUntilCovered(candidates, ORIGIN, 'AMBULANCE', CONFIG);
    expect(result.radiusKm).toBe(5);
    expect(result.exhausted).toBe(false);
    expect(result.selected).toHaveLength(3);
  });

  it('expands 5 → 10 km when fewer than 3 are within 5 km but 3 are within 10 km', () => {
    const candidates = [NEAR, MID, facility('n2', -26.1076, 28.0567 + 0.04)];
    const result = expandRadiusUntilCovered(candidates, ORIGIN, 'AMBULANCE', CONFIG);
    expect(result.radiusKm).toBe(10);
    expect(result.selected.map((f) => f.id)).toEqual(['near', 'n2', 'mid']);
    expect(result.exhausted).toBe(false);
  });

  it('returns every eligible facility in the final 10 km search radius, not only the minimum three', () => {
    const candidates = [
      NEAR,
      MID,
      facility('n2', -26.1076, 28.0567 + 0.04),
      facility('n3', -26.1076 - 0.0756, 28.0567),
    ];
    const result = expandRadiusUntilCovered(candidates, ORIGIN, 'AMBULANCE', CONFIG);
    expect(result.radiusKm).toBe(10);
    expect(result.selected).toHaveLength(4);
  });

  it('keeps expanding until min facilities or max radius', () => {
    const candidates = [NEAR, MID, FAR, VERY_FAR];
    const result = expandRadiusUntilCovered(candidates, ORIGIN, 'AMBULANCE', CONFIG);
    expect(result.radiusKm).toBe(15);
    expect(result.selected).toHaveLength(3);
    expect(result.exhausted).toBe(false);
  });

  it('caps at max radius and flags exhaustion when fewer than min remain', () => {
    const candidates = [NEAR, MID];
    const config = { ...CONFIG, maxRadiusKm: 10 };
    const result = expandRadiusUntilCovered(candidates, ORIGIN, 'AMBULANCE', config);
    expect(result.radiusKm).toBe(10);
    expect(result.exhausted).toBe(true);
    expect(result.selected).toHaveLength(2);
  });

  it('orders results by distance ascending with no duplicates', () => {
    const candidates = [FAR, NEAR, MID, { ...NEAR }];
    const result = expandRadiusUntilCovered(candidates, ORIGIN, 'AMBULANCE', CONFIG);
    const ids = result.selected.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < result.selected.length; i += 1) {
      expect(result.selected[i].distanceKm).toBeGreaterThanOrEqual(result.selected[i - 1].distanceKm);
    }
  });

  it('filters by request capability', () => {
    const ambulanceOnly = facility('amb-only', -26.1076, 28.0567 + 0.03, { ambulanceAvailable: true, homeVisitAvailable: false });
    const homeVisitOnly = facility('hv-only', -26.1076, 28.0567 + 0.035, { ambulanceAvailable: false, homeVisitAvailable: true });
    const both = facility('both', -26.1076, 28.0567 + 0.04);
    const candidates = [ambulanceOnly, homeVisitOnly, both, MID, FAR];

    const ambulance = expandRadiusUntilCovered(candidates, ORIGIN, 'AMBULANCE', CONFIG);
    expect(ambulance.selected.map((f) => f.id)).toContain('amb-only');
    expect(ambulance.selected.map((f) => f.id)).not.toContain('hv-only');

    const homeVisit = expandRadiusUntilCovered(candidates, ORIGIN, 'HOME_VISIT', CONFIG);
    expect(homeVisit.selected.map((f) => f.id)).toContain('hv-only');
    expect(homeVisit.selected.map((f) => f.id)).not.toContain('amb-only');
  });

  it('returns an empty selection when nothing is capable', () => {
    const incapable = facility('none', -26.1076, 28.0567, { ambulanceAvailable: false, homeVisitAvailable: false });
    const result = expandRadiusUntilCovered([incapable], ORIGIN, 'AMBULANCE', CONFIG);
    expect(result.selected).toEqual([]);
    expect(result.exhausted).toBe(true);
  });
});

describe('radius config', () => {
  it('defaults to 5 km initial / 5 km increment / 3 minimum / 50 km max', () => {
    expect(loadRadiusConfig({})).toEqual({ initialRadiusKm: 5, radiusIncrementKm: 5, minFacilities: 3, maxRadiusKm: 50 });
  });

  it('reads overrides from the environment', () => {
    expect(
      loadRadiusConfig({
        DISPATCH_INITIAL_RADIUS_KM: '3',
        DISPATCH_RADIUS_INCREMENT_KM: '2',
        DISPATCH_MIN_FACILITIES: '4',
        DISPATCH_MAX_RADIUS_KM: '20',
      }),
    ).toEqual({ initialRadiusKm: 3, radiusIncrementKm: 2, minFacilities: 4, maxRadiusKm: 20 });
  });

  it('falls back to defaults for invalid values', () => {
    expect(loadRadiusConfig({ DISPATCH_INITIAL_RADIUS_KM: 'nope', DISPATCH_MAX_RADIUS_KM: '-5' }).initialRadiusKm).toBe(5);
    expect(loadRadiusConfig({ DISPATCH_MAX_RADIUS_KM: '-5' }).maxRadiusKm).toBe(50);
  });

  it('caps an initial radius that exceeds the configured maximum', () => {
    expect(loadRadiusConfig({ DISPATCH_INITIAL_RADIUS_KM: '25', DISPATCH_MAX_RADIUS_KM: '10' })).toMatchObject({ initialRadiusKm: 10, maxRadiusKm: 10 });
  });
});
