import { render, screen } from '@testing-library/react';
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

function stubCurrentUser(user: { userType?: string; isPlatformOperator?: boolean; staffRole?: 'administrator' | 'nurse' | 'doctor' | null; hospitalName?: string | null }) {
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

function stubAdminData(user: Parameters<typeof stubCurrentUser>[0] = {}, members: unknown[] = [], pendingInvitations: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/admin/staff')) {
      return { ok: true, json: async () => ({ data: { hospitalId: 'h1', hospitalName: 'Charlotte Maxeke Johannesburg Academic Hospital', members, pendingInvitations } }) };
    }
    return { ok: true, json: async () => ({ data: { id: 'user-1', auth0Subject: 'auth0|user-1', email: 'user@example.com', displayName: 'Amina Dlamini', userType: 'patient', isPlatformOperator: false, staffRole: null, hospitalId: null, hospitalName: null, ...user } }) };
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

  it('lets patients complete the AI questionnaire and open recommended booking', async () => {
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
        services: [{ id: 's1', name: 'Orthopaedics' }, { id: 's2', name: 'Emergency Department' }],
      },
    ], {
      pathwayId: 'injury',
      pathwayName: 'Injury & musculoskeletal',
      summary: 'Recent injury with difficulty walking.',
      department: 'Orthopaedics',
      urgency: 'priority',
      source: 'gemini',
      questions: [
        { id: 'weight_bearing', text: 'Can you use or put weight on the injured area?', type: 'single', options: [{ id: 'yes', label: 'Yes', value: 'normal' }, { id: 'no', label: 'No', value: 'no' }] },
        { id: 'pain_level', text: 'How severe is the pain?', type: 'scale', min: 0, max: 10 },
      ],
    });

    renderAt('/patient');
    await userEvent.click(screen.getByRole('button', { name: 'I hurt my ankle today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start questionnaire' }));
    expect(await screen.findByRole('heading', { name: 'Can you use or put weight on the injured area?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'See recommendation' }));

    expect(screen.getByRole('heading', { name: 'Emergency Department' })).toBeInTheDocument();
    expect(screen.getByText('Emergency assessment')).toBeInTheDocument();
    expect(screen.getByText('Helen Joseph Hospital')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Book here' }));
    expect(screen.getByRole('heading', { name: 'Appointments' })).toBeInTheDocument();
    expect(screen.getByText('emergency assessment')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    const appointmentPost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/appointments') && (options as RequestInit | undefined)?.method === 'POST');
    expect(appointmentPost).toBeDefined();
    const body = JSON.parse(String((appointmentPost?.[1] as RequestInit).body));
    expect(body).toMatchObject({ hospitalId: 'h1', serviceId: 's2', triageSummary: { urgency: 'emergency', pathwayName: 'Injury & musculoskeletal' } });
  });

  it('ranks recommended hospitals by distance when location is available', async () => {
    auth.state.isAuthenticated = true;
    stubPatientData([], [], [
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
        services: [{ id: 's2', name: 'General Consultation' }],
      },
    ], {
      pathwayId: 'headache',
      pathwayName: 'Headache & neurological',
      summary: 'Persistent headache.',
      department: 'General Medicine',
      urgency: 'priority',
      source: 'gemini',
      questions: [{ id: 'pain', text: 'How severe is the pain?', type: 'scale', min: 0, max: 10 }],
    });
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: -26.18, longitude: 28.03 } } as GeolocationPosition),
      },
    });
    try {
      renderAt('/patient');
      await userEvent.click(screen.getByRole('button', { name: 'I have a bad headache' }));
      await userEvent.click(screen.getByRole('button', { name: 'Start questionnaire' }));
      expect(await screen.findByRole('heading', { name: 'How severe is the pain?' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'See recommendation' }));

      expect(await screen.findByText('Ranked by distance from your location.')).toBeInTheDocument();
      const nearCard = (await screen.findByText('Near Hospital')).closest('article');
      const farCard = screen.getByText('Far Hospital').closest('article');
      if (!nearCard || !farCard) throw new Error('expected both recommendation cards');
      expect(nearCard.compareDocumentPosition(farCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getAllByText(/km away/).length).toBe(2);
    } finally {
      Reflect.deleteProperty(window.navigator, 'geolocation');
    }
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

  it('renders the admin portal for an assigned administrator with the invite form', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' });
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Welcome back, Amina Dlamini' })).toBeInTheDocument();
    expect(screen.getByLabelText('Team member email')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
  });

  it.each([
    ['nurse', 'Nurse · all specialties'],
    ['doctor', 'Doctor · all specialties'],
    ['administrator', 'Administrator'],
  ])('invites a %s from the admin portal', async (role, optionLabel) => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' });
    renderAt('/admin');
    const emailInput = await screen.findByLabelText('Team member email');
    await userEvent.selectOptions(screen.getByLabelText('Role'), optionLabel);
    await userEvent.type(emailInput, `${role}@example.com`);
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    const invitePost = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url).includes('/api/v1/admin/staff') && (options as RequestInit | undefined)?.method === 'POST');
    expect(invitePost).toBeDefined();
    expect(JSON.parse(String((invitePost?.[1] as RequestInit).body))).toMatchObject({ email: `${role}@example.com`, role });
  });

  it('shows hospital team members and pending invitations on the admin portal', async () => {
    auth.state.isAuthenticated = true;
    stubAdminData({ userType: 'admin', staffRole: 'administrator' }, [
      { email: 'nurse@example.com', displayName: 'Amina Dlamini', role: 'nurse', since: '2026-09-26T12:00:00.000Z' },
    ], [
      { email: 'dr@example.com', role: 'doctor', expiresAt: '2026-09-29T12:00:00.000Z', sentAt: '2026-09-26T12:00:00.000Z' },
    ]);
    renderAt('/admin');
    expect(await screen.findByText(/nurse@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/dr@example\.com/)).toBeInTheDocument();
    expect(screen.getByText('Invitation pending')).toBeInTheDocument();
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
