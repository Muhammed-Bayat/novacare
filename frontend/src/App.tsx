import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { authenticatedRequest, type CurrentUser } from './api.ts';

interface SampleResource {
  data: { message: string };
}

function Dashboard() {
  const { user, isAuthenticated, isLoading, error, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();
  const [localUser, setLocalUser] = useState<CurrentUser>();
  const [sampleMessage, setSampleMessage] = useState<string>();
  const [requestError, setRequestError] = useState<string>();

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    async function loadDashboard() {
      try {
        const token = await getAccessTokenSilently();
        const me = await authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token);
        const sample = await authenticatedRequest<SampleResource>('/api/v1/sample', token);
        if (!cancelled) {
          setLocalUser(me.data);
          setSampleMessage(sample.data.message);
        }
      } catch (loadError) {
        if (!cancelled) {
          setRequestError(loadError instanceof Error ? loadError.message : 'Could not load your dashboard');
        }
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [getAccessTokenSilently, isAuthenticated]);

  if (isLoading) return <main className="status">Loading NovaCare...</main>;
  if (error) return <main className="status">Authentication error: {error.message}</main>;

  if (!isAuthenticated) {
    return (
      <main className="landing">
        <p className="eyebrow">NovaCare platform</p>
        <h1>Care coordination starts with a trusted sign-in.</h1>
        <p>Sign in to connect your NovaCare profile and protected API workspace.</p>
        <button type="button" onClick={() => void loginWithRedirect()}>
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <header>
        <div>
          <p className="eyebrow">NovaCare</p>
          <h1>Welcome, {user?.name ?? user?.email ?? 'there'}</h1>
        </div>
        <button type="button" className="secondary" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
          Sign out
        </button>
      </header>
      <section aria-label="Connection status">
        <h2>Platform connection</h2>
        {requestError ? <p role="alert">API error: {requestError}</p> : null}
        {!requestError && !localUser ? <p>Synchronizing your secure profile...</p> : null}
        {localUser ? <p>Profile synchronized for {localUser.auth0Subject}.</p> : null}
        {sampleMessage ? <p>{sampleMessage}</p> : null}
      </section>
    </main>
  );
}

function App() {
  const location = useLocation();
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="*" element={<Navigate to="/" replace state={{ from: location }} />} />
    </Routes>
  );
}

export default App;
