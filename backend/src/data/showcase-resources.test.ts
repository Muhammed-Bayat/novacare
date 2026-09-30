import { describe, expect, it } from 'vitest';
import {
  formatShowcaseSeedSummary,
  seedShowcaseResources,
  syntheticAmbulanceFor,
  syntheticResponderFor,
  type ShowcaseAmbulance,
  type ShowcaseFacility,
  type ShowcaseRecordState,
  type ShowcaseResponderPlan,
  type ShowcaseResourceStore,
  type ShowcaseResponder,
  type ShowcaseWriteResult,
} from './showcase-resources.js';

type StoredResponder = ShowcaseResponder & {
  active: boolean;
  onDuty: boolean;
  availability: 'AVAILABLE' | 'BUSY';
  homeVisitEligible: boolean;
};
type StoredAmbulance = ShowcaseAmbulance & { active: boolean; status: 'AVAILABLE' | 'ASSIGNED' };

class FakeShowcaseStore implements ShowcaseResourceStore {
  readonly facilities: Array<ShowcaseFacility & { directoryVisible: boolean }> = [
    { id: 'facility-a', name: 'Central Hospital', active: true, ambulanceAvailable: false, homeVisitAvailable: false, existingResponders: 1, existingAmbulances: 1, directoryVisible: true },
    { id: 'facility-b', name: 'West Hospital', active: true, ambulanceAvailable: true, homeVisitAvailable: false, existingResponders: 0, existingAmbulances: 0, directoryVisible: true },
    { id: 'facility-c', name: 'Inactive Hospital', active: false, ambulanceAvailable: false, homeVisitAvailable: false, existingResponders: 0, existingAmbulances: 0, directoryVisible: true },
  ];
  readonly realResponders = [{ id: 'real-responder', name: 'Existing Doctor', email: 'existing.doctor@example.org', hospitalId: 'facility-a' }];
  readonly realMemberships = [{ id: 'real-membership', userId: 'real-responder', hospitalId: 'facility-a', role: 'doctor' }];
  readonly realAmbulances = [{ id: 'real-ambulance', callsign: 'REAL-1', hospitalId: 'facility-a' }];
  readonly requests = [{ id: 'request-1', facilityId: 'facility-a' }];
  readonly history = [{ id: 'history-1', requestId: 'request-1' }];
  readonly syntheticResponders = new Map<string, StoredResponder>();
  readonly syntheticAmbulances = new Map<string, StoredAmbulance>();
  readonly operations: string[] = [];

  async listFacilities(): Promise<ShowcaseFacility[]> {
    return this.facilities.map((facility) => ({
      id: facility.id,
      name: facility.name,
      active: facility.active,
      ambulanceAvailable: facility.ambulanceAvailable,
      homeVisitAvailable: facility.homeVisitAvailable,
      existingResponders: facility.existingResponders,
      existingAmbulances: facility.existingAmbulances,
    }));
  }

  async responderPlan(responder: ShowcaseResponder): Promise<ShowcaseResponderPlan> {
    const exists = this.syntheticResponders.has(responder.auth0Subject);
    return { syntheticUser: exists ? 'present' : 'missing', membership: exists ? 'present' : 'missing' };
  }

  async ambulanceState(ambulance: ShowcaseAmbulance): Promise<ShowcaseRecordState> {
    return this.syntheticAmbulances.has(ambulance.callsign) ? 'present' : 'missing';
  }

  async enableDispatchCapabilities(facilityId: string): Promise<void> {
    this.operations.push('UPDATE_CAPABILITIES');
    const facility = this.facilities.find((item) => item.id === facilityId);
    if (!facility) throw new Error('Facility not found');
    facility.ambulanceAvailable = true;
    facility.homeVisitAvailable = true;
  }

  async ensureResponder(responder: ShowcaseResponder): Promise<ShowcaseResponderPlan> {
    const existing = this.syntheticResponders.get(responder.auth0Subject);
    if (existing) {
      this.operations.push('RESTORE_RESPONDER');
      Object.assign(existing, { active: true, onDuty: true, availability: 'AVAILABLE', homeVisitEligible: true });
      return { syntheticUser: 'present', membership: 'present' };
    }
    this.operations.push('INSERT_RESPONDER');
    this.syntheticResponders.set(responder.auth0Subject, {
      ...responder,
      active: true,
      onDuty: true,
      availability: 'AVAILABLE',
      homeVisitEligible: true,
    });
    return { syntheticUser: 'missing', membership: 'missing' };
  }

  async ensureAmbulance(ambulance: ShowcaseAmbulance): Promise<ShowcaseWriteResult> {
    const existing = this.syntheticAmbulances.get(ambulance.callsign);
    if (existing) {
      this.operations.push('RESTORE_AMBULANCE');
      Object.assign(existing, { active: true, status: 'AVAILABLE' });
      return 'reused';
    }
    this.operations.push('INSERT_AMBULANCE');
    this.syntheticAmbulances.set(ambulance.callsign, { ...ambulance, active: true, status: 'AVAILABLE' });
    return 'created';
  }
}

describe('showcase resource seed', () => {
  it('adds deterministic eligible resources alongside existing records without deleting or replacing them', async () => {
    const store = new FakeShowcaseStore();
    const realSnapshot = structuredClone({
      responders: store.realResponders,
      memberships: store.realMemberships,
      ambulances: store.realAmbulances,
      requests: store.requests,
      history: store.history,
      hospitals: store.facilities.map((facility) => ({ id: facility.id, name: facility.name, active: facility.active })),
      inactive: store.facilities[2],
    });

    const summary = await seedShowcaseResources(store);

    expect(summary).toMatchObject({
      facilitiesInspected: 3,
      activeFacilities: 2,
      inactiveFacilitiesSkipped: 1,
      respondersCreated: 6,
      ambulancesCreated: 4,
      capabilityFlagsEnabled: 3,
      capabilityFacilitiesUpdated: 2,
      syntheticUsersCreated: 6,
      membershipsCreated: 6,
      recordsToDelete: 0,
    });
    expect(store.syntheticResponders.size).toBe(6);
    expect(store.syntheticAmbulances.size).toBe(4);
    expect([...store.syntheticResponders.values()].every((responder) =>
      responder.active && responder.onDuty && responder.availability === 'AVAILABLE' && responder.homeVisitEligible
        && responder.email.endsWith('@novacare.invalid') && responder.displayName.startsWith('Doctor '),
    )).toBe(true);
    expect([...store.syntheticAmbulances.values()].every((ambulance) => ambulance.active && ambulance.status === 'AVAILABLE')).toBe(true);
    expect({
      responders: store.realResponders,
      memberships: store.realMemberships,
      ambulances: store.realAmbulances,
      requests: store.requests,
      history: store.history,
      hospitals: store.facilities.map((facility) => ({ id: facility.id, name: facility.name, active: facility.active })),
      inactive: store.facilities[2],
    }).toEqual(realSnapshot);
    expect(store.facilities[0]).toMatchObject({ ambulanceAvailable: true, homeVisitAvailable: true, directoryVisible: true });
    expect(store.facilities[1]).toMatchObject({ ambulanceAvailable: true, homeVisitAvailable: true, directoryVisible: true });
    expect(store.operations).not.toContain('DELETE');
    expect(summary.facilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ facilityName: 'Central Hospital', existingResponders: 1, existingAmbulances: 1, respondersToCreate: 3, ambulancesToCreate: 2 }),
    ]));
    expect(summary.skippedFacilities).toEqual([{ facilityId: 'facility-c', facilityName: 'Inactive Hospital', reason: 'INACTIVE' }]);
  });

  it('is idempotent, restores only showcase-owned availability, and does not recreate records', async () => {
    const store = new FakeShowcaseStore();
    await seedShowcaseResources(store);
    const responder = store.syntheticResponders.values().next().value as StoredResponder;
    const ambulance = store.syntheticAmbulances.values().next().value as StoredAmbulance;
    responder.active = false;
    responder.onDuty = false;
    responder.availability = 'BUSY';
    ambulance.active = false;
    ambulance.status = 'ASSIGNED';
    const responderKeys = [...store.syntheticResponders.keys()];
    const ambulanceKeys = [...store.syntheticAmbulances.keys()];

    const summary = await seedShowcaseResources(store);

    expect(summary).toMatchObject({ syntheticUsersCreated: 0, syntheticUsersReused: 6, membershipsCreated: 0, membershipsReused: 6, respondersCreated: 0, respondersReused: 6, ambulancesCreated: 0, ambulancesReused: 4 });
    expect([...store.syntheticResponders.keys()]).toEqual(responderKeys);
    expect([...store.syntheticAmbulances.keys()]).toEqual(ambulanceKeys);
    expect(responder).toMatchObject({ active: true, onDuty: true, availability: 'AVAILABLE', homeVisitEligible: true });
    expect(ambulance).toMatchObject({ active: true, status: 'AVAILABLE' });
    expect(store.operations).not.toContain('DELETE');
  });

  it('reports planned work without writing during dry runs', async () => {
    const store = new FakeShowcaseStore();
    const summary = await seedShowcaseResources(store, { dryRun: true });

    expect(summary).toMatchObject({ syntheticUsersCreated: 6, membershipsCreated: 6, respondersCreated: 6, ambulancesCreated: 4, capabilityFlagsEnabled: 3, recordsToDelete: 0 });
    expect(store.syntheticResponders.size).toBe(0);
    expect(store.syntheticAmbulances.size).toBe(0);
    expect(store.facilities[0]).toMatchObject({ ambulanceAvailable: false, homeVisitAvailable: false });
    expect(store.operations).toEqual([]);
    expect(formatShowcaseSeedSummary(summary)).toEqual(expect.arrayContaining([
      'Existing records preserved: YES',
      'Records to delete: 0',
      'No database writes performed.',
    ]));
  });

  it('uses stable IDs and produces resources that satisfy normal matching requirements', () => {
    const facility = {
      id: 'f7d7d2c3-9c4d-4b21-a6e3-123456789abc',
      name: 'Central Hospital',
      active: true,
      ambulanceAvailable: true,
      homeVisitAvailable: true,
      existingResponders: 0,
      existingAmbulances: 0,
    };
    const responder = syntheticResponderFor(facility, 1);
    const ambulance = syntheticAmbulanceFor(facility, 1);

    expect(syntheticResponderFor(facility, 1)).toEqual(responder);
    expect(syntheticAmbulanceFor(facility, 1)).toEqual(ambulance);
    expect(responder).toMatchObject({
      auth0Subject: 'synthetic:showcase:facility:f7d7d2c3-9c4d-4b21-a6e3-123456789abc:doctor:01',
      email: 'doctor-f7d7d2c3-9c4d-4b21-a6e3-123456789abc-01@novacare.invalid',
    });
    expect(ambulance.callsign).toBe('AMB-NC-F7D7D2C39C4D4B21A6E3123456789ABC-01');
  });
});
