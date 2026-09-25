import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import App from './App.tsx';

const loginWithRedirect = vi.fn();

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    isAuthenticated: false,
    isLoading: false,
    loginWithRedirect,
  }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

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

  it('shows the Auth0 sign-in entry point at /dashboard for anonymous visitors', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
