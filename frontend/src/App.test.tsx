import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.tsx';

const auth = vi.hoisted(() => ({
  state: { isAuthenticated: false, isLoading: false, error: undefined as Error | undefined },
  loginWithRedirect: vi.fn(),
  logout: vi.fn(),
  getAccessTokenSilently: vi.fn(async () => 'test-token'),
}));

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    ...auth.state,
    loginWithRedirect: auth.loginWithRedirect,
    logout: auth.logout,
    getAccessTokenSilently: auth.getAccessTokenSilently,
  }),
}));

function stubCurrentUser(user: { userType?: string; isPlatformOperator?: boolean; staffRole?: 'administrator' | 'nurse' | 'doctor' | 'dispatcher' | null; hospitalName?: string | null }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        id: 'user-1',
        auth0Subject: 'auth0|user-1',
        email: 'user@example.com',
        displayName: 'Amina Dlamini',
        userType: 'patient',
        isPlatformOperator: false,
        staffRole: null,
        hospitalId: null,
        hospitalName: null,
        ...user,
      },
    }),
  })));
}

function stubPatientData(appointments: unknown[], queueEntries: unknown[] = [], hospitals: unknown[] = [], questionnaire?: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/questionnaire/intake')) return { ok: true, json: async () => ({ data: questionnaire }) };
    if (url.includes('/api/v1/appointments')) return { ok: true, json: async () => ({ data: appointments }) };
    if (url.includes('/api/v1/queue')) return { ok: true, json: async () => ({ data: queueEntries }) };
    if (url.includes('/api/v1/hospitals')) return { ok: true, json: async () => ({ data: hospitals }) };
    return { ok: true, json: async () => ({ data: { userType: 'patient' } }) };
  }));
}

function stubChatFlow(hospitals: unknown[], turns: unknown[]) {
  let turnIndex = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/intake/chat')) {
      const turn = turns[Math.min(turnIndex, turns.length - 1)];
      turnIndex += 1;
      return { ok: true, json: async () => ({ data: turn }) };
    }
    if (url.includes('/api/v1/appointments')) return { ok: true, json: async () => ({ data: [] }) };
    if (url.includes('/api/v1/hospitals')) return { ok: true, json: async () => ({ data: hospitals }) };
    return { ok: true, json: async () => ({ data: { userType: 'patient' } }) };
  }));
}

interface AdminStubOptions {
  members?: unknown[];
  pendingInvitations?: unknown[];
  departments?: unknown[];
  slots?: unknown[];
  adminDepartments?: unknown[];
  display?: { token: string | null; active: boolean };
  auditEvents?: unknown[];
  overview?: unknown;
}

function stubAdminData(
  user: Parameters<typeof stubCurrentUser>[0] = {},
  options: AdminStubOptions = {},
) {
  const {
    members = [],
    pendingInvitations = [],
    departments = [],
    slots = [],
    adminDepartments = [],
    display = { token: null, active: false },
    auditEvents = [],
    overview,
  } = options;
  const defaultOverview = {
    date: '2026-09-27',
    totals: { slotsToday: 0, capacityToday: 0, reservedToday: 0, appointmentsBooked: 0, appointmentsCancelled: 0, queueWaiting: 0, queueCalled: 0, activeMembers: 0, pendingInvitations: 0 },
    departments: [],
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/api/v1/admin/departments')) {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { name: string; averageConsultationMinutes: number };
        return { ok: true, status: 201, json: async () => ({ data: { id: 'd-new', name: body.name, averageConsultationMinutes: body.averageConsultationMinutes, active: true, slotCount: 0, appointmentCount: 0 } }) };
      }
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as { active?: boolean };
        return { ok: true, json: async () => ({ data: { id: 'd1', name: 'General Medicine', averageConsultationMinutes: 15, active: body.active ?? true } }) };
      }
      if (method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) };
      return { ok: true, json: async () => ({ data: adminDepartments }) };
    }
    if (url.includes('/api/v1/admin/display/rotate') && method === 'POST') {
      return { ok: true, json: async () => ({ data: { token: 'kiosk-token-123', active: true } }) };
    }
    if (url.includes('/api/v1/admin/display')) {
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as { active: boolean };
        return { ok: true, json: async () => ({ data: { active: body.active } }) };
      }
      return { ok: true, json: async () => ({ data: display }) };
    }
    if (url.includes('/api/v1/admin/audit')) return { ok: true, json: async () => ({ data: auditEvents }) };
    if (url.includes('/api/v1/admin/overview')) return { ok: true, json: async () => ({ data: overview ?? defaultOverview }) };
    if (url.includes('/api/v1/admin/staff')) {
      if (method === 'PATCH') return { ok: true, json: async () => ({ data: { membershipId: 'm1', role: 'nurse', active: true } }) };
      return { ok: true, json: async () => ({ data: { hospitalId: 'h1', hospitalName: 'Charlotte Maxeke Johannesburg Academic Hospital', members, pendingInvitations } }) };
    }
    if (url.includes('/api/v1/departments')) {
      return { ok: true, json: async () => ({ data: { hospitalId: 'h1', hospitalName: 'Charlotte Maxeke Johannesburg Academic Hospital', departments } }) };
    }
    if (url.includes('/api/v1/admin/slots')) {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { departmentId: string; date: string };
        return { ok: true, json: async () => ({ data: { created: 3, departmentId: body.departmentId, departmentName: 'General Medicine', date: body.date } }) };
      }
      if (method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) };
      return { ok: true, json: async () => ({ data: slots }) };
    }
    return { ok: true, json: async () => ({ data: { id: 'user-1', auth0Subject: 'auth0|user-1', email: 'user@example.com', displayName: 'Amina Dlamini', userType: 'patient', isPlatformOperator: false, staffRole: null, hospitalId: null, hospitalName: null, ...user } }) };
  }));
}

function stubStaffData(user: Parameters<typeof stubCurrentUser>[0] = {}, triage: unknown[] = [], queue: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/staff/triage')) return { ok: true, json: async () => ({ data: triage }) };
    if (url.includes('/api/v1/staff/queue')) return { ok: true, json: async () => ({ data: queue }) };
    if (url.includes('/api/v1/hospitals')) {
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: 'h1',
            name: 'Charlotte Maxeke Johannesburg Academic Hospital',
            province: 'Gauteng',
            address: 'Johannesburg',
            latitude: -26.18,
            longitude: 28.01,
            facilityType: 'Academic hospital',
            services: [{ id: 's1', name: 'General Medicine' }, { id: 's2', name: 'Emergency Department' }],
          }],
        }),
      };
    }
    return { ok: true, json: async () => ({ data: { id: 'user-1', auth0Subject: 'auth0|user-1', email: 'user@example.com', displayName: 'Amina Dlamini', userType: 'patient', isPlatformOperator: false, staffRole: null, hospitalId: 'h1', hospitalName: 'Charlotte Maxeke Johannesburg Academic Hospital', ...user } }) };
  }));
}

interface DispatcherStubOptions {
  live?: unknown[];
  unresolved?: unknown[];
  metrics?: unknown;
  responders?: unknown[];
  units?: unknown[];
  detail?: unknown;
}

function stubDispatcherData(user: Parameters<typeof stubCurrentUser>[0] = {}, options: DispatcherStubOptions = {}) {
  const {
    live = [],
    unresolved = [],
    metrics = { active: 0, ambulance: 0, homeVisit: 0, awaitingAssignment: 0, dispatched: 0 },
    responders = [],
    units = [],
    detail,
  } = options;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/dispatcher/service-requests/') && !url.endsWith('/available-responders')) {
      return { ok: true, json: async () => ({ data: detail ?? null }) };
    }
    if (url.includes('/api/v1/dispatcher/service-requests')) {
      return { ok: true, json: async () => ({ data: { live, unresolved, metrics } }) };
    }
    if (url.includes('/api/v1/dispatcher/available-responders')) {
      return { ok: true, json: async () => ({ data: { responders, units } }) };
    }
    return { ok: true, json: async () => ({ data: { id: 'user-1', auth0Subject: 'auth0|user-1', email: 'dispatcher@example.com', displayName: 'Amina Dlamini', userType: 'staff', isPlatformOperator: false, staffRole: 'dispatcher', hospitalId: null, hospitalName: null, ...user } }) };
  }));
}

const dispatcherRequestRow = {
  id: 'sr1',
  reference_code: 'NC-2026-000201',
  requester_user_id: 'user-9',
  requester_phone: null,
  type: 'AMBULANCE',
  channel: 'WEB',
  status: 'NOTIFIED',
  urgency: 'EMERGENCY',
  reason: 'Severe chest pain',
  triage: { ambulanceReason: 'chest-pain', conscious: 'YES' },
  address: '7th Avenue, Parktown, Johannesburg',
  latitude: -26.176,
  longitude: 28.045,
  search_radius_km: 5,
  facilities_notified: 3,
  escalation_flag: false,
  assigned_facility_id: null,
  assigned_responder_id: null,
  assigned_unit_id: null,
  created_at: '2026-09-27T10:00:00.000Z',
  updated_at: '2026-09-27T10:01:00.000Z',
  notified_at: '2026-09-27T10:01:00.000Z',
  acknowledged_at: null,
  assigned_at: null,
  completed_at: null,
  cancelled_at: null,
  cancel_reason: null,
};

const dispatcherNotifications = [
  { id: 'n1', request_id: 'sr1', facility_id: 'h1', distance_km: 1.2, notified_at: '2026-09-27T10:01:00.000Z', acknowledged_at: null, response_status: 'PENDING', responded_at: null, facility_name: 'Simulated Facility Near' },
  { id: 'n2', request_id: 'sr1', facility_id: 'h2', distance_km: 3.4, notified_at: '2026-09-27T10:01:00.000Z', acknowledged_at: null, response_status: 'PENDING', responded_at: null, facility_name: 'Simulated Facility Mid' },
];

const dispatcherHistory = [
  { id: 'hh1', from_status: null, to_status: 'CREATED', actor_user_id: null, note: null, created_at: '2026-09-27T10:00:00.000Z' },
  { id: 'hh2', from_status: 'CREATED', to_status: 'SEARCHING', actor_user_id: null, note: null, created_at: '2026-09-27T10:00:30.000Z' },
  { id: 'hh3', from_status: 'SEARCHING', to_status: 'NOTIFIED', actor_user_id: null, note: '3 simulated facilities notified', created_at: '2026-09-27T10:01:00.000Z' },
];

const patientServiceRequestRow = {
  id: 'sr9',
  reference_code: 'NC-2026-000301',
  requester_user_id: 'user-1',
  requester_phone: null,
  type: 'AMBULANCE',
  channel: 'WEB',
  status: 'NOTIFIED',
  urgency: 'EMERGENCY',
  reason: null,
  triage: { ambulanceReason: 'chest-pain', conscious: 'YES' },
  address: '7th Avenue, Parktown, Johannesburg',
  latitude: -26.176,
  longitude: 28.045,
  search_radius_km: 5,
  facilities_notified: 3,
  escalation_flag: false,
  assigned_facility_id: null,
  assigned_responder_id: null,
  assigned_unit_id: null,
  created_at: '2026-09-27T11:00:00.000Z',
  updated_at: '2026-09-27T11:01:00.000Z',
  notified_at: '2026-09-27T11:01:00.000Z',
  acknowledged_at: null,
  assigned_at: null,
  completed_at: null,
  cancelled_at: null,
  cancel_reason: null,
};

const patientHomeVisitRow = {
  ...patientServiceRequestRow,
  id: 'sr10',
  reference_code: 'NC-2026-000302',
  type: 'HOME_VISIT',
  status: 'DISPATCHED',
  urgency: 'STANDARD',
  triage: { homeVisitReason: 'wound-care', preferredResponder: 'NURSE' },
  notified_at: null,
  assigned_unit_id: null,
};

function stubServiceRequests(
  requests: unknown[],
  created?: unknown,
  locationResolution: { status: 'confirmation_required' | 'unresolved'; candidates: unknown[] } = {
    status: 'confirmation_required',
    candidates: [{ id: '5c591bc7-3fdc-4761-9664-43e79932b159', formattedAddress: '7th Avenue, Parktown, Johannesburg' }],
  },
) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/locations/resolve')) {
      return {
        ok: true,
        json: async () => locationResolution,
      };
    }
    if (url.includes('/api/v1/locations/confirm')) {
      return {
        ok: true,
        json: async () => ({
          status: 'confirmed',
          candidate: { id: '5c591bc7-3fdc-4761-9664-43e79932b159', formattedAddress: '7th Avenue, Parktown, Johannesburg' },
        }),
      };
    }
    if (url.includes('/api/v1/service-requests')) {
      if ((init?.method ?? 'GET') === 'POST') {
        return { ok: true, status: 201, json: async () => ({ data: created }) };
      }
      return { ok: true, json: async () => ({ data: requests }) };
    }
    if (url.includes('/api/v1/questionnaire/intake')) return { ok: true, json: async () => ({ data: undefined }) };
    if (url.includes('/api/v1/appointments')) return { ok: true, json: async () => ({ data: [] }) };
    if (url.includes('/api/v1/queue')) return { ok: true, json: async () => ({ data: [] }) };
    if (url.includes('/api/v1/hospitals')) return { ok: true, json: async () => ({ data: [] }) };
    return { ok: true, json: async () => ({ data: { userType: 'patient' } }) };
  }));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.state = { isAuthenticated: false, isLoading: false, error: undefined };
  auth.loginWithRedirect.mockReset();
  auth.logout.mockReset();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the public landing page at /', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Simple, Trusted Healthcare for Everyone' })).toBeInTheDocument();
  });

  it('renders the patient portal at /patient', () => {
    renderAt('/patient');
    expect(screen.getByRole('heading', { name: 'Welcome back, Thandi' })).toBeInTheDocument();
  });

  it('shows a sign-in prompt when opening appointments anonymously', async () => {
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Appointments' }));
    expect(screen.getByRole('heading', { name: 'Sign in to manage your appointments' })).toBeInTheDocument();
  });

  it('opens the appointments view from the booking shortcut', async () => {
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Book an Appointment' }));
    expect(screen.getByRole('heading', { name: 'Sign in to manage your appointments' })).toBeInTheDocument();
  });

  it('shows the next real appointment on the signed-in patient dashboard', async () => {
    auth.state.isAuthenticated = true;
    stubPatientData([
      { id: 'a1', hospitalId: 'h1', serviceId: 's1', date: '2026-10-02', time: '09:30', status: 'booked', hospitalName: 'Charlotte Maxeke Johannesburg Academic Hospital', serviceName: 'General Consultation', address: 'Johannesburg' },
    ]);
    renderAt('/patient');
    expect(await screen.findByText('Charlotte Maxeke Johannesburg Academic Hospital')).toBeInTheDocument();
    expect(screen.getByText(/09:30/)).toBeInTheDocument();
  });

  it('formats ISO appointment dates in the appointments list', async () => {
    auth.state.isAuthenticated = true;
    stubPatientData([
      { id: 'a1', hospitalId: 'h1', serviceId: 's1', date: '2026-09-26T00:00:00.000Z', time: '07:00', status: 'booked', hospitalName: 'Helen Joseph Hospital', serviceName: 'Anaesthetics', address: 'Gauteng, South Africa', triageSummary: { urgency: 'urgent', pathwayName: 'Headache & neurological', department: 'General Medicine', summary: 'Your answers suggest prompt clinical review is a safer next step.', redFlags: ['New neurological warning signs reported'] } },
    ]);
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Appointments' }));
    expect(await screen.findByText('Helen Joseph Hospital')).toBeInTheDocument();
    expect(screen.getByText(/Anaesthetics · .*2026 · 07:00/)).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('Headache & neurological assessment')).toBeInTheDocument();
    expect(screen.getByText('Your answers suggest prompt clinical review is a safer next step.')).toBeInTheDocument();
    expect(screen.queryByText(/T00:00:00\.000Z/)).not.toBeInTheDocument();
  });

  it('requests the patient location on the appointments map so the browser can prompt', async () => {
    auth.state.isAuthenticated = true;
    stubPatientData([], [], [
      {
        id: 'h1',
        name: 'Helen Joseph Hospital',
        province: 'Gauteng',
        address: 'Perth Road, Johannesburg',
        latitude: -26.18,
        longitude: 28.01,
        facilityType: 'Academic hospital',
        services: [{ id: 's1', name: 'Orthopaedics' }],
      },
    ]);
    const query = vi.fn(async () => ({ state: 'prompt' }));
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({ coords: { latitude: -26.181, longitude: 28.028 } } as GeolocationPosition));
    Object.defineProperty(window.navigator, 'permissions', { configurable: true, value: { query } });
    Object.defineProperty(window.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    try {
      renderAt('/patient');
      await userEvent.click(screen.getByRole('button', { name: 'Appointments' }));
      await waitFor(() => expect(query).toHaveBeenCalledWith({ name: 'geolocation' }));
      await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled());
      expect(await screen.findByLabelText(/Within/)).toBeInTheDocument();
      await waitFor(() => expect(document.querySelector('.nv-marker-user')).not.toBeNull());
    } finally {
      Reflect.deleteProperty(window.navigator, 'permissions');
      Reflect.deleteProperty(window.navigator, 'geolocation');
    }
  });

  it('does not request location when permission is already blocked', async () => {
    auth.state.isAuthenticated = true;
    stubPatientData([], [], []);
    const query = vi.fn(async () => ({ state: 'denied' }));
    const getCurrentPosition = vi.fn();
    Object.defineProperty(window.navigator, 'permissions', { configurable: true, value: { query } });
    Object.defineProperty(window.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    try {
      renderAt('/patient');
      await userEvent.click(screen.getByRole('button', { name: 'Appointments' }));
      expect(await screen.findByText(/Location access is blocked/)).toBeInTheDocument();
      expect(getCurrentPosition).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window.navigator, 'permissions');
      Reflect.deleteProperty(window.navigator, 'geolocation');
    }
  });

  it('lets patients chat with the AI intake and open recommended booking', async () => {
    auth.state.isAuthenticated = true;
    stubChatFlow([
      {
        id: 'h1',
        name: 'Helen Joseph Hospital',
        province: 'Gauteng',
        address: 'Perth Road, Johannesburg',
        latitude: -26.18,
        longitude: 28.01,
        facilityType: 'Academic hospital',
        services: [{ id: 's1', name: 'Orthopaedics' }, { id: 's2', name: 'Emergency Department' }],
      },
    ], [
      { action: 'question', question: { id: 'weight_bearing', text: 'Can you put weight on the injured area?', type: 'single', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] } },
      { action: 'complete', source: 'gemini', intake: { pathwayId: 'injury', pathwayName: 'Injury & musculoskeletal', summary: 'Ankle injury — unable to bear weight.', department: 'Emergency Department', urgency: 'emergency', redFlags: ['Unable to bear weight'] } },
    ]);

    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'I hurt my ankle today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
    expect(await screen.findByText('Can you put weight on the injured area?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'No' }));

    expect(screen.getByRole('heading', { name: 'Emergency Department' })).toBeInTheDocument();
    expect(screen.getByText('Emergency assessment')).toBeInTheDocument();
    expect(screen.getByText('Helen Joseph Hospital')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Book here' }));
    expect(screen.getByRole('heading', { name: 'Appointments' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByText('Appointment booked')).toBeInTheDocument();
    expect(screen.getByText(/Helen Joseph Hospital/)).toBeInTheDocument();

    const chatPosts = vi.mocked(fetch).mock.calls.filter(([url, options]) => String(url).includes('/api/v1/intake/chat') && (options as RequestInit | undefined)?.method === 'POST');
    expect(chatPosts).toHaveLength(2);
    expect(JSON.parse(String((chatPosts[0][1] as RequestInit).body))).toMatchObject({ complaint: 'I hurt my ankle today', answers: [] });
    expect(JSON.parse(String((chatPosts[1][1] as RequestInit).body))).toMatchObject({ answers: [{ question: 'Can you put weight on the injured area?', answer: 'No' }] });
    const appointmentPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/appointments') && (options as RequestInit | undefined)?.method === 'POST');
    expect(appointmentPost).toBeDefined();
    const body = JSON.parse(String((appointmentPost?.[1] as RequestInit).body));
    expect(body).toMatchObject({ hospitalId: 'h1', serviceId: 's2', triageSummary: { urgency: 'emergency', pathwayName: 'Injury & musculoskeletal' } });
  });

  it('ranks recommended hospitals by distance and queue length when location is available', async () => {
    auth.state.isAuthenticated = true;
    stubChatFlow([
      {
        id: 'far',
        name: 'Far Hospital',
        province: 'KwaZulu-Natal',
        address: 'Sydney Road, Durban',
        latitude: -29.9027,
        longitude: 30.9991,
        facilityType: 'Academic hospital',
        services: [{ id: 's1', name: 'General Consultation' }],
      },
      {
        id: 'near',
        name: 'Near Hospital',
        province: 'Gauteng',
        address: 'Jubilee Road, Parktown',
        latitude: -26.1815,
        longitude: 28.0283,
        facilityType: 'Academic hospital',
        services: [{ id: 's2', name: 'General Consultation', waitingCount: 8 }],
      },
      {
        id: 'quiet',
        name: 'Quiet Hospital',
        province: 'Gauteng',
        address: 'Empire Road, Parktown',
        latitude: -26.187,
        longitude: 28.038,
        facilityType: 'Academic hospital',
        services: [{ id: 's3', name: 'General Consultation', waitingCount: 0 }],
      },
    ], [
      { action: 'question', question: { id: 'pain', text: 'How severe is the pain?', type: 'scale' } },
      { action: 'complete', source: 'gemini', intake: { pathwayId: 'headache', pathwayName: 'Headache & neurological', summary: 'Persistent headache.', department: 'General Medicine', urgency: 'priority', redFlags: [] } },
    ]);
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: -26.18, longitude: 28.03 } } as GeolocationPosition),
      },
    });
    try {
      renderAt('/patient');
      await userEvent.click(screen.getByRole('button', { name: 'I have a bad headache' }));
      await userEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
      expect(await screen.findByText('How severe is the pain?')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: '8' }));

      expect(await screen.findByText('Ranked by distance and queue length from your location.')).toBeInTheDocument();
      const quietCard = (await screen.findByText('Quiet Hospital')).closest('article');
      const nearCard = screen.getByText('Near Hospital').closest('article');
      const farCard = screen.getByText('Far Hospital').closest('article');
      if (!quietCard || !nearCard || !farCard) throw new Error('expected all recommendation cards');
      expect(quietCard.compareDocumentPosition(nearCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(nearCard.compareDocumentPosition(farCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByText(/8 in queue/)).toBeInTheDocument();
      expect(screen.getAllByText(/km away/).length).toBe(3);
    } finally {
      Reflect.deleteProperty(window.navigator, 'geolocation');
    }
  });

  it('translates the patient dashboard live when switching languages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/translate')) {
        const body = JSON.parse(String(init?.body)) as { texts: string[] };
        return { ok: true, json: async () => ({ data: { translations: body.texts.map((text) => `translated:${text}`) } }) };
      }
      return { ok: true, json: async () => ({ data: { userType: 'patient' } }) };
    }));
    renderAt('/patient');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'zu');
    await waitFor(() => expect(document.body.textContent).toContain('translated:AI triage chat'), { timeout: 3000 });
    expect(document.body.textContent).toContain('translated:Welcome back, Thandi');
    expect(document.body.textContent).toContain('isiZulu');
    expect(document.body.textContent).not.toContain('translated:isiZulu');
  });

  it('lets patients change their display name from the user menu', async () => {
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: /Hi, Thandi/ }));
    const displayNameInput = screen.getByLabelText('Display name');
    await userEvent.clear(displayNameInput);
    await userEvent.type(displayNameInput, 'Naledi');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: /Hi, Naledi/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back, Naledi' })).toBeInTheDocument();
  });

  it('logs patients out from the user menu', async () => {
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: /Hi, Thandi/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(auth.logout).toHaveBeenCalledWith({ logoutParams: { returnTo: window.location.origin } });
  });

  it('shows a sign-in prompt when opening emergency requests anonymously', async () => {
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    expect(screen.getByRole('heading', { name: 'Sign in to send a test request' })).toBeInTheDocument();
  });

  it('lets patients send an ambulance test request with manual address', async () => {
    auth.state.isAuthenticated = true;
    stubServiceRequests([], patientServiceRequestRow);
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    expect(await screen.findByRole('heading', { name: 'Emergency & home-visit requests' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Development prototype — not a real emergency service.');
    expect(screen.getByText('If this is a real emergency, call 10177 or 112 now.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Request an Ambulance' }));
    await userEvent.selectOptions(screen.getByLabelText('What happened?'), 'chest-pain');
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await userEvent.type(screen.getByLabelText('Or type your address'), '7th Avenue, Parktown, Johannesburg');
    await userEvent.click(screen.getByRole('button', { name: 'Send ambulance test request' }));
    expect(await screen.findByText('Choose the matching location below to confirm it before sending.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Use this location/ }));
    expect(await screen.findByText('Confirmed location')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send ambulance test request' }));

    expect(await screen.findByText('NovaCare received your test request successfully.')).toBeInTheDocument();
    expect(screen.getByText(/NC-2026-000301/)).toBeInTheDocument();
    const post = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/service-requests') && (options as RequestInit | undefined)?.method === 'POST');
    expect(post).toBeDefined();
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
      type: 'AMBULANCE',
      urgency: 'EMERGENCY',
      triage: { ambulanceReason: 'chest-pain', conscious: 'YES' },
      locationCandidateId: '5c591bc7-3fdc-4761-9664-43e79932b159',
    });
  });

  it('sends an unresolved typed address for dispatcher location review without coordinates', async () => {
    auth.state.isAuthenticated = true;
    const reviewRequest = {
      ...patientServiceRequestRow,
      status: 'CREATED',
      latitude: null,
      longitude: null,
      location_state: 'DISPATCHER_LOCATION_REVIEW',
      location_confirmation_required: true,
    };
    stubServiceRequests([], reviewRequest, { status: 'unresolved', candidates: [] });
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Request an Ambulance' }));
    await userEvent.selectOptions(screen.getByLabelText('What happened?'), 'chest-pain');
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await userEvent.type(screen.getByLabelText('Or type your address'), 'Unconfirmed address');
    await userEvent.click(screen.getByRole('button', { name: 'Send ambulance test request' }));
    expect(await screen.findByText("We couldn't confirm this address.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send for location review' }));

    const post = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/service-requests') && (options as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
      address: 'Unconfirmed address',
      locationReview: true,
    });
    expect(await screen.findByText('NovaCare received your test request successfully.')).toBeInTheDocument();
  });

  it('requires triage answers before sending an ambulance test request', async () => {
    auth.state.isAuthenticated = true;
    stubServiceRequests([], patientServiceRequestRow);
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    await screen.findByRole('heading', { name: 'Emergency & home-visit requests' });
    await userEvent.click(screen.getByRole('button', { name: 'Request an Ambulance' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send ambulance test request' }));
    expect(screen.getByText('Choose what happened so the demo dispatcher sees the right category.')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url, options]) => String(url).includes('/api/v1/service-requests') && (options as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('lets patients send a home-visit test request using browser location', async () => {
    auth.state.isAuthenticated = true;
    stubServiceRequests([], patientHomeVisitRow);
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: -26.18, longitude: 28.03 } } as GeolocationPosition),
      },
    });
    try {
      renderAt('/patient');
      await userEvent.click(screen.getByRole('button', { name: 'Emergency' }));
      await screen.findByRole('heading', { name: 'Emergency & home-visit requests' });
      await userEvent.click(screen.getByRole('button', { name: 'Request a Home Visit' }));
      await userEvent.selectOptions(screen.getByLabelText('Reason for the visit'), 'wound-care');
      await userEvent.click(screen.getByRole('button', { name: 'Nurse' }));
      await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
      expect(await screen.findByText(/Location captured/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Send home-visit test request' }));

      expect(await screen.findByText('NovaCare received your test request successfully.')).toBeInTheDocument();
      const post = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/service-requests') && (options as RequestInit | undefined)?.method === 'POST');
      expect(post).toBeDefined();
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
        type: 'HOME_VISIT',
        urgency: 'STANDARD',
        triage: { homeVisitReason: 'wound-care', preferredResponder: 'NURSE' },
        latitude: -26.18,
        longitude: 28.03,
      });
    } finally {
      Reflect.deleteProperty(window.navigator, 'geolocation');
    }
  });

  it('tracks the simulated status of previous test requests', async () => {
    auth.state.isAuthenticated = true;
    stubServiceRequests([patientServiceRequestRow, patientHomeVisitRow]);
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Emergency' }));
    expect(await screen.findByText('NC-2026-000301')).toBeInTheDocument();
    expect(screen.getByText('Notified simulated facilities')).toBeInTheDocument();
    expect(screen.getByText('Simulated responder assigned')).toBeInTheDocument();
    expect(screen.getByText(/Reason: Chest pain · conscious: yes/)).toBeInTheDocument();
    expect(screen.getByText(/Reason: Wound care · prefers nurse/)).toBeInTheDocument();
  });

  it('shows a staff sign-in prompt when opening the staff portal anonymously', () => {
    renderAt('/staff');
    expect(screen.getByRole('heading', { name: 'Staff sign-in required' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign in' }).length).toBeGreaterThan(0);
  });

  it('renders the staff portal with the signed-in user and hospital', async () => {
    auth.state.isAuthenticated = true;
    stubCurrentUser({ userType: 'staff', staffRole: 'nurse', hospitalName: 'Charlotte Maxeke Johannesburg Academic Hospital' });
    renderAt('/staff');
    expect(await screen.findByRole('heading', { name: /Amina Dlamini/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Charlotte Maxeke Johannesburg Academic Hospital/)).not.toHaveLength(0);
  });

  it('renders the doctor portal separately from the staff portal', async () => {
    auth.state.isAuthenticated = true;
    stubCurrentUser({ userType: 'staff', staffRole: 'doctor', hospitalName: 'Helen Joseph Hospital' });
    renderAt('/doctor');
    expect(await screen.findByRole('heading', { name: /Amina Dlamini/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Helen Joseph Hospital/)).not.toHaveLength(0);
  });

  it('redirects team members who open the wrong portal', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' });
    renderAt('/staff');
    expect(await screen.findByRole('heading', { name: 'Welcome back, Amina Dlamini' })).toBeInTheDocument();
  });

  it('shows the nurse triage worklist with the AI summary and confirms routing', async () => {
    auth.state.isAuthenticated = true;
    stubStaffData({ userType: 'staff', staffRole: 'nurse' }, [
      {
        id: 'q1',
        patientName: 'Thandi Mokoena',
        patientEmail: 'thandi@example.com',
        source: 'walk_in',
        serviceId: 's1',
        serviceName: 'General Medicine',
        appointmentTime: null,
        joinedAt: '2026-09-26T08:00:00.000Z',
        critical: true,
        triageSummary: { urgency: 'emergency', pathwayName: 'Chest & breathing', department: 'Emergency Department', summary: 'Severe chest pain reported at rest.', redFlags: ['Chest pain at rest'] },
      },
    ]);
    renderAt('/staff');
    expect(await screen.findByRole('alert')).toHaveTextContent('1 emergency case needs immediate review.');
    expect(screen.getByText('Thandi Mokoena')).toBeInTheDocument();
    expect(screen.getByText('Chest pain at rest')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm triage — send to Emergency Department' }));
    const confirmPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/staff/triage/q1/confirm') && (options as RequestInit | undefined)?.method === 'POST');
    expect(confirmPost).toBeDefined();
    expect(JSON.parse(String((confirmPost?.[1] as RequestInit).body))).toMatchObject({ category: 'emergency', serviceId: 's2' });
  });

  it('lets staff call a waiting patient from the live queue', async () => {
    auth.state.isAuthenticated = true;
    stubStaffData({ userType: 'staff', staffRole: 'nurse' }, [], [
      { id: 'q2', patientName: 'Pieter van der Merwe', serviceId: 's1', serviceName: 'General Medicine', status: 'waiting', category: 'routine', position: 1, joinedAt: '2026-09-26T08:05:00.000Z', triagedAt: '2026-09-26T08:06:00.000Z', calledAt: null },
    ]);
    renderAt('/staff');
    await userEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect(await screen.findByText('Pieter van der Merwe')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Call' }));
    const callPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/staff/queue/q2/call') && (options as RequestInit | undefined)?.method === 'POST');
    expect(callPost).toBeDefined();
  });

  it('shows a dispatcher sign-in prompt when opening the dispatcher portal anonymously', () => {
    renderAt('/dispatcher');
    expect(screen.getByRole('heading', { name: 'Dispatcher sign-in required' })).toBeInTheDocument();
  });

  it('redirects team members who open the dispatcher portal without the dispatcher role', async () => {
    auth.state.isAuthenticated = true;
    stubStaffData({ userType: 'staff', staffRole: 'nurse' });
    renderAt('/dispatcher');
    expect(await screen.findByRole('heading', { name: /Amina Dlamini/ })).toBeInTheDocument();
    expect(screen.queryByText('Live queue')).not.toBeInTheDocument();
  });

  it('allows administrators to review the dispatcher queue without operational controls', async () => {
    auth.state.isAuthenticated = true;
    stubDispatcherData({ userType: 'admin', staffRole: 'administrator' }, {
      live: [dispatcherRequestRow],
      detail: { ...dispatcherRequestRow, history: dispatcherHistory, notifications: dispatcherNotifications },
    });
    renderAt('/dispatcher');
    await userEvent.click(await screen.findByRole('button', { name: /NC-2026-000201/ }));
    expect(await screen.findByText('Read-only administrator view. Dispatcher access is required to change a simulated request.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
  });

  it('renders the dispatcher console with live queue, metrics and the simulation banner', async () => {
    auth.state.isAuthenticated = true;
    stubDispatcherData({ userType: 'staff', staffRole: 'dispatcher' }, {
      live: [dispatcherRequestRow],
      metrics: { active: 1, ambulance: 1, homeVisit: 0, awaitingAssignment: 0, dispatched: 0 },
    });
    renderAt('/dispatcher');
    expect(await screen.findByText('NC-2026-000201')).toBeInTheDocument();
    expect(screen.getByText('Active requests')).toBeInTheDocument();
    expect(screen.getAllByText('Ambulance').length).toBeGreaterThan(0);
    expect(screen.getByText('Home visits')).toBeInTheDocument();
    expect(screen.getByText('Awaiting assignment')).toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Simulation environment.');
  });

  it('lets the dispatcher acknowledge a simulated facility from the detail view', async () => {
    auth.state.isAuthenticated = true;
    stubDispatcherData({ userType: 'staff', staffRole: 'dispatcher' }, {
      live: [dispatcherRequestRow],
      detail: { ...dispatcherRequestRow, history: dispatcherHistory, notifications: dispatcherNotifications },
    });
    renderAt('/dispatcher');
    await userEvent.click(await screen.findByRole('button', { name: /NC-2026-000201/ }));
    expect(await screen.findByText('Notified facilities (simulated)')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Acknowledge' })[0]);

    const respondPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/dispatcher/service-requests/sr1/respond') && (options as RequestInit | undefined)?.method === 'POST');
    expect(respondPost).toBeDefined();
    expect(JSON.parse(String((respondPost?.[1] as RequestInit).body))).toMatchObject({ facilityId: 'h1', response: 'ACKNOWLEDGED' });
  });

  it('lets the dispatcher assign a simulated response unit to an assigned ambulance request', async () => {
    auth.state.isAuthenticated = true;
    const assignedRow = { ...dispatcherRequestRow, status: 'ASSIGNED', assigned_facility_id: 'h1' };
    stubDispatcherData({ userType: 'staff', staffRole: 'dispatcher' }, {
      live: [assignedRow],
      units: [{ id: 'u1', callsign: 'A01', unit_type: 'AMBULANCE', status: 'AVAILABLE', hospital_id: 'h1', hospital_name: 'Simulated Facility Near' }],
      detail: {
        ...assignedRow,
        history: [...dispatcherHistory, { id: 'hh4', from_status: 'ACCEPTED', to_status: 'ASSIGNED', actor_user_id: 'user-1', note: 'Facility assigned by dispatcher', created_at: '2026-09-27T10:05:00.000Z' }],
        notifications: dispatcherNotifications.map((notification, index) => index === 0 ? { ...notification, response_status: 'ACCEPTED', acknowledged_at: '2026-09-27T10:02:00.000Z', responded_at: '2026-09-27T10:04:00.000Z' } : notification),
      },
    });
    renderAt('/dispatcher');
    await userEvent.click(await screen.findByRole('button', { name: /NC-2026-000201/ }));
    await userEvent.selectOptions(await screen.findByLabelText('Choose response unit'), 'unit:u1');
    await userEvent.click(screen.getByRole('button', { name: 'Assign unit' }));

    const assignPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/dispatcher/service-requests/sr1/assign-responder') && (options as RequestInit | undefined)?.method === 'POST');
    expect(assignPost).toBeDefined();
    expect(JSON.parse(String((assignPost?.[1] as RequestInit).body))).toMatchObject({ unitId: 'u1' });
  });

  it('lets the dispatcher advance a dispatched request and cancel with a reason', async () => {
    auth.state.isAuthenticated = true;
    const dispatchedRow = { ...dispatcherRequestRow, status: 'DISPATCHED', assigned_facility_id: 'h1', assigned_unit_id: 'u1', assigned_at: '2026-09-27T10:06:00.000Z' };
    stubDispatcherData({ userType: 'staff', staffRole: 'dispatcher' }, {
      live: [dispatchedRow],
      detail: { ...dispatchedRow, history: dispatcherHistory, notifications: dispatcherNotifications },
    });
    renderAt('/dispatcher');
    await userEvent.click(await screen.findByRole('button', { name: /NC-2026-000201/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark en route' }));

    const forwardPatch = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/dispatcher/service-requests/sr1/status') && (options as RequestInit | undefined)?.method === 'PATCH');
    expect(forwardPatch).toBeDefined();
    expect(JSON.parse(String((forwardPatch?.[1] as RequestInit).body))).toMatchObject({ status: 'EN_ROUTE' });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    await userEvent.type(screen.getByLabelText('Cancellation reason'), 'Requester confirmed it was a false alarm');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    const cancelPatch = vi.mocked(fetch).mock.calls.filter(([url, options]) => String(url).includes('/api/v1/dispatcher/service-requests/sr1/status') && (options as RequestInit | undefined)?.method === 'PATCH');
    expect(cancelPatch).toHaveLength(2);
    expect(JSON.parse(String((cancelPatch[1][1] as RequestInit).body))).toMatchObject({ status: 'CANCELLED', cancelReason: 'Requester confirmed it was a false alarm' });
  });

  it('lets a patient check in on the day of their appointment', async () => {
    auth.state.isAuthenticated = true;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    stubPatientData([
      { id: 'a1', hospitalId: 'h1', serviceId: 's1', date: today, time: '09:30', status: 'booked', hospitalName: 'Helen Joseph Hospital', serviceName: 'General Consultation', address: 'Perth Road' },
    ]);
    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'Appointments' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    const checkInPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/appointments/a1/check-in') && (options as RequestInit | undefined)?.method === 'POST');
    expect(checkInPost).toBeDefined();
  });

  it('renders the anonymized public waiting room display', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          hospitalName: 'Charlotte Maxeke Johannesburg Academic Hospital',
          generatedAt: '2026-09-26T08:10:00.000Z',
          services: [
            { serviceName: 'General Medicine', nowServing: 4, awaitingTriage: 1, waiting: [{ ticket: 5, category: 'urgent' }, { ticket: 6, category: 'routine' }] },
          ],
        },
      }),
    })));
    renderAt('/display/displaytoken123');
    expect(await screen.findByText('Charlotte Maxeke Johannesburg Academic Hospital')).toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('#5')).toBeInTheDocument();
    expect(screen.getByText('1 patient awaiting nurse review')).toBeInTheDocument();
    expect(screen.getByText(/no patient names or details/i)).toBeInTheDocument();
  });

  it('renders the admin portal for an assigned administrator with the invite form', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' });
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Welcome back, Amina Dlamini' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hospital team' }));
    expect(screen.getByLabelText('Team member email')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
  });

  it.each([
    ['nurse', 'Nurse'],
    ['doctor', 'Doctor'],
    ['administrator', 'Administrator'],
    ['dispatcher', 'Dispatcher'],
  ])('invites a %s from the admin portal', async (role, optionLabel) => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' });
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Hospital team' }));
    const emailInput = await screen.findByLabelText('Team member email');
    await userEvent.selectOptions(screen.getByLabelText('Role'), optionLabel);
    await userEvent.type(emailInput, `${role}@example.com`);
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    const invitePost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/admin/staff') && (options as RequestInit | undefined)?.method === 'POST');
    expect(invitePost).toBeDefined();
    expect(JSON.parse(String((invitePost?.[1] as RequestInit).body))).toMatchObject({ email: `${role}@example.com`, role, departmentIds: [] });
  });

  it('shows hospital team members and pending invitations on the admin portal', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' }, {
      members: [
        { membershipId: 'm1', email: 'nurse@example.com', displayName: 'Amina Dlamini', role: 'nurse', active: true, since: '2026-09-26T12:00:00.000Z', departments: [] },
      ],
      pendingInvitations: [
          { email: 'dr@example.com', role: 'doctor', departmentIds: [], expiresAt: '2030-09-29T12:00:00.000Z', sentAt: '2026-09-26T12:00:00.000Z' },
      ],
    });
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Hospital team' }));
    expect(await screen.findByText(/nurse@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/dr@example\.com/)).toBeInTheDocument();
    expect(screen.getByText('Invitation pending')).toBeInTheDocument();
    expect(screen.getAllByText(/All specialties/).length).toBeGreaterThan(0);
  });

  it('updates a team member from the manage form', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' }, {
      members: [
        { membershipId: 'm1', email: 'nurse@example.com', displayName: 'Thandi Khumalo', role: 'nurse', active: true, since: '2026-09-26T12:00:00.000Z', departments: [] },
      ],
    });
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Hospital team' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));

    const patch = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/admin/staff/m1') && (options as RequestInit | undefined)?.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toMatchObject({ role: 'nurse', active: true, departmentIds: [] });
    expect(await screen.findByText('Team member updated.')).toBeInTheDocument();
  });

  it('creates appointment slots from the admin schedule tab', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' }, {
      departments: [
        { id: 'd1', name: 'General Medicine', averageConsultationMinutes: 15 },
      ],
    });
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }));
    expect(await screen.findByLabelText('Slot department')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create slots' }));

    const slotPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/admin/slots') && (options as RequestInit | undefined)?.method === 'POST');
    expect(slotPost).toBeDefined();
    expect(JSON.parse(String((slotPost?.[1] as RequestInit).body))).toMatchObject({
      departmentId: 'd1',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      startTime: '09:00',
      endTime: '12:00',
      slotMinutes: 15,
      capacity: 3,
    });
    expect(await screen.findByText(/Created 3 slots for General Medicine/)).toBeInTheDocument();
  });

  it('lists published slots with their capacity on the schedule tab', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' }, {
      departments: [
        { id: 'd1', name: 'General Medicine', averageConsultationMinutes: 15 },
      ],
      slots: [
        { id: 's1', departmentId: 'd1', departmentName: 'General Medicine', date: '2026-10-01', startTime: '09:00', endTime: '09:15', capacity: 3, reservedCount: 1 },
      ],
    });
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText('General Medicine')).toBeInTheDocument();
    expect(screen.getByText(/2026-10-01 · 09:00–09:15/)).toBeInTheDocument();
    expect(screen.getByText('1/3 booked')).toBeInTheDocument();
  });

  it("shows today's operations on the overview tab", async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' }, {
      overview: {
        date: '2026-09-27',
        totals: { slotsToday: 12, capacityToday: 36, reservedToday: 9, appointmentsBooked: 7, appointmentsCancelled: 1, queueWaiting: 4, queueCalled: 1, activeMembers: 6, pendingInvitations: 2 },
        departments: [
          { id: 'd1', name: 'General Medicine', averageConsultationMinutes: 15, slotsToday: 12, capacityToday: 36, reservedToday: 9, appointmentsBooked: 7, appointmentsCancelled: 1, queueWaiting: 4, queueCalled: 1 },
        ],
      },
    });
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: "Today's operations" })).toBeInTheDocument();
    expect(await screen.findByText('9/36 slots')).toBeInTheDocument();
    expect(screen.getByText('7 booked')).toBeInTheDocument();
    expect(screen.getByText('5 waiting')).toBeInTheDocument();
    expect(screen.getByText(/2 pending invitations/)).toBeInTheDocument();
  });

  it('creates a department from the departments tab', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' }, {
      adminDepartments: [
        { id: 'd1', name: 'General Medicine', averageConsultationMinutes: 15, active: true, slotCount: 0, appointmentCount: 0 },
      ],
    });
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Departments' }));
    await userEvent.type(await screen.findByLabelText('Department name'), 'Radiology');
    await userEvent.click(screen.getByRole('button', { name: 'Add department' }));

    const departmentPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/admin/departments') && (options as RequestInit | undefined)?.method === 'POST');
    expect(departmentPost).toBeDefined();
    expect(JSON.parse(String((departmentPost?.[1] as RequestInit).body))).toMatchObject({ name: 'Radiology', averageConsultationMinutes: 15 });
    expect(await screen.findByText(/Department "Radiology" created/)).toBeInTheDocument();
  });

  it('generates and shows a waiting-room display link', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' });
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Display' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Generate display link' }));

    const rotate = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/admin/display/rotate') && (options as RequestInit | undefined)?.method === 'POST');
    expect(rotate).toBeDefined();
    expect(await screen.findByText(/kiosk-token-123/)).toBeInTheDocument();
    expect(screen.getByText('Display on')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn display off' })).toBeInTheDocument();
  });

  it('lists staff actions on the activity tab', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' }, {
      auditEvents: [
        {
          id: 'e1',
          action: 'staff_invitation.created',
          entityType: 'staff_invitation',
          entityId: null,
          metadata: { email: 'nurse@example.com', role: 'nurse', departmentIds: [] },
          createdAt: '2026-09-27T10:00:00.000Z',
          actor: { displayName: 'Amina Dlamini', email: 'admin@example.com' },
        },
        {
          id: 'e2',
          action: 'appointment_slots.created',
          entityType: 'appointment_slot',
          entityId: null,
          metadata: { departmentName: 'General Medicine', created: 3, date: '2026-10-01' },
          createdAt: '2026-09-27T11:00:00.000Z',
          actor: { displayName: 'Amina Dlamini', email: 'admin@example.com' },
        },
      ],
    });
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    expect(await screen.findByText('Invitation created')).toBeInTheDocument();
    expect(screen.getByText(/nurse@example\.com/)).toBeInTheDocument();
    expect(screen.getByText('Slots created')).toBeInTheDocument();
    expect(screen.getByText(/General Medicine · 3 slots · 2026-10-01/)).toBeInTheDocument();
  });

  it('starts the Auth0 sign-in flow from the landing page', async () => {
    renderAt('/');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('sends signed-in staff to their assigned dashboard', async () => {
    auth.state.isAuthenticated = true;
    stubCurrentUser({ userType: 'staff', staffRole: 'nurse' });
    renderAt('/signin');
    expect(await screen.findByRole('heading', { name: /Amina Dlamini/ })).toBeInTheDocument();
  });

  it('routes signed-in administrators on / to their dashboard', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome back, Amina Dlamini' })).toBeInTheDocument();
  });

  it('redirects the removed dashboard route to the landing page', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('heading', { name: 'Simple, Trusted Healthcare for Everyone' })).toBeInTheDocument();
  });
});
