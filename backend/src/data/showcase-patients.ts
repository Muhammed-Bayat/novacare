export const SHOWCASE_PATIENT_SEED_VERSION = 1;
export const SHOWCASE_DEPARTMENT_COUNT = 4;
export const SHOWCASE_APPOINTMENT_COUNT = 12;
export const SHOWCASE_QUEUE_COUNT = 20;

const preferredDepartmentNames = [
  'Trauma and Emergency Services',
  'General consultation',
  'Internal Medicine',
  'Orthopaedics',
];

const patientNames = [
  'Naledi Mokoena', 'Thabo Dlamini', 'Ayesha Khan', 'Lerato Molefe', 'Sipho Nkosi', 'Zanele Khumalo',
  'Michael Jacobs', 'Palesa Maseko', 'Kagiso Ndlovu', 'Fatima Ismail', 'Bongani Zulu', 'Leanne Petersen',
  'Neo Seabi', 'Amahle Cele', 'Ruan Botha', 'Refilwe Modise', 'Musa Mthembu', 'Kiara Naidoo',
  'Tshepo Radebe', 'Lauren Williams', 'Nandi Hadebe', 'Yusuf Mahomed', 'Karabo Moagi', 'Siyanda Mkhize',
  'Anika van Wyk', 'Tumisang Phiri', 'Jayden Adams', 'Nokuthula Sithole',
];

export interface ShowcaseDepartment {
  id: string;
  name: string;
}

export interface ShowcasePatient {
  key: string;
  auth0Subject: string;
  email: string;
  displayName: string;
}

export interface ShowcaseAppointment {
  key: string;
  patientKey: string;
  departmentId: string;
  departmentName: string;
  time: string;
  status: 'booked' | 'checked_in';
}

export interface ShowcaseQueueEntry {
  key: string;
  patientKey: string;
  departmentId: string;
  departmentName: string;
  appointmentKey?: string;
  status: 'awaiting_triage' | 'waiting' | 'called' | 'in_consultation';
  category?: 'emergency' | 'urgent' | 'priority' | 'routine';
  joinedMinutesAgo: number;
  triagedMinutesAgo?: number;
  calledMinutesAgo?: number;
  triageUrgency?: 'emergency' | 'routine';
  triageSummary?: string;
  triageRedFlags: string[];
}

export interface ShowcasePatientPlan {
  hospitalId: string;
  hospitalName: string;
  date: string;
  departments: ShowcaseDepartment[];
  patients: ShowcasePatient[];
  appointments: ShowcaseAppointment[];
  queueEntries: ShowcaseQueueEntry[];
}

export function selectShowcaseDepartments(departments: ShowcaseDepartment[]): ShowcaseDepartment[] {
  const ordered = [...departments].sort((left, right) => left.name.localeCompare(right.name));
  const selected = preferredDepartmentNames
    .map((name) => ordered.find((department) => department.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
    .filter((department): department is ShowcaseDepartment => department !== undefined);
  for (const department of ordered) {
    if (selected.length === SHOWCASE_DEPARTMENT_COUNT) break;
    if (!selected.some((candidate) => candidate.id === department.id)) selected.push(department);
  }
  if (selected.length < SHOWCASE_DEPARTMENT_COUNT) {
    throw new Error(`At least ${SHOWCASE_DEPARTMENT_COUNT} active departments are required for the full showcase seed.`);
  }
  return selected;
}

function appointmentTimesFor(departmentId: string, occupiedBookedSlots: ReadonlySet<string>): string[] {
  const available: string[] = [];
  for (let minutes = 8 * 60; minutes <= 17 * 60; minutes += 30) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    if (!occupiedBookedSlots.has(`${departmentId}|${time}`)) available.push(time);
  }
  if (available.length < 3) throw new Error(`Department ${departmentId} does not have three free showcase appointment times.`);
  return available.slice(0, 3);
}

export function buildShowcasePatientPlan(input: {
  hospitalId: string;
  hospitalName: string;
  date: string;
  departments: ShowcaseDepartment[];
  occupiedBookedSlots?: ReadonlySet<string>;
}): ShowcasePatientPlan {
  const departments = selectShowcaseDepartments(input.departments);
  const occupiedBookedSlots = input.occupiedBookedSlots ?? new Set<string>();
  const patients = patientNames.map((displayName, index) => {
    const sequence = String(index + 1).padStart(2, '0');
    return {
      key: `patient-${sequence}`,
      auth0Subject: `synthetic:showcase:patient:${input.hospitalId}:${input.date}:${sequence}`,
      email: `showcase-patient-${input.date}-${sequence}@novacare.invalid`,
      displayName,
    };
  });
  const appointments: ShowcaseAppointment[] = [];
  const queueEntries: ShowcaseQueueEntry[] = [];
  const waitingUrgencies = [
    ['emergency', 'urgent', 'routine'],
    ['urgent', 'priority', 'routine'],
    ['priority', 'routine', 'urgent'],
    ['routine', 'urgent', 'priority'],
  ] as const;

  departments.forEach((department, departmentIndex) => {
    const times = appointmentTimesFor(department.id, occupiedBookedSlots);
    for (let appointmentIndex = 0; appointmentIndex < 3; appointmentIndex += 1) {
      const sequence = departmentIndex * 3 + appointmentIndex + 1;
      appointments.push({
        key: `appointment-${String(sequence).padStart(2, '0')}`,
        patientKey: patients[sequence - 1]!.key,
        departmentId: department.id,
        departmentName: department.name,
        time: times[appointmentIndex]!,
        status: appointmentIndex === 0 ? 'checked_in' : 'booked',
      });
    }

    const queuePatients = [
      patients[departmentIndex * 3]!,
      ...patients.slice(12 + departmentIndex * 4, 16 + departmentIndex * 4),
    ];
    const urgencies = waitingUrgencies[departmentIndex]!;
    for (let queueIndex = 0; queueIndex < 3; queueIndex += 1) {
      queueEntries.push({
        key: `queue-${departmentIndex + 1}-${queueIndex + 1}`,
        patientKey: queuePatients[queueIndex]!.key,
        departmentId: department.id,
        departmentName: department.name,
        appointmentKey: queueIndex === 0 ? appointments[departmentIndex * 3]!.key : undefined,
        status: 'waiting',
        category: urgencies[queueIndex],
        joinedMinutesAgo: 140 - departmentIndex * 12 - queueIndex * 9,
        triagedMinutesAgo: 130 - departmentIndex * 12 - queueIndex * 9,
        triageRedFlags: [],
      });
    }

    const advancedStatus = departmentIndex % 2 === 0 ? 'called' : 'in_consultation';
    queueEntries.push({
      key: `queue-${departmentIndex + 1}-4`,
      patientKey: queuePatients[3]!.key,
      departmentId: department.id,
      departmentName: department.name,
      status: advancedStatus,
      category: departmentIndex % 2 === 0 ? 'urgent' : 'priority',
      joinedMinutesAgo: 95 - departmentIndex * 7,
      triagedMinutesAgo: 85 - departmentIndex * 7,
      calledMinutesAgo: 20 - departmentIndex * 2,
      triageRedFlags: [],
    });

    const critical = departmentIndex % 2 === 0;
    queueEntries.push({
      key: `queue-${departmentIndex + 1}-5`,
      patientKey: queuePatients[4]!.key,
      departmentId: department.id,
      departmentName: department.name,
      status: 'awaiting_triage',
      joinedMinutesAgo: 35 - departmentIndex * 4,
      triageUrgency: critical ? 'emergency' : 'routine',
      triageSummary: critical
        ? 'Fictional demo intake reports severe symptoms requiring prompt clinical review.'
        : 'Fictional demo intake reports stable symptoms for routine clinical review.',
      triageRedFlags: critical ? ['Fictional demo red flag: severe symptoms'] : [],
    });
  });

  return {
    hospitalId: input.hospitalId,
    hospitalName: input.hospitalName,
    date: input.date,
    departments,
    patients,
    appointments,
    queueEntries,
  };
}

export function formatShowcasePatientPlan(plan: ShowcasePatientPlan): string[] {
  const statusCount = (status: ShowcaseQueueEntry['status']) => plan.queueEntries.filter((entry) => entry.status === status).length;
  return [
    `Hospital: ${plan.hospitalName} (${plan.hospitalId})`,
    `Seed date: ${plan.date}`,
    `Departments (${plan.departments.length}): ${plan.departments.map((department) => department.name).join(', ')}`,
    `Synthetic patients: ${plan.patients.length}`,
    `Appointments: ${plan.appointments.length} (${plan.appointments.filter((entry) => entry.status === 'booked').length} booked, ${plan.appointments.filter((entry) => entry.status === 'checked_in').length} checked in)`,
    `Queue entries: ${plan.queueEntries.length} (${statusCount('awaiting_triage')} awaiting triage, ${statusCount('waiting')} waiting, ${statusCount('called')} called, ${statusCount('in_consultation')} in consultation)`,
    ...plan.departments.map((department) => {
      const queueCount = plan.queueEntries.filter((entry) => entry.departmentId === department.id).length;
      const appointmentCount = plan.appointments.filter((entry) => entry.departmentId === department.id).length;
      return `  ${department.name}: ${queueCount} queue/triage, ${appointmentCount} appointments`;
    }),
  ];
}

export function showcasePatientPlanFingerprint(plan: ShowcasePatientPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}
import { createHash } from 'node:crypto';
