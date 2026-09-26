import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { authenticatedRequest, type CurrentUser, type HospitalTeam, type TeamRole } from '../api.ts';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';

const roleLabels: Record<TeamRole, string> = {
  administrator: 'Administrator',
  nurse: 'Nurse',
  doctor: 'Doctor',
};

function formatMemberDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '' : new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(parsed);
}

export function AdminPortalPage() {
  const { isAuthenticated, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();
  const [access, setAccess] = useState<CurrentUser>();
  const [error, setError] = useState<string>();
  const [team, setTeam] = useState<HospitalTeam>();
  const [teamError, setTeamError] = useState<string>();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('nurse');
  const [inviteMessage, setInviteMessage] = useState<string>();
  const [inviteClaimUrl, setInviteClaimUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string>();
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) { setAccess(undefined); setError(undefined); setTeam(undefined); return; }
    let cancelled = false;
    async function load() {
      try {
        const token = await getAccessTokenSilently();
        const [me, teamResult] = await Promise.all([
          authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token),
          authenticatedRequest<{ data: HospitalTeam }>('/api/v1/admin/staff', token),
        ]);
        if (cancelled) return;
        setAccess(me.data);
        setTeam(teamResult.data);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load administrator access.');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isAuthenticated, getAccessTokenSilently]);

  if (isAuthenticated && access && access.staffRole !== 'administrator') return <Navigate to="/" replace />;

  async function refreshTeam() {
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: HospitalTeam }>('/api/v1/admin/staff', token);
      setTeam(result.data);
      setTeamError(undefined);
    } catch (refreshError) {
      setTeamError(refreshError instanceof Error ? refreshError.message : 'Could not refresh the team list.');
    }
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true); setInviteError(undefined); setInviteMessage(undefined); setInviteClaimUrl(undefined); setCopied(false);
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: { message: string; claimUrl: string } }>('/api/v1/admin/staff', token, { method: 'POST', body: { email: inviteEmail, role: inviteRole } });
      setInviteMessage(result.data.message);
      setInviteClaimUrl(result.data.claimUrl);
      setInviteEmail('');
      await refreshTeam();
    } catch (inviteFailure) {
      setInviteError(inviteFailure instanceof Error ? inviteFailure.message : 'Could not create invitation.');
    } finally {
      setInviting(false);
    }
  }

  async function copyClaimLink() {
    if (!inviteClaimUrl) return;
    try {
      await navigator.clipboard.writeText(inviteClaimUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  const adminName = access?.displayName ?? 'Admin';
  const hospitalName = team?.hospitalName ?? access?.hospitalName ?? 'your hospital';
  const displayInitial = adminName.trim().slice(0, 1).toUpperCase() || 'N';

  return (
    <div className="app nv-patient">
      <TopBar>
        <Brand />
        <TopNav items={[{ label: 'Hospital team', active: true }]} />
        <div className="actions">
          <button type="button" className="user-chip">
            <span style={{ fontWeight: 800 }}>{displayInitial}</span> <span>Hi, {adminName}</span>
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
            <p className="eyebrow">{hospitalName} · Admin portal</p>
            <h1>Welcome back, {adminName}</h1>
            <p className="muted">Invite administrators, nurses and doctors to {hospitalName}. Each person claims their invitation by email and lands on their own dashboard.</p>
          </div>
        </div>
      </section>

      {!isAuthenticated ? (
        <section className="card nv-care-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text)' }}>Administrator sign-in required</h3>
            <div className="muted small" style={{ marginTop: 4 }}>Sign in with your assigned administrator email to manage your hospital team.</div>
          </div>
          <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
        </section>
      ) : null}
      {error ? <p className="nv-error" role="alert" style={{ margin: '12px 4px 0' }}>{error}</p> : null}

      <section className="nv-care-view">
        <section className="card nv-care-card" aria-label="Hospital team">
          <header className="nv-care-card-head">
            <h2 className="section-title">Hospital team</h2>
            <p className="muted small">Nurses and doctors are assigned across all specialties at {hospitalName}. Invitations expire in 72 hours.</p>
          </header>
          <div className="nv-finder-grid">
            <div className="nv-finder-controls">
              {access ? (
                <form className="nv-book-form" style={{ borderTop: 'none', paddingTop: 0 }} onSubmit={(event) => void invite(event)}>
                  <label className="nv-field">Team member email
                    <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" required />
                  </label>
                  <label className="nv-field">Role
                    <select aria-label="Invite role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as TeamRole)}>
                      <option value="administrator">Administrator</option>
                      <option value="nurse">Nurse · all specialties</option>
                      <option value="doctor">Doctor · all specialties</option>
                    </select>
                  </label>
                  {inviteError ? <p className="nv-error" role="alert">{inviteError}</p> : null}
                  {inviteMessage ? <p className="nv-notice" role="status">{inviteMessage}</p> : null}
                  {inviteClaimUrl ? (
                    <div className="nv-claim-box">
                      <strong className="small">Invitation link</strong>
                      <code>{inviteClaimUrl}</code>
                      <div className="nv-claim-copy">
                        <span className="muted small">Also sent by email. Open or share this link if the email does not arrive — the recipient must sign in with the invited email address.</span>
                        <button type="button" className="ghost-btn" onClick={() => void copyClaimLink()}>{copied ? 'Copied' : 'Copy link'}</button>
                      </div>
                    </div>
                  ) : null}
                  <div className="nv-book-actions">
                    <button type="submit" className="primary-btn" disabled={inviting}>{inviting ? 'Sending invitation…' : 'Send invitation'}</button>
                  </div>
                </form>
              ) : <p className="muted small">Sign in to send invitations.</p>}
            </div>
            <div className="nv-finder-detail">
              <div className="nv-detail-card">
                <div className="nv-access-list" style={{ borderTop: 'none', paddingTop: 0 }}>
                  <strong className="small">Team members</strong>
                  {teamError ? <p className="nv-error" role="alert">{teamError}</p> : null}
                  {team === undefined && !teamError ? <p className="muted small">Loading the team…</p> : null}
                  {team && team.members.length === 0 && team.pendingInvitations.length === 0 ? (
                    <p className="muted small" style={{ margin: 0 }}>No team members yet — send the first invitation.</p>
                  ) : null}
                  {team?.members.map((member) => (
                    <p key={member.email ?? member.displayName} className="nv-access-row">
                      <span>
                        {member.displayName || member.email}
                        <small className="muted"> · {member.email}</small>
                        <small className="muted"> · since {formatMemberDate(member.since)}</small>
                      </span>
                      <span>
                        <span className="badge blue">{roleLabels[member.role]}</span>{' '}
                        <span className="badge green">Active</span>
                      </span>
                    </p>
                  ))}
                  {team?.pendingInvitations.map((invitation) => (
                    <p key={`${invitation.email}-${invitation.role}`} className="nv-access-row">
                      <span>
                        {invitation.email}
                        <small className="muted"> · {roleLabels[invitation.role]} invitation</small>
                      </span>
                      <span className={`badge ${new Date(invitation.expiresAt) < new Date() ? 'red' : 'yellow'}`}>
                        {new Date(invitation.expiresAt) < new Date() ? 'Expired' : 'Invitation pending'}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
