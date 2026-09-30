export const SYNTHETIC_RESPONDERS_PER_FACILITY = 3;
export const SYNTHETIC_AMBULANCES_PER_FACILITY = 2;

export interface ShowcaseFacility {
  id: string;
  name: string;
  active: boolean;
  ambulanceAvailable: boolean;
  homeVisitAvailable: boolean;
  existingResponders: number;
  existingAmbulances: number;
}

export interface ShowcaseResponder {
  facilityId: string;
  sequence: number;
  auth0Subject: string;
  email: string;
  displayName: string;
}

export interface ShowcaseAmbulance {
  facilityId: string;
  sequence: number;
  callsign: string;
}

export type ShowcaseRecordState = 'missing' | 'present';
export type ShowcaseWriteResult = 'created' | 'reused';

export interface ShowcaseResponderPlan {
  syntheticUser: ShowcaseRecordState;
  membership: ShowcaseRecordState;
}

/** Database operations required by the seed. Implementations must never delete records. */
export interface ShowcaseResourceStore {
  listFacilities(): Promise<ShowcaseFacility[]>;
  responderPlan(responder: ShowcaseResponder): Promise<ShowcaseResponderPlan>;
  ambulanceState(ambulance: ShowcaseAmbulance): Promise<ShowcaseRecordState>;
  enableDispatchCapabilities(facilityId: string): Promise<void>;
  ensureResponder(responder: ShowcaseResponder): Promise<ShowcaseResponderPlan>;
  ensureAmbulance(ambulance: ShowcaseAmbulance): Promise<ShowcaseWriteResult>;
}

export interface ShowcaseSeedOptions {
  dryRun?: boolean;
}

export interface ShowcaseSeedSummary {
  dryRun: boolean;
  facilitiesInspected: number;
  activeFacilities: number;
  inactiveFacilitiesSkipped: number;
  activeFacilitiesSeeded: number;
  existingRespondersUntouched: number;
  existingAmbulancesUntouched: number;
  hospitalsWithoutAmbulanceCapability: number;
  hospitalsWithoutHomeVisitCapability: number;
  capabilityFlagsEnabled: number;
  capabilityFacilitiesUpdated: number;
  syntheticUsersCreated: number;
  syntheticUsersReused: number;
  membershipsCreated: number;
  membershipsReused: number;
  respondersCreated: number;
  respondersReused: number;
  ambulancesCreated: number;
  ambulancesReused: number;
  facilities: ShowcaseFacilitySummary[];
  skippedFacilities: ShowcaseSkippedFacility[];
  recordsToDelete: 0;
}

export interface ShowcaseFacilitySummary {
  facilityId: string;
  facilityName: string;
  existingResponders: number;
  existingAmbulances: number;
  syntheticUsersToCreate: number;
  syntheticUsersToReuse: number;
  respondersToCreate: number;
  respondersToReuse: number;
  membershipsToCreate: number;
  membershipsToReuse: number;
  ambulancesToCreate: number;
  ambulancesToReuse: number;
  ambulanceCapabilityCurrent: boolean;
  ambulanceCapabilityProposed: boolean;
  homeVisitCapabilityCurrent: boolean;
  homeVisitCapabilityProposed: boolean;
}

export interface ShowcaseSkippedFacility {
  facilityId: string;
  facilityName: string;
  reason: 'INACTIVE';
}

function sequenceLabel(sequence: number): string {
  return String(sequence).padStart(2, '0');
}

function facilityKey(facilityId: string): string {
  return facilityId.replaceAll('-', '').toUpperCase();
}

export function syntheticResponderFor(facility: ShowcaseFacility, sequence: number): ShowcaseResponder {
  const label = String.fromCharCode(64 + sequence);
  const sequencePart = sequenceLabel(sequence);
  return {
    facilityId: facility.id,
    sequence,
    auth0Subject: `synthetic:showcase:facility:${facility.id}:doctor:${sequencePart}`,
    email: `doctor-${facility.id}-${sequencePart}@novacare.invalid`,
    displayName: `Doctor ${label} - ${facility.name}`,
  };
}

export function syntheticAmbulanceFor(facility: ShowcaseFacility, sequence: number): ShowcaseAmbulance {
  return {
    facilityId: facility.id,
    sequence,
    // The namespace plus a stable facility key identifies records owned by this seed.
    callsign: `AMB-NC-${facilityKey(facility.id)}-${sequenceLabel(sequence)}`,
  };
}

function addResponderPlan(
  summary: ShowcaseSeedSummary,
  facility: ShowcaseFacilitySummary,
  plan: ShowcaseResponderPlan,
): void {
  if (plan.syntheticUser === 'missing') {
    summary.syntheticUsersCreated += 1;
    facility.syntheticUsersToCreate += 1;
  } else {
    summary.syntheticUsersReused += 1;
    facility.syntheticUsersToReuse += 1;
  }
  if (plan.membership === 'missing') {
    summary.respondersCreated += 1;
    summary.membershipsCreated += 1;
    facility.respondersToCreate += 1;
    facility.membershipsToCreate += 1;
  } else {
    summary.respondersReused += 1;
    summary.membershipsReused += 1;
    facility.respondersToReuse += 1;
    facility.membershipsToReuse += 1;
  }
}

function addAmbulanceResult(summary: ShowcaseSeedSummary, facility: ShowcaseFacilitySummary, result: ShowcaseWriteResult): void {
  if (result === 'created') summary.ambulancesCreated += 1;
  else summary.ambulancesReused += 1;
  if (result === 'created') facility.ambulancesToCreate += 1;
  else facility.ambulancesToReuse += 1;
}

/** Adds or restores only deterministic records owned by this showcase seed. */
export async function seedShowcaseResources(
  store: ShowcaseResourceStore,
  options: ShowcaseSeedOptions = {},
): Promise<ShowcaseSeedSummary> {
  const dryRun = options.dryRun ?? false;
  const facilities = await store.listFacilities();
  const activeFacilities = facilities.filter((facility) => facility.active);
  const summary: ShowcaseSeedSummary = {
    dryRun,
    facilitiesInspected: facilities.length,
    activeFacilities: activeFacilities.length,
    inactiveFacilitiesSkipped: facilities.length - activeFacilities.length,
    activeFacilitiesSeeded: activeFacilities.length,
    existingRespondersUntouched: facilities.reduce((total, facility) => total + facility.existingResponders, 0),
    existingAmbulancesUntouched: facilities.reduce((total, facility) => total + facility.existingAmbulances, 0),
    hospitalsWithoutAmbulanceCapability: activeFacilities.filter((facility) => !facility.ambulanceAvailable).length,
    hospitalsWithoutHomeVisitCapability: activeFacilities.filter((facility) => !facility.homeVisitAvailable).length,
    capabilityFlagsEnabled: 0,
    capabilityFacilitiesUpdated: 0,
    syntheticUsersCreated: 0,
    syntheticUsersReused: 0,
    membershipsCreated: 0,
    membershipsReused: 0,
    respondersCreated: 0,
    respondersReused: 0,
    ambulancesCreated: 0,
    ambulancesReused: 0,
    facilities: [],
    skippedFacilities: facilities.filter((facility) => !facility.active).map((facility) => ({
      facilityId: facility.id,
      facilityName: facility.name,
      reason: 'INACTIVE',
    })),
    recordsToDelete: 0,
  };

  for (const facility of activeFacilities) {
    const facilitySummary: ShowcaseFacilitySummary = {
      facilityId: facility.id,
      facilityName: facility.name,
      existingResponders: facility.existingResponders,
      existingAmbulances: facility.existingAmbulances,
      syntheticUsersToCreate: 0,
      syntheticUsersToReuse: 0,
      respondersToCreate: 0,
      respondersToReuse: 0,
      membershipsToCreate: 0,
      membershipsToReuse: 0,
      ambulancesToCreate: 0,
      ambulancesToReuse: 0,
      ambulanceCapabilityCurrent: facility.ambulanceAvailable,
      ambulanceCapabilityProposed: true,
      homeVisitCapabilityCurrent: facility.homeVisitAvailable,
      homeVisitCapabilityProposed: true,
    };
    summary.facilities.push(facilitySummary);
    const capabilityFlagsNeeded = Number(!facility.ambulanceAvailable) + Number(!facility.homeVisitAvailable);
    if (capabilityFlagsNeeded > 0) {
      summary.capabilityFlagsEnabled += capabilityFlagsNeeded;
      summary.capabilityFacilitiesUpdated += 1;
      if (!dryRun) await store.enableDispatchCapabilities(facility.id);
    }

    for (let sequence = 1; sequence <= SYNTHETIC_RESPONDERS_PER_FACILITY; sequence += 1) {
      const responder = syntheticResponderFor(facility, sequence);
      addResponderPlan(summary, facilitySummary, dryRun ? await store.responderPlan(responder) : await store.ensureResponder(responder));
    }

    for (let sequence = 1; sequence <= SYNTHETIC_AMBULANCES_PER_FACILITY; sequence += 1) {
      const ambulance = syntheticAmbulanceFor(facility, sequence);
      addAmbulanceResult(summary, facilitySummary, dryRun
        ? (await store.ambulanceState(ambulance)) === 'missing' ? 'created' : 'reused'
        : await store.ensureAmbulance(ambulance));
    }
  }

  return summary;
}

export function formatShowcaseSeedSummary(summary: ShowcaseSeedSummary): string[] {
  const action = summary.dryRun ? 'to create' : 'created';
  const capabilityAction = summary.dryRun ? 'to enable' : 'enabled';
  return [
    `[seed:showcase-resources] ${summary.dryRun ? 'Dry run' : 'Completed'}`,
    'Existing records preserved: YES',
    `Hospitals inspected: ${summary.facilitiesInspected}`,
    `Active hospitals: ${summary.activeFacilities}`,
    `Inactive hospitals skipped: ${summary.inactiveFacilitiesSkipped}`,
    `Existing non-showcase responders untouched: ${summary.existingRespondersUntouched}`,
    `Existing non-showcase ambulances untouched: ${summary.existingAmbulancesUntouched}`,
    `Active hospitals with ambulance_available = false: ${summary.hospitalsWithoutAmbulanceCapability}`,
    `Active hospitals with home_visit_available = false: ${summary.hospitalsWithoutHomeVisitCapability}`,
    `Synthetic local-user rows ${action}: ${summary.syntheticUsersCreated}`,
    `Synthetic local-user rows reused: ${summary.syntheticUsersReused}`,
    `Memberships ${action}: ${summary.membershipsCreated}`,
    `Memberships reused: ${summary.membershipsReused}`,
    `Synthetic responders ${action}: ${summary.respondersCreated}`,
    `Synthetic responders already present: ${summary.respondersReused}`,
    `Synthetic ambulances ${action}: ${summary.ambulancesCreated}`,
    `Synthetic ambulances already present: ${summary.ambulancesReused}`,
    `Capability flags ${capabilityAction}: ${summary.capabilityFlagsEnabled} across ${summary.capabilityFacilitiesUpdated} hospitals`,
    `Records to delete: ${summary.recordsToDelete}`,
    ...summary.facilities.flatMap((facility) => [
      `Facility: ${facility.facilityName}`,
      `  Existing responders / ambulances: ${facility.existingResponders} / ${facility.existingAmbulances}`,
      `  Showcase users create / reuse: ${facility.syntheticUsersToCreate} / ${facility.syntheticUsersToReuse}`,
      `  Showcase responders create / reuse: ${facility.respondersToCreate} / ${facility.respondersToReuse}`,
      `  Memberships create / reuse: ${facility.membershipsToCreate} / ${facility.membershipsToReuse}`,
      `  Showcase ambulances create / reuse: ${facility.ambulancesToCreate} / ${facility.ambulancesToReuse}`,
      `  Ambulance capability: ${String(facility.ambulanceCapabilityCurrent)} -> ${String(facility.ambulanceCapabilityProposed)}`,
      `  Home-visit capability: ${String(facility.homeVisitCapabilityCurrent)} -> ${String(facility.homeVisitCapabilityProposed)}`,
    ]),
    ...summary.skippedFacilities.map((facility) => `Skipped facility: ${facility.facilityName} (${facility.reason})`),
    summary.dryRun ? 'No database writes performed.' : 'Errors: 0',
  ];
}
