import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { authenticatedRequest, type CurrentUser } from '../api.ts';
import { Brand, SearchButton, TopBar, TopNav } from '../components/TopBar.tsx';
import logo from '../assets/nova-care-logo.png';
import '../styles/staff-portal.css';

type StaffRole = 'nurse' | 'doctor';

const roleCopy: Record<StaffRole, { portal: string; mockName: string; mockChip: string }> = {
  nurse: { portal: 'Staff', mockName: 'Sarah Mitchell', mockChip: 'Sarah Mitchell · Staff' },
  doctor: { portal: 'Doctor', mockName: 'Dr. Mitchell', mockChip: 'Dr. Sarah Mitchell' },
};

const navItems = [
  { label: 'Overview', active: true },
  { label: 'Patients' },
  { label: 'Appointments' },
  { label: 'Tasks' },
  { label: 'Messages' },
  { label: 'Records' },
];

const metrics = [
  { icon: 'Appt', iconBackground: undefined, value: '12', label: 'Appointments Today', note: '3 in progress', noteClassName: 'muted' },
  { icon: 'Care', iconBackground: undefined, value: '28', label: 'Patients in Care', note: '6 new this week', noteClassName: 'muted' },
  { icon: 'Task', iconBackground: '#e4faf0', value: '5', label: 'Pending Tasks', note: '2 high priority', noteClassName: undefined },
  { icon: 'Msg', iconBackground: '#f1ecff', value: '3', label: 'New Messages', note: '1 requires response', noteClassName: 'muted' },
];

const appointments = [
  { time: '8:00 AM', name: 'John Davis', detail: 'Age 58 · #NC38492', reason: 'Annual Check-up', status: 'Checked In', statusClassName: 'badge green', action: 'View' },
  { time: '8:30 AM', name: 'Emily Martinez', detail: 'Age 34 · #NC76103', reason: 'Follow-up', status: 'In Room', statusClassName: 'badge blue', action: 'View' },
  { time: '9:00 AM', name: 'Robert Wilson', detail: 'Age 67 · #NC55821', reason: 'Blood Pressure', status: 'Scheduled', statusClassName: 'badge blue', action: 'Check In' },
  { time: '9:30 AM', name: 'Sophia Lee', detail: 'Age 29 · #NC84721', reason: 'Sinus Infection', status: 'Scheduled', statusClassName: 'badge blue', action: 'Check In' },
  { time: '10:00 AM', name: 'Michael Chen', detail: 'Age 45 · #NC63901', reason: 'Diabetes Follow-up', status: 'Scheduled', statusClassName: 'badge blue', action: 'Check In' },
  { time: '10:30 AM', name: 'Ava Patel', detail: 'Age 12 · #NC77211', reason: 'Well Child Visit', status: 'Scheduled', statusClassName: 'badge blue', action: 'Check In' },
];

const tasks = [
  { title: 'Review lab results', patient: 'Robert Wilson', priority: 'High', priorityClassName: 'badge red' },
  { title: 'Sign prescription', patient: 'Emily Martinez', priority: 'High', priorityClassName: 'badge red' },
  { title: 'Follow up call', patient: 'Daniel Carter', priority: 'Medium', priorityClassName: 'badge yellow' },
  { title: 'Review imaging report', patient: 'Karen Lewis', priority: 'Low', priorityClassName: 'badge green' },
];

const triageQueue = [
  { complaint: 'Migraine, severe pain', patient: 'Olivia Brown · 28y', waiting: '12 min' },
  { complaint: 'Chest discomfort', patient: 'James Miller · 62y', waiting: '18 min' },
  { complaint: 'Persistent cough', patient: 'Liam Anderson · 45y', waiting: '25 min' },
  { complaint: 'Medication question', patient: 'Noah White · 38y', waiting: '41 min' },
];

const recentMessages = [
  { subject: 'Lab results available', sender: 'From: Central Lab', received: '10:24 AM' },
  { subject: 'Patient follow-up', sender: 'From: Nurse Kelly', received: '9:18 AM' },
  { subject: 'Referral update', sender: 'From: Dr. James Park', received: 'Yesterday' },
];

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

  const displayName = access?.displayName ?? copy.mockName;
  const greeting = `${greetingFor(new Date().getHours())}, ${displayName}`;

  return (
    <div className="app nv-staff">
      <TopBar>
        <Brand />
        <TopNav items={navItems} />
        <div className="actions">
          <SearchButton />
          <button type="button" className="user-chip">{access?.displayName ?? copy.mockChip}</button>
          {isAuthenticated ? (
            <button type="button" className="ghost-btn" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Sign out</button>
          ) : (
            <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
          )}
        </div>
      </TopBar>

      <section className="head">
        <div className="welcome">
          <h1>{greeting}</h1>
          <p className="muted" style={{ fontSize: 18 }}>{access?.hospitalName ? `${access.hospitalName} · ` : ''}Compassionate care makes a healthier tomorrow.</p>
        </div>
        <div className="hero-card side-banner">
          <div className="script">
            Better<br />Health<br />Brighter<br />Days
          </div>
          <div className="motto">
            <div>
              <strong style={{ fontSize: 24, color: 'var(--text)' }}>
                People. Care.<br />Stronger Together.
              </strong>
            </div>
            <img src={logo} alt="Nova Care" style={{ height: 68 }} />
          </div>
        </div>
      </section>

      {!isAuthenticated ? (
        <section className="card card-pad" style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text)' }}>{copy.portal} sign-in required</h3>
            <div className="muted small" style={{ marginTop: 4 }}>Sign in with your invited hospital email to open your {copy.portal.toLowerCase()} workspace.</div>
          </div>
          <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
        </section>
      ) : null}
      {error ? <p className="small" style={{ color: '#de4a48', margin: '12px 0 0' }}>{error}</p> : null}

      <section className="grid-4" style={{ marginTop: 18 }}>
        {metrics.map((metric) => (
          <div key={metric.label} className="card metric">
            <div className="icon-circle" style={metric.iconBackground ? { background: metric.iconBackground } : undefined}>{metric.icon}</div>
            <div>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
              <small className={metric.noteClassName} style={metric.noteClassName ? undefined : { color: '#de4a48' }}>{metric.note}</small>
            </div>
          </div>
        ))}
      </section>

      <section className="layout">
        <article className="card card-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="section-title" style={{ fontSize: 24 }}>Today’s Appointments</h2>
            <a style={{ color: 'var(--blue)', fontWeight: 800 }} href="#">View Full Schedule</a>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Reason for Visit</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((appointment) => (
                  <tr key={appointment.detail}>
                    <td>
                      <strong>{appointment.time}</strong>
                    </td>
                    <td>
                      <strong>{appointment.name}</strong>
                      <br />
                      <span className="small muted">{appointment.detail}</span>
                    </td>
                    <td>{appointment.reason}</td>
                    <td>
                      <span className={appointment.statusClassName}>{appointment.status}</span>
                    </td>
                    <td>
                      <button type="button" className="secondary-btn">{appointment.action}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <div className="stack">
          <article className="card card-pad">
            <h3 style={{ margin: 0, color: 'var(--text)' }}>Patient Lookup</h3>
            <div className="muted small" style={{ margin: '6px 0 12px' }}>Search by name, DOB, or patient ID</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input className="search" placeholder="Search patients... (e.g. John Smith, 01/15/1980)" />
              <button type="button" className="primary-btn">Search</button>
            </div>
          </article>

          <div className="split">
            <article className="card card-pad">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, color: 'var(--text)' }}>Pending Tasks</h3>
                <a style={{ color: 'var(--blue)', fontWeight: 800 }}>View All</a>
              </div>
              {tasks.map((task) => (
                <div key={task.patient} className="task">
                  <span>
                    {task.title}<br />
                    <small className="muted">{task.patient}</small>
                  </span>
                  <span className={task.priorityClassName}>{task.priority}</span>
                </div>
              ))}
            </article>

            <article className="card card-pad">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, color: 'var(--text)' }}>Triage Queue</h3>
                <a style={{ color: 'var(--blue)', fontWeight: 800 }}>View All</a>
              </div>
              {triageQueue.map((entry) => (
                <div key={entry.patient} className="task">
                  <span>
                    {entry.complaint}<br />
                    <small className="muted">{entry.patient}</small>
                  </span>
                  <small>{entry.waiting}</small>
                </div>
              ))}
            </article>
          </div>

          <div className="split">
            <article className="card card-pad">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, color: 'var(--text)' }}>Recent Messages</h3>
                <a style={{ color: 'var(--blue)', fontWeight: 800 }}>View All</a>
              </div>
              {recentMessages.map((message) => (
                <div key={message.subject} className="task">
                  <span>
                    {message.subject}<br />
                    <small className="muted">{message.sender}</small>
                  </span>
                  <small>{message.received}</small>
                </div>
              ))}
            </article>

            <article className="card card-pad">
              <h3 style={{ margin: '0 0 14px', color: 'var(--text)' }}>Quick Actions</h3>
              <div className="grid-2">
                <button type="button" className="ghost-btn">Check In Patient</button>
                <button type="button" className="ghost-btn">Update Record</button>
                <button type="button" className="ghost-btn">Send Message</button>
                <button type="button" className="ghost-btn">Place Order</button>
              </div>
            </article>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="brand">
          <img src={logo} alt="Nova Care" />
        </div>
        <div className="small">Help &amp; Support · Privacy Policy · Terms of Service · Accessibility</div>
      </footer>
    </div>
  );
}
