import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { authenticatedRequest, type CurrentUser } from '../api.ts';
import { getPortalPath } from '../portal.ts';
import '../styles/sign-in.css';

export function SignInPage() {
  const { isAuthenticated, isLoading, error, loginWithRedirect, getAccessTokenSilently } = useAuth0();
  const [portalPath, setPortalPath] = useState<string>();
  const [requestError, setRequestError] = useState<string>();

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    async function findPortal() {
      try {
        const token = await getAccessTokenSilently();
        const me = await authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token);
        if (!cancelled) setPortalPath(getPortalPath(me.data));
      } catch (lookupError) {
        if (!cancelled) {
          setRequestError(lookupError instanceof Error ? lookupError.message : 'Could not load your NovaCare profile');
        }
      }
    }

    void findPortal();
    return () => {
      cancelled = true;
    };
  }, [getAccessTokenSilently, isAuthenticated]);

  if (portalPath) return <Navigate to={portalPath} replace />;

  return (
    <main className="nv-signin">
      <section className="hero-card signin-card">
        {error ? (
          <>
            <h1>Sign-in could not be completed</h1>
            <p className="muted">{error.message}</p>
          </>
        ) : requestError ? (
          <>
            <h1>We could not load your NovaCare profile</h1>
            <p className="muted">{requestError}</p>
            <button type="button" className="primary-btn" onClick={() => window.location.reload()}>
              Try again
            </button>
          </>
        ) : isLoading || isAuthenticated ? (
          <>
            <h1>Signing you in…</h1>
            <p className="muted">Connecting your NovaCare profile.</p>
          </>
        ) : (
          <>
            <h1>Sign in to NovaCare</h1>
            <p className="muted">Use your NovaCare account to reach your assigned portal.</p>
            <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>
              Sign In
            </button>
          </>
        )}
      </section>
    </main>
  );
}
