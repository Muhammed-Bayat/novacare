import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { authenticatedRequest, type CurrentUser } from '../api.ts';
import { Brand, TopBar } from '../components/TopBar.tsx';
import logo from '../assets/nova-care-logo.png';
import '../styles/admin-portal.css';

const sideLinks = [
  { label: 'Overview', active: true },
  { label: 'Users' },
  { label: 'Staff' },
  { label: 'Clinics' },
  { label: 'Reports' },
  { label: 'Settings' },
];

const metrics = [
  { icon: 'Patients', iconBackground: undefined, label: 'Total Patients', value: '12,482', note: '+12% from last month', noteColor: '#14a06f' },
  { icon: 'Staff', iconBackground: '#e4faf0', label: 'Staff On Duty', value: '86', note: '+6% from last week', noteColor: '#14a06f' },
  { icon: 'Visits', iconBackground: '#f1ecff', label: 'Appointments Today', value: '248', note: '+8% from yesterday', noteColor: '#14a06f' },
  { icon: 'Lang', iconBackground: undefined, label: 'Language Usage', value: '11', note: 'Active languages', noteColor: undefined },
  { icon: 'Health', iconBackground: '#e4faf0', label: 'System Health', value: '99.9%', note: 'All systems operational', noteColor: '#14a06f' },
  { icon: 'Support', iconBackground: undefined, label: 'Support Tickets', value: '12', note: '+3 from yesterday', noteColor: '#de4a48' },
];

const growth = [
  { month: 'Nov', height: '38%' },
  { month: 'Dec', height: '50%' },
  { month: 'Jan', height: '61%' },
  { month: 'Feb', height: '69%' },
  { month: 'Mar', height: '78%' },
  { month: 'Apr', height: '88%' },
];

const appointmentTypes = [
  'General Checkup 42%',
  'Follow-up 24%',
  'Specialist 18%',
  'Lab Test 10%',
  'Vaccination 6%',
];

const activity = [
  { event: 'New patient registered', detail: 'Maria Santos', time: '2m ago' },
  { event: 'Appointment scheduled', detail: 'James Wilson', time: '15m ago' },
  { event: 'Staff member added', detail: 'Dr. Aisha Rahman', time: '1h ago' },
  { event: 'Clinic information updated', detail: 'Downtown Medical Center', time: '2h ago' },
  { event: 'Prescription refill completed', detail: 'Robert Kim', time: '3h ago' },
  { event: 'Support ticket resolved', detail: '#NC-4821', time: '4h ago' },
  { event: 'System backup completed', detail: 'All data successfully backed up', time: '8h ago' },
];

const users = [
  { name: 'John Smith', email: 'john.smith@novacare.com', role: 'Staff', roleClassName: 'badge blue', clinic: 'Downtown Medical', status: 'Active', statusClassName: 'badge green', lastActive: '2 hours ago' },
  { name: 'Emily Park', email: 'emily.park@novacare.com', role: 'Patient', roleClassName: 'badge green', clinic: '—', status: 'Active', statusClassName: 'badge green', lastActive: '1 day ago' },
  { name: 'Dr. Michael Rodriguez', email: 'm.rodriguez@novacare.com', role: 'Staff', roleClassName: 'badge blue', clinic: 'Riverside Clinic', status: 'Active', statusClassName: 'badge green', lastActive: '3 hours ago' },
  { name: 'Lisa Tan', email: 'lisa.tan@novacare.com', role: 'Admin', roleClassName: 'badge', clinic: '—', status: 'Active', statusClassName: 'badge green', lastActive: '5 hours ago' },
  { name: 'Kevin Wong', email: 'kevin.wong@novacare.com', role: 'Patient', roleClassName: 'badge green', clinic: '—', status: 'Inactive', statusClassName: 'badge gray', lastActive: '7 days ago' },
];

export function AdminPortalPage() {
  const { isAuthenticated, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();
  const [access, setAccess] = useState<CurrentUser>();
  const [error, setError] = useState<string>();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'nurse' | 'doctor'>('nurse');
  const [inviteMessage, setInviteMessage] = useState<string>();
  const [inviteError, setInviteError] = useState<string>();
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) { setAccess(undefined); setError(undefined); return; }
    let cancelled = false;
    async function load() {
      try {
        const token = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token);
        if (!cancelled) setAccess(result.data);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load administrator access.');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isAuthenticated, getAccessTokenSilently]);

  if (isAuthenticated && access && access.staffRole !== 'administrator') return <Navigate to="/" replace />;

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true); setInviteError(undefined); setInviteMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: { message: string } }>('/api/v1/admin/staff', token, { method: 'POST', body: { email: inviteEmail, role: inviteRole } });
      setInviteMessage(result.data.message);
      setInviteEmail('');
    } catch (inviteFailure) {
      setInviteError(inviteFailure instanceof Error ? inviteFailure.message : 'Could not create invitation.');
    } finally {
      setInviting(false);
    }
  }

  const today = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'full' }).format(new Date());
  const adminName = access?.displayName ?? 'Admin';

  return (
    <div className="app nv-admin">
      <TopBar>
        <Brand />
        <div style={{ flex: 1, maxWidth: 560 }}>
          <input className="search" placeholder="Search patients, staff, clinics, or anything..." />
        </div>
        <div className="actions">
          <button type="button" className="icon-btn" aria-label="Notifications">N</button>
          <button type="button" className="user-chip">{adminName} · Hospital Administrator</button>
          {isAuthenticated ? (
            <button type="button" className="ghost-btn" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Sign out</button>
          ) : (
            <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
          )}
        </div>
      </TopBar>

      <div className="layout">
        <aside className="sidebar">
          {sideLinks.map((link) => (
            <a key={link.label} className={link.active ? 'side-link active' : 'side-link'} href="#">
              {link.label}
            </a>
          ))}
        </aside>

        <main>
          <section className="head">
            <div>
              <div className="muted small" style={{ letterSpacing: 2, textTransform: 'uppercase', fontWeight: 800, color: '#5d7eb4' }}>Admin Portal</div>
              <h1>Welcome back, {adminName}</h1>
              <div className="muted">Here’s what’s happening at {access?.hospitalName ?? 'Nova Care'} today.</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <strong>{today}</strong>
              <div className="muted small" style={{ marginTop: 4 }}>A healthier tomorrow starts here.</div>
            </div>
          </section>

          {!isAuthenticated ? (
            <section className="card cardpad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ color: 'var(--text)' }}>Administrator sign-in required</strong>
                <div className="muted small" style={{ marginTop: 4 }}>Sign in with your assigned administrator email to invite staff and doctors.</div>
              </div>
              <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
            </section>
          ) : null}
          {error ? <p className="small" style={{ color: '#de4a48', margin: '12px 0 0' }}>{error}</p> : null}

          <section className="metrics">
            {metrics.map((metric) => (
              <div key={metric.label} className="card metric">
                <div className="icon-circle" style={metric.iconBackground ? { background: metric.iconBackground } : undefined}>{metric.icon}</div>
                <div>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small className={metric.noteColor ? undefined : 'muted'} style={metric.noteColor ? { color: metric.noteColor } : undefined}>{metric.note}</small>
                </div>
              </div>
            ))}
          </section>

          <section className="board">
            <article className="card cardpad">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--text)' }}>Patient Growth</h3>
                  <div className="small muted">Total registered patients over the last 6 months</div>
                </div>
                <button type="button" className="ghost-btn">Last 6 months</button>
              </div>
              <div className="bars">
                {growth.map((month) => (
                  <div key={month.month} className="bar" style={{ height: month.height }}>
                    <span>{month.month}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="card cardpad">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: 'var(--text)' }}>Appointments by Type</h3>
                <button type="button" className="ghost-btn">This month</button>
              </div>
              <div className="donut" />
              <div className="small muted" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {appointmentTypes.map((type) => (
                  <span key={type}>{type}</span>
                ))}
              </div>
            </article>

            <article className="card cardpad activity">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: 'var(--text)' }}>Recent Activity</h3>
                <a style={{ color: 'var(--blue)', fontWeight: 800 }} href="#">View all</a>
              </div>
              {activity.map((item) => (
                <div key={item.event} className="row">
                  <span>
                    {item.event}<br />
                    <small className="muted">{item.detail}</small>
                  </span>
                  <small>{item.time}</small>
                </div>
              ))}
            </article>

            <article className="card cardpad users">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--text)' }}>Users Management</h3>
                  <div className="small muted">Manage patients, staff, and admin users</div>
                </div>
                {access ? null : <button type="button" className="ghost-btn">Add User</button>}
              </div>
              {access ? (
                <form onSubmit={(event) => void invite(event)} style={{ display: 'flex', gap: 10, margin: '0 0 14px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input className="search" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="Invite a staff member or doctor by email" required style={{ flex: 1, minWidth: 220 }} />
                  <select className="search" aria-label="Invite role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'nurse' | 'doctor')} style={{ width: 'auto' }}>
                    <option value="nurse">Staff</option>
                    <option value="doctor">Doctor</option>
                  </select>
                  <button type="submit" className="primary-btn" disabled={inviting}>{inviting ? 'Inviting...' : 'Invite'}</button>
                  {inviteMessage ? <span className="small" style={{ color: '#14a06f', fontWeight: 800 }}>{inviteMessage}</span> : null}
                  {inviteError ? <span className="small" role="alert" style={{ color: '#de4a48', fontWeight: 800 }}>{inviteError}</span> : null}
                </form>
              ) : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Clinic / Department</th>
                      <th>Status</th>
                      <th>Last Active</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.email}>
                        <td>
                          <strong>{user.name}</strong>
                          <br />
                          <small className="muted">{user.email}</small>
                        </td>
                        <td>
                          <span className={user.roleClassName} style={user.roleClassName === 'badge' ? { background: '#eeeaff', color: '#6458c7' } : undefined}>{user.role}</span>
                        </td>
                        <td>{user.clinic}</td>
                        <td>
                          <span className={user.statusClassName}>{user.status}</span>
                        </td>
                        <td>{user.lastActive}</td>
                        <td>•••</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card cardpad promo">
              <div>
                <strong style={{ fontSize: 24, color: 'var(--text)' }}>
                  Stronger Communities<br />Healthier Tomorrows
                </strong>
                <div className="muted small" style={{ marginTop: 10 }}>Manage. Support. Make a difference.</div>
              </div>
              <img src={logo} alt="Nova Care" style={{ height: 86 }} />
            </article>
          </section>
        </main>
      </div>
    </div>
  );
}
