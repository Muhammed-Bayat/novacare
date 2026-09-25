import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.tsx';

const auth = vi.hoisted(() => ({
  state: { isAuthenticated: false, isLoading: false, error: undefined as Error | undefined },
  loginWithRedirect: vi.fn(),
  getAccessTokenSilently: vi.fn(async () => 'test-token'),
}));

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    ...auth.state,
    loginWithRedirect: auth.loginWithRedirect,
    getAccessTokenSilently: auth.getAccessTokenSilently,
  }),
}));

function stubUserType(userType: string) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { userType } }) })));
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
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the public landing page at /', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Simple, Trusted Healthcare for Everyone' })).toBeInTheDocument();
  });

  it('renders the patient portal at /patient', () => {
    renderAt('/patient');
    expect(screen.getByRole('heading', { name: 'Welcome back, Thandi 👋' })).toBeInTheDocument();
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
