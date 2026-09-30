import { describe, expect, it } from 'vitest';
import {
  applyLegacyFacilityCleanup,
  type FacilityNameRenameInput,
  formatLegacyFacilityCleanupPlan,
  planLegacyFacilityCleanup,
  type FacilityNameRecord,
  type LegacyFacilityNameStore,
} from './legacy-facility-names.js';

type Facility = FacilityNameRecord & {
  latitude: number;
  longitude: number;
  ambulanceAvailable: boolean;
  homeVisitAvailable: boolean;
  memberships: string[];
  responders: string[];
  ambulances: string[];
  requests: string[];
  history: string[];
};

class FakeFacilityStore implements LegacyFacilityNameStore {
  readonly facilities: Facility[] = [
    {
      id: 'legacy-demo', name: 'NovaCare Demo Hospital', latitude: -26.1, longitude: 28.1,
      ambulanceAvailable: true, homeVisitAvailable: false, memberships: ['m1'], responders: ['r1'], ambulances: ['a1'], requests: ['q1'], history: ['h1'],
    },
    {
      id: 'legacy-simulated', name: 'Simulated Facility — Rosebank Response Centre', latitude: -26.2, longitude: 28.2,
      ambulanceAvailable: false, homeVisitAvailable: true, memberships: ['m2'], responders: ['r2'], ambulances: ['a2'], requests: ['q2'], history: ['h2'],
    },
    {
      id: 'legitimate', name: 'Johannesburg General Hospital', latitude: -26.3, longitude: 28.3,
      ambulanceAvailable: true, homeVisitAvailable: true, memberships: ['m3'], responders: ['r3'], ambulances: ['a3'], requests: ['q3'], history: ['h3'],
    },
  ];
  readonly operations: string[] = [];

  async listFacilityNames(): Promise<FacilityNameRecord[]> {
    return this.facilities.map(({ id, name }) => ({ id, name }));
  }

  async renameFacility(rename: FacilityNameRenameInput): Promise<void> {
    const facility = this.facilities.find((item) => item.id === rename.facilityId && item.name === rename.currentName);
    if (!facility) throw new Error('Facility changed');
    this.operations.push('UPDATE_NAME');
    facility.name = rename.proposedName;
  }
}

describe('legacy facility name cleanup', () => {
  it('detects legacy names and changes only names, preserving identifiers and relationships', async () => {
    const store = new FakeFacilityStore();
    const before = structuredClone(store.facilities);
    const plan = planLegacyFacilityCleanup(await store.listFacilityNames());

    expect(plan).toMatchObject({ facilitiesInspected: 3, recordsToDelete: 0, relationshipsAffected: 0 });
    expect(plan.legacyFacilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ facilityId: 'legacy-demo', proposedName: 'NovaCare Central Hospital', collision: false }),
      expect.objectContaining({ facilityId: 'legacy-simulated', proposedName: 'Rosebank Medical Centre', collision: false }),
    ]));
    expect(plan.legacyFacilities.map((facility) => facility.facilityId)).not.toContain('legitimate');

    await applyLegacyFacilityCleanup(store, plan);

    expect(store.facilities.map((facility) => ({ ...facility, name: undefined }))).toEqual(before.map((facility) => ({ ...facility, name: undefined })));
    expect(store.facilities.find((facility) => facility.id === 'legacy-demo')?.name).toBe('NovaCare Central Hospital');
    expect(store.facilities.find((facility) => facility.id === 'legacy-simulated')?.name).toBe('Rosebank Medical Centre');
    expect(store.facilities.find((facility) => facility.id === 'legitimate')?.name).toBe('Johannesburg General Hospital');
    expect(store.operations).toEqual(['UPDATE_NAME', 'UPDATE_NAME']);
    expect(store.operations).not.toContain('DELETE');
  });

  it('maps every source-defined legacy facility to a neutral visible name', () => {
    const plan = planLegacyFacilityCleanup([
      { id: 'parktown', name: 'Simulated Facility — Parktown Response Centre' },
      { id: 'alberton', name: 'Simulated Facility — Alberton South' },
    ]);

    expect(plan.legacyFacilities).toEqual([
      expect.objectContaining({ proposedName: 'Parktown Medical Centre' }),
      expect.objectContaining({ proposedName: 'Alberton South Medical Centre' }),
    ]);
  });

  it('uses a unique neutral alternative when a target name already exists', () => {
    const plan = planLegacyFacilityCleanup([
      { id: 'legacy-demo', name: 'NovaCare Demo Hospital' },
      { id: 'existing-central', name: 'NovaCare Central Hospital' },
    ]);

    expect(plan.legacyFacilities).toEqual([
      expect.objectContaining({
        facilityId: 'legacy-demo',
        proposedName: 'NovaCare Central Hospital - LEGACYDE',
        collision: true,
        collisionWith: 'NovaCare Central Hospital',
      }),
    ]);
  });

  it('does not write during dry-run planning and becomes idempotent after the name-only cleanup', async () => {
    const store = new FakeFacilityStore();
    const plan = planLegacyFacilityCleanup(await store.listFacilityNames());

    expect(formatLegacyFacilityCleanupPlan(plan, true)).toEqual(expect.arrayContaining([
      'Records to delete: 0',
      'Relationships affected: 0',
      'No database writes performed.',
    ]));
    expect(store.operations).toEqual([]);

    await applyLegacyFacilityCleanup(store, plan);
    const secondPlan = planLegacyFacilityCleanup(await store.listFacilityNames());
    expect(secondPlan.legacyFacilities).toEqual([]);
    expect(secondPlan.recordsToDelete).toBe(0);
  });

  it('refuses a real cleanup when a detected legacy name has no safe proposal', async () => {
    const store = new FakeFacilityStore();
    const plan = planLegacyFacilityCleanup([{ id: 'unknown', name: 'Demo Hospital' }]);

    await expect(applyLegacyFacilityCleanup(store, plan)).rejects.toThrow('needs an explicit neutral name');
    expect(store.operations).toEqual([]);
  });
});
