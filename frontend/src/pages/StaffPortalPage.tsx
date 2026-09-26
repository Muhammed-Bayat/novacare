import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { authenticatedRequest, type CurrentUser } from '../api.ts';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';

type StaffRole = 'nurse' | 'doctor';

const roleCopy: Record<StaffRole, { portal: string; label: string }> = {
  nurse: { portal: 'Staff', label: 'Nurse' },
  doctor: { portal: 'Doctor', label: 'Doctor' },
};

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function StaffPortalPage({ role }: { role: StaffRole }) {
  const { isAuthenticated, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();
  const [access, setAccess] = useState<CurrentUser>();
  const [error, setError] = useState<string>();
  const copy = roleCopy[role];

  useEffect(() => {
    if (!isAuthenticated) { setAccess(undefined); setError(undefined); return; }
    let cancelled = false;
    async function load() {
      try {
        const token = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token);
        if (!cancelled) setAccess(result.data);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load your hospital access.');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isAuthenticated, getAccessTokenSilently]);

  if (isAuthenticated && access && access.staffRole !== role) return <Navigate to="/" replace />;

  const displayName = access?.displayName ?? copy.portal;
  const hospitalName = access?.hospitalName;
  const displayInitial = displayName.trim().slice(0, 1).toUpperCase() || 'N';

  return (
    <div className="app nv-patient">
      <TopBar>
        <Brand />
        <TopNav items={[{ label: `${copy.portal} workspace`, active: true }]} />
        <div className="actions">
          <button type="button" className="user-chip">
            <span style={{ fontWeight: 800 }}>{displayInitial}</span> <span>Hi, {displayName}</span>
          </button>
          {isAuthenticated ? (
            <button type="button" className="ghost-btn" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Logout</button>
          ) : (
            <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
          )}
        </div>
      </TopBar>

      <section className="hero-card hero nv-patient-hero">
        <div className="hero-left">
          <div className="hero-copy">
            <p className="eyebrow">{hospitalName ? `${hospitalName} · ` : ''}{copy.portal} portal</p>
            <h1>{greetingFor(new Date().getHours())}, {displayName}</h1>
            <p className="muted">
              {role === 'nurse'
                ? `You are assigned to ${hospitalName ?? 'your hospital'} across all specialties. Patient queues and appointments will appear here as NovaCare rolls out hospital workflows.`
                : `You are the on-duty medical officer at ${hospitalName ?? 'your hospital'} across all specialties. Patient queues and referrals will appear here as NovaCare rolls out hospital workflows.`}
            </p>
          </div>
        </div>
      </section>

      {!isAuthenticated ? (
        <section className="card nv-care-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text)' }}>{copy.portal} sign-in required</h3>
            <div className="muted small" style={{ marginTop: 4 }}>Sign in with your invited hospital email to open your {copy.portal.toLowerCase()} workspace.</div>
          </div>
          <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
        </section>
      ) : null}
      {error ? <p className="nv-error" role="alert" style={{ margin: '12px 4px 0' }}>{error}</p> : null}

      {isAuthenticated && access ? (
        <section className="nv-care-view">
          <section className="card nv-care-card" aria-label="Your assignment">
            <header className="nv-care-card-head">
              <h2 className="section-title">Your assignment</h2>
              <p className="muted small">How NovaCare routes patients to you once hospital workflows go live.</p>
            </header>
            <div className="nv-access-list" style={{ borderTop: 'none', paddingTop: 0 }}>
              <p className="nv-access-row">
                <span>Role<small className="muted"> · how you appear to the hospital team</small></span>
                <span className="badge blue">{copy.label}</span>
              </p>
              <p className="nv-access-row">
                <span>Hospital<small className="muted"> · where you see patients</small></span>
                <span>{hospitalName ?? '—'}</span>
              </p>
              <p className="nv-access-row">
                <span>Specialties<small className="muted"> · cases routed to you</small></span>
                <span className="badge green">All specialties</span>
              </p>
              <p className="nv-access-row">
                <span>Status</span>
                <span className="badge green">Active</span>
              </p>
            </div>
          </section>
        </section>
      ) : null}
    </div>
  );
}
