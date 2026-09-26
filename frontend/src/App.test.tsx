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

function stubUserType(userType: string) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { userType } }) })));
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

  it('renders the staff portal at /staff', () => {
    renderAt('/staff');
    expect(screen.getByRole('heading', { name: 'Good morning, Dr. Mitchell' })).toBeInTheDocument();
  });

  it('renders the admin portal at /admin', () => {
    renderAt('/admin');
    expect(screen.getByRole('heading', { name: 'Welcome back, Admin' })).toBeInTheDocument();
  });

  it('starts the Auth0 sign-in flow from the landing page', async () => {
    renderAt('/');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('sends signed-in users to the portal matching their user type', async () => {
    auth.state.isAuthenticated = true;
    stubUserType('staff');
    renderAt('/signin');
    expect(await screen.findByRole('heading', { name: 'Good morning, Dr. Mitchell' })).toBeInTheDocument();
  });

  it('routes signed-in visitors on / to their portal', async () => {
    auth.state.isAuthenticated = true;
    stubUserType('admin');
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome back, Admin' })).toBeInTheDocument();
  });

  it('redirects the removed dashboard route to the landing page', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('heading', { name: 'Simple, Trusted Healthcare for Everyone' })).toBeInTheDocument();
  });
});
