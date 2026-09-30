export interface FacilityNameRecord {
  id: string;
  name: string;
}

export interface LegacyFacilityRename {
  facilityId: string;
  currentName: string;
  proposedName: string | null;
  collision: boolean;
  collisionWith: string | null;
  reason: 'LEGACY_PATTERN' | 'NEEDS_MAPPING';
}

export interface LegacyFacilityCleanupPlan {
  facilitiesInspected: number;
  legacyFacilities: LegacyFacilityRename[];
  recordsToDelete: 0;
  relationshipsAffected: 0;
}

export interface FacilityNameRenameInput {
  facilityId: string;
  currentName: string;
  proposedName: string;
}

export interface LegacyFacilityNameStore {
  listFacilityNames(): Promise<FacilityNameRecord[]>;
  renameFacility(rename: FacilityNameRenameInput): Promise<void>;
}

const KNOWN_RENAMES: Readonly<Record<string, string>> = {
  'NovaCare Demo Hospital': 'NovaCare Central Hospital',
  'Simulated Facility — Alberton South': 'Alberton South Medical Centre',
  'Simulated Facility — Diepkloof Community': 'Diepkloof Community Hospital',
  'Simulated Facility — Fourways North': 'Fourways North Medical Centre',
  'Simulated Facility — Germiston East': 'Germiston East Hospital',
  'Simulated Facility — Johannesburg CBD Clinic': 'Johannesburg CBD Clinic',
  'Simulated Facility — Krugersdorp West': 'Krugersdorp West Medical Centre',
  'Simulated Facility — Midrand Gateway': 'Midrand Gateway Medical Centre',
  'Simulated Facility — Parktown Response Centre': 'Parktown Medical Centre',
  'Simulated Facility — Randburg Care Station': 'Randburg Care Centre',
  'Simulated Facility — Roodepoort West': 'Roodepoort West Medical Centre',
  'Simulated Facility — Rosebank Response Centre': 'Rosebank Medical Centre',
};

const LEGACY_NAME_PATTERN = /\b(?:demo|simulated|simulation)\b|\btest\s+facility\b/i;
const PREFIX_PATTERN = /^(?:simulated|simulation|demo|test)\s+facility\s*[-—]\s*(.+)$/i;

function normalizedName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function neutralProposal(name: string): string | null {
  const known = KNOWN_RENAMES[name];
  if (known) return known;
  const prefix = name.match(PREFIX_PATTERN)?.[1]?.trim();
  if (!prefix || LEGACY_NAME_PATTERN.test(prefix)) return null;
  return prefix;
}

function uniqueAlternative(baseName: string, facilityId: string, occupiedNames: Set<string>): string {
  const suffix = facilityId.replaceAll('-', '').slice(0, 8).toUpperCase();
  let candidate = `${baseName} - ${suffix}`;
  let attempt = 2;
  while (occupiedNames.has(normalizedName(candidate))) {
    candidate = `${baseName} - ${suffix}-${attempt}`;
    attempt += 1;
  }
  return candidate;
}

/** Creates a name-only cleanup plan. It does not modify records. */
export function planLegacyFacilityCleanup(facilities: FacilityNameRecord[]): LegacyFacilityCleanupPlan {
  const occupiedNames = new Set(facilities.map((facility) => normalizedName(facility.name)));
  const plannedNames = new Set<string>();
  const legacyFacilities: LegacyFacilityRename[] = [];

  for (const facility of facilities) {
    if (!LEGACY_NAME_PATTERN.test(facility.name)) continue;
    const proposed = neutralProposal(facility.name);
    if (!proposed) {
      legacyFacilities.push({
        facilityId: facility.id,
        currentName: facility.name,
        proposedName: null,
        collision: false,
        collisionWith: null,
        reason: 'NEEDS_MAPPING',
      });
      continue;
    }

    const normalizedProposal = normalizedName(proposed);
    const collision = occupiedNames.has(normalizedProposal) || plannedNames.has(normalizedProposal);
    const proposedName = collision ? uniqueAlternative(proposed, facility.id, new Set([...occupiedNames, ...plannedNames])) : proposed;
    legacyFacilities.push({
      facilityId: facility.id,
      currentName: facility.name,
      proposedName,
      collision,
      collisionWith: collision ? proposed : null,
      reason: 'LEGACY_PATTERN',
    });
    plannedNames.add(normalizedName(proposedName));
  }

  return {
    facilitiesInspected: facilities.length,
    legacyFacilities,
    recordsToDelete: 0,
    relationshipsAffected: 0,
  };
}

/** Applies only the names explicitly planned above. Call inside a transaction. */
export async function applyLegacyFacilityCleanup(
  store: LegacyFacilityNameStore,
  plan: LegacyFacilityCleanupPlan,
): Promise<number> {
  const unmapped = plan.legacyFacilities.find((facility) => facility.proposedName === null);
  if (unmapped) {
    throw new Error(`Legacy facility ${unmapped.facilityId} needs an explicit neutral name before cleanup.`);
  }
  for (const rename of plan.legacyFacilities) {
    await store.renameFacility({
      facilityId: rename.facilityId,
      currentName: rename.currentName,
      proposedName: rename.proposedName!,
    });
  }
  return plan.legacyFacilities.length;
}

export function formatLegacyFacilityCleanupPlan(plan: LegacyFacilityCleanupPlan, dryRun: boolean): string[] {
  return [
    `[cleanup:legacy-facility-names] ${dryRun ? 'Dry run' : 'Completed'}`,
    `Facilities inspected: ${plan.facilitiesInspected}`,
    `Legacy facilities found: ${plan.legacyFacilities.length}`,
    ...plan.legacyFacilities.flatMap((facility) => [
      `ID: ${facility.facilityId}`,
      `Current name: ${facility.currentName}`,
      `Proposed name: ${facility.proposedName ?? 'NEEDS EXPLICIT MAPPING'}`,
      `Collision: ${facility.collision ? `YES (${facility.collisionWith})` : 'NO'}`,
    ]),
    `Records to delete: ${plan.recordsToDelete}`,
    `Relationships affected: ${plan.relationshipsAffected}`,
    dryRun ? 'No database writes performed.' : 'Errors: 0',
  ];
}
