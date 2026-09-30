import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  authenticatedRequest,
  type CurrentUser,
  type Hospital,
  type QuestionnaireUrgency,
  type StaffAppointment,
  type StaffQueueEntry,
  type StaffTriageEntry,
} from '../api.ts';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';
import '../styles/patient-portal.css';
import '../styles/patient-care.css';
import '../styles/staff-workspace.css';

type StaffRole = 'nurse' | 'doctor';

const roleCopy: Record<StaffRole, { portal: string; mockName: string; mockChip: string; tagline: string }> = {
  nurse: {
    portal: 'Staff',
    mockName: 'Sarah Mitchell',
    mockChip: 'Sarah Mitchell · Staff',
    tagline: 'Review AI intake, confirm triage, and keep every queue moving. Urgency takes effect after clinical confirmation.',
  },
  doctor: {
    portal: 'Doctor',
    mockName: 'Dr. Mitchell',
    mockChip: 'Dr. Sarah Mitchell',
    tagline: 'See your live hospital queue, call the next patient, complete consultations and refer between departments.',
  },
};

const categoryLabels: Record<QuestionnaireUrgency, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  priority: 'Priority',
  routine: 'Routine',
};

const statusLabels: Record<StaffQueueEntry['status'], string> = {
  waiting: 'Waiting',
  called: 'Called',
  in_consultation: 'In consultation',
};

const urgencyOptions: QuestionnaireUrgency[] = ['emergency', 'urgent', 'priority', 'routine'];

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function joinedTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function appointmentDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(parsed);
}

interface StaffData {
  access: CurrentUser | undefined;
  services: { id: string; name: string }[];
  appointments: StaffAppointment[];
  triage: StaffTriageEntry[];
  queue: StaffQueueEntry[];
  loading: boolean;
  error: string | undefined;
  bookingsError: string | undefined;
  triageError: string | undefined;
  queueError: string | undefined;
  refresh: () => Promise<void>;
}

function useStaffData(role: StaffRole, isAuthenticated: boolean, getToken: () => Promise<string>): StaffData {
  const loadingRef = useRef(false);
  const [access, setAccess] = useState<CurrentUser>();
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [appointments, setAppointments] = useState<StaffAppointment[]>([]);
  const [triage, setTriage] = useState<StaffTriageEntry[]>([]);
  const [queue, setQueue] = useState<StaffQueueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [bookingsError, setBookingsError] = useState<string>();
  const [triageError, setTriageError] = useState<string>();
  const [queueError, setQueueError] = useState<string>();

  const load = useCallback(async (silent: boolean) => {
    if (!isAuthenticated || loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const token = await getToken();
      const [me, hospitals] = await Promise.all([
        authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token),
        authenticatedRequest<{ data: Hospital[] }>('/api/v1/hospitals', token),
      ]);
      const [appointmentsResult, queueResult, triageResult] = await Promise.allSettled([
        authenticatedRequest<{ data: StaffAppointment[] }>('/api/v1/staff/appointments', token),
        authenticatedRequest<{ data: StaffQueueEntry[] }>('/api/v1/staff/queue', token),
        role === 'nurse'
          ? authenticatedRequest<{ data: StaffTriageEntry[] }>('/api/v1/staff/triage', token)
          : Promise.resolve({ data: [] as StaffTriageEntry[] }),
      ]);
      setAccess(me.data);
      const mine = (Array.isArray(hospitals.data) ? hospitals.data : []).find((hospital) => hospital.id === me.data.hospitalId);
      setServices(mine?.services ?? []);
      if (appointmentsResult.status === 'fulfilled') {
        setAppointments(Array.isArray(appointmentsResult.value.data) ? appointmentsResult.value.data : []);
        setBookingsError(undefined);
      } else {
        setBookingsError(appointmentsResult.reason instanceof Error ? appointmentsResult.reason.message : 'Could not load hospital bookings.');
      }
      if (queueResult.status === 'fulfilled') {
        setQueue(Array.isArray(queueResult.value.data) ? queueResult.value.data : []);
        setQueueError(undefined);
      } else {
        setQueueError(queueResult.reason instanceof Error ? queueResult.reason.message : 'Could not load the live queue.');
      }
      if (triageResult.status === 'fulfilled') {
        setTriage(Array.isArray(triageResult.value.data) ? triageResult.value.data : []);
        setTriageError(undefined);
      } else {
        setTriageError(triageResult.reason instanceof Error ? triageResult.reason.message : 'Could not load the triage worklist.');
      }
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your hospital workspace.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [role, isAuthenticated, getToken]);

  useEffect(() => {
    if (isAuthenticated) void load(false);
  }, [isAuthenticated, load]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = window.setInterval(() => void load(true), 15000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  return { access, services, appointments, triage, queue, loading, error, bookingsError, triageError, queueError, refresh };
}

const bookingQueueLabels: Record<NonNullable<StaffAppointment['queueStatus']>, string> = {
  awaiting_triage: 'Awaiting nurse triage',
  waiting: 'In live queue',
  called: 'Patient called',
  in_consultation: 'In consultation',
  referred: 'Referred',
  completed: 'Consultation completed',
  cancelled: 'Queue entry cancelled',
};

function ScheduleBoard({ entries, role, loading, loadError, onChanged }: { entries: StaffAppointment[]; role: StaffRole; loading: boolean; loadError?: string; onChanged: () => Promise<void> }) {
  const { getAccessTokenSilently } = useAuth0();
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const grouped = entries.reduce<Map<string, StaffAppointment[]>>((groups, entry) => {
    const group = groups.get(entry.date) ?? [];
    group.push(entry);
    groups.set(entry.date, group);
    return groups;
  }, new Map());

  async function markArrived(entry: StaffAppointment) {
    setBusyId(entry.id);
    setError(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest(`/api/v1/staff/appointments/${entry.id}/check-in`, token, { method: 'POST' });
      await onChanged();
    } catch (checkInError) {
      setError(checkInError instanceof Error ? checkInError.message : 'Could not mark this patient as arrived.');
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="nv-care-view">
      <header className="nv-care-view-head">
        <h1 className="section-title">Bookings</h1>
        <p className="muted">Today’s and upcoming appointments across the hospital. Checked-in routine bookings enter the live queue directly; emergency-flagged bookings go to nurse triage first.</p>
      </header>
      {loadError ? <p className="nv-error" role="alert">{loadError}</p> : null}
      {error ? <p className="nv-error" role="alert">{error}</p> : null}
      {!loadError && entries.length === 0 ? (
        <div className="card nv-empty"><p className="muted">{loading ? 'Loading hospital bookings…' : 'There are no active upcoming bookings.'}</p></div>
      ) : (
        <div className="nv-sw-schedule">
          {[...grouped.entries()].map(([date, appointments]) => (
            <section className="nv-sw-schedule-day" key={date}>
              <div className="nv-sw-schedule-date">
                <h2>{appointments[0]?.isToday ? 'Today' : appointmentDate(date)}</h2>
                {appointments[0]?.isToday ? <span>{appointmentDate(date)}</span> : null}
              </div>
              <ul className="nv-sw-bookings">
                {appointments.map((entry) => (
                  <li className="card nv-sw-booking-row" key={entry.id}>
                    <div className="nv-sw-booking-time"><strong>{entry.time}</strong><span>{entry.isToday ? 'today' : 'booked'}</span></div>
                    <div className="nv-sw-booking-main">
                      <h3>{entry.patientName}</h3>
                      <p className="muted small">{entry.serviceName}{entry.patientEmail ? ` · ${entry.patientEmail}` : ''}</p>
                    </div>
                    <div className="nv-sw-booking-state">
                      <span className={`badge ${entry.status === 'checked_in' ? 'green' : 'blue'}`}>
                        {entry.queueStatus ? bookingQueueLabels[entry.queueStatus] : entry.status === 'checked_in' ? 'Checked in' : 'Booked'}
                      </span>
                      {role === 'nurse' && entry.status === 'booked' && entry.isToday ? (
                        <button type="button" className="primary-btn" disabled={busyId !== undefined} onClick={() => void markArrived(entry)}>
                          {busyId === entry.id ? 'Checking in…' : 'Mark arrived'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function TriageCard({ entry, services, onChanged }: { entry: StaffTriageEntry; services: { id: string; name: string }[]; onChanged: () => Promise<void> }) {
  const { getAccessTokenSilently } = useAuth0();
  const suggestedServiceId = services.find((service) => service.name === entry.triageSummary?.department)?.id ?? entry.serviceId;
  const [serviceId, setServiceId] = useState(suggestedServiceId);
  const [category, setCategory] = useState<QuestionnaireUrgency>(entry.triageSummary?.urgency ?? 'routine');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest(`/api/v1/staff/triage/${entry.id}/confirm`, token, { method: 'POST', body: { category, serviceId, reason: reason.trim() || undefined } });
      await onChanged();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Could not confirm triage.');
    } finally {
      setBusy(false);
    }
  }

  const targetService = services.find((service) => service.id === serviceId);

  return (
    <li className={`card nv-sw-triage ${entry.critical ? 'critical' : ''}`}>
      <div className="nv-sw-triage-head">
        <div>
          <h3>{entry.patientName}</h3>
          <p className="muted small">
            {entry.source === 'booking' ? `Booking${entry.appointmentTime ? ` · ${entry.appointmentTime}` : ''}` : 'Walk-in'}
            {' '}· joined {joinedTime(entry.joinedAt)} · arrived at {entry.serviceName}
          </p>
        </div>
        <div className="nv-sw-badges">
          {entry.critical ? <span className="badge red">Emergency flag</span> : null}
          {entry.triageSummary ? (
            <span className={`badge urgency-${entry.triageSummary.urgency}`}>Intake suggests {categoryLabels[entry.triageSummary.urgency]}</span>
          ) : (
            <span className="badge yellow">No intake assessment</span>
          )}
        </div>
      </div>
      {entry.triageSummary ? (
        <div className="nv-sw-summary">
          <strong>{entry.triageSummary.pathwayName} assessment — suggests {entry.triageSummary.department}</strong>
          <p className="muted small">{entry.triageSummary.summary}</p>
          {entry.triageSummary.redFlags.length > 0 ? (
            <div className="nv-service-tags">
              {entry.triageSummary.redFlags.map((flag) => <span key={flag} className="nv-tag nv-sw-redflag">{flag}</span>)}
            </div>
          ) : null}
            <p className="muted small">Questionnaire-based routing suggestion — not a diagnosis or confirmed urgency. Confirm it or change it below.</p>
        </div>
      ) : entry.intakeNote ? (
        <div className="nv-sw-summary">
          <strong>Clinical referral</strong>
          <p className="muted small">{entry.intakeNote}</p>
          <p className="muted small">Confirm the receiving queue below.</p>
        </div>
      ) : (
        <p className="muted small nv-sw-summary">No intake assessment for this patient. Ask about their symptoms and choose a queue manually.</p>
      )}
      <form className="nv-book-form nv-sw-confirm" onSubmit={(event) => void confirm(event)}>
        <label className="nv-field">Department
          <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} disabled={services.length === 0}>
            {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select>
        </label>
        <label className="nv-field">Urgency
          <select value={category} onChange={(event) => setCategory(event.target.value as QuestionnaireUrgency)}>
            {urgencyOptions.map((option) => <option key={option} value={option}>{categoryLabels[option]}</option>)}
          </select>
        </label>
        <label className="nv-field">Reason for change (optional)
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Only if you changed the intake suggestion" />
        </label>
        {error ? <p className="nv-error" role="alert">{error}</p> : null}
        <div className="nv-book-actions">
          <button type="submit" className="primary-btn" disabled={busy || services.length === 0}>
            {busy ? 'Confirming…' : `Confirm triage — send to ${targetService?.name ?? 'queue'}`}
          </button>
        </div>
      </form>
    </li>
  );
}

function TriageBoard({ entries, services, loading, loadError, onChanged }: { entries: StaffTriageEntry[]; services: { id: string; name: string }[]; loading: boolean; loadError?: string; onChanged: () => Promise<void> }) {
  const criticalCount = entries.filter((entry) => entry.critical).length;
  return (
    <section className="nv-care-view">
      <header className="nv-care-view-head">
        <h1 className="section-title">Triage review</h1>
        <p className="muted">Walk-ins and emergency-flagged bookings land here first. Confirm or change the suggested department and urgency — the queue only updates after your confirmation.</p>
      </header>
      {loadError ? <p className="nv-error" role="alert">{loadError}</p> : null}
      {criticalCount > 0 ? (
        <div className="nv-sw-alert" role="alert">
          <strong>{criticalCount} intake red-flag suggestion{criticalCount === 1 ? ' needs' : 's need'} prompt review.</strong>
          <span>These are unverified intake warnings and do not change queue priority until a nurse confirms urgency.</span>
        </div>
      ) : null}
      {!loadError && entries.length === 0 ? (
        <div className="card nv-empty">
          <p className="muted">{loading ? 'Loading the triage worklist…' : 'No patients are waiting for triage right now.'}</p>
        </div>
      ) : (
        <ul className="nv-sw-triage-list">
          {entries.map((entry) => <TriageCard key={entry.id} entry={entry} services={services} onChanged={onChanged} />)}
        </ul>
      )}
    </section>
  );
}

function QueueBoard({ entries, services, role, loadError, onChanged }: { entries: StaffQueueEntry[]; services: { id: string; name: string }[]; role: StaffRole; loadError?: string; onChanged: () => Promise<void> }) {
  const { getAccessTokenSilently } = useAuth0();
  const [busyKey, setBusyKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [referFor, setReferFor] = useState<string>();
  const [referService, setReferService] = useState('');
  const [referReason, setReferReason] = useState('');
  const [diagnosisFor, setDiagnosisFor] = useState<string>();
  const [diagnosis, setDiagnosis] = useState('');
  const [diagnosisNotes, setDiagnosisNotes] = useState('');

  async function act(key: string, path: string, body?: unknown) {
    setBusyKey(key);
    setError(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest(path, token, { method: 'POST', body });
      setReferFor(undefined);
      setDiagnosisFor(undefined);
      await onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That action failed. Please try again.');
    } finally {
      setBusyKey(undefined);
    }
  }

  function openRefer(entry: StaffQueueEntry) {
    setReferFor(entry.id);
    setReferService(services.find((service) => service.id !== entry.serviceId)?.id ?? '');
    setReferReason('');
    setError(undefined);
  }

  function openDiagnosis(entry: StaffQueueEntry) {
    setDiagnosisFor(entry.id);
    setDiagnosis('');
    setDiagnosisNotes('');
    setError(undefined);
  }

  function completeConsultation(event: FormEvent<HTMLFormElement>, entry: StaffQueueEntry) {
    event.preventDefault();
    void act(`complete:${entry.id}`, `/api/v1/staff/queue/${entry.id}/complete`, { diagnosis, notes: diagnosisNotes });
  }

  return (
    <section className="nv-care-view">
      <header className="nv-care-view-head">
        <h1 className="section-title">Live queue</h1>
        <p className="muted">Ordered by confirmed urgency, then time waiting. Call patients in, run consultations, and refer between departments.</p>
      </header>
      {loadError ? <p className="nv-error" role="alert">{loadError}</p> : null}
      {error ? <p className="nv-error" role="alert">{error}</p> : null}
      {!loadError && entries.length === 0 ? (
        <div className="card nv-empty"><p className="muted">The queue is empty. Triaged patients will appear here.</p></div>
      ) : (
        <ul className="nv-sw-queue">
          {entries.map((entry) => (
            <li className="card nv-sw-queue-row" key={entry.id}>
              <div className="nv-sw-queue-pos" aria-hidden="true">
                <strong>{entry.position ?? '–'}</strong>
                <span>{entry.status === 'waiting' ? 'in line' : 'room'}</span>
              </div>
              <div className="nv-sw-queue-main">
                <h3>{entry.patientName}</h3>
                <p className="muted small">
                  {entry.serviceName} · {statusLabels[entry.status]}
                  {entry.status !== 'waiting' && entry.calledAt ? ` · called ${joinedTime(entry.calledAt)}` : ` · waiting since ${joinedTime(entry.triagedAt ?? entry.joinedAt)}`}
                </p>
                {entry.category ? <span className={`badge urgency-${entry.category}`}>{categoryLabels[entry.category]}</span> : null}
              </div>
              <div className="nv-sw-queue-actions">
                {entry.status === 'waiting' ? (
                  <button type="button" className="primary-btn" disabled={busyKey !== undefined} onClick={() => void act(`call:${entry.id}`, `/api/v1/staff/queue/${entry.id}/call`)}>Call</button>
                ) : null}
                {entry.status === 'called' ? (
                  <button type="button" className="primary-btn" disabled={busyKey !== undefined} onClick={() => void act(`start:${entry.id}`, `/api/v1/staff/queue/${entry.id}/start-consultation`)}>Start consultation</button>
                ) : null}
                {entry.status === 'in_consultation' && role === 'doctor' ? (
                  <button type="button" className="primary-btn" disabled={busyKey !== undefined} onClick={() => openDiagnosis(entry)}>Record diagnosis</button>
                ) : null}
                {entry.status !== 'waiting' ? (
                  <button type="button" className="secondary-btn" disabled={busyKey !== undefined} onClick={() => openRefer(entry)}>Refer</button>
                ) : null}
              </div>
              {referFor === entry.id ? (
                <form className="nv-sw-refer" onSubmit={(event) => { event.preventDefault(); void act(`refer:${entry.id}`, `/api/v1/staff/queue/${entry.id}/refer`, { serviceId: referService, reason: referReason }); }}>
                  <label className="nv-field">Refer to department
                    <select value={referService} onChange={(event) => setReferService(event.target.value)}>
                      {services.filter((service) => service.id !== entry.serviceId).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                    </select>
                  </label>
                  <label className="nv-field">Referral reason
                    <input value={referReason} onChange={(event) => setReferReason(event.target.value)} placeholder="e.g. Needs an X-ray before review" required />
                  </label>
                  <div className="nv-book-actions">
                    <button type="submit" className="primary-btn" disabled={busyKey !== undefined || !referService || !referReason.trim()}>Send referral</button>
                    <button type="button" className="ghost-btn" onClick={() => setReferFor(undefined)}>Cancel</button>
                  </div>
                </form>
              ) : null}
              {diagnosisFor === entry.id ? (
                <form className="nv-sw-refer" onSubmit={(event) => completeConsultation(event, entry)}>
                  <label className="nv-field">Diagnosis
                    <input value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} placeholder="e.g. Acute bronchitis" required maxLength={500} />
                  </label>
                  <label className="nv-field">Notes for patient (optional)
                    <input value={diagnosisNotes} onChange={(event) => setDiagnosisNotes(event.target.value)} placeholder="Care instructions or follow-up" maxLength={2000} />
                  </label>
                  <div className="nv-book-actions">
                    <button type="submit" className="primary-btn" disabled={busyKey !== undefined || !diagnosis.trim()}>Save diagnosis and complete</button>
                    <button type="button" className="ghost-btn" onClick={() => setDiagnosisFor(undefined)}>Cancel</button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function StaffPortalPage({ role }: { role: StaffRole }) {
  const { isAuthenticated, loginWithRedirect, logout, getAccessTokenSilently, user } = useAuth0();
  const data = useStaffData(role, isAuthenticated, getAccessTokenSilently);
  const [view, setView] = useState<'bookings' | 'triage' | 'queue'>(role === 'nurse' ? 'triage' : 'queue');
  const copy = roleCopy[role];

  if (isAuthenticated && data.access && data.access.staffRole !== role) return <Navigate to="/" replace />;

  const displayName = data.access?.displayName ?? user?.given_name ?? user?.name ?? copy.mockName;
  const displayInitial = displayName.trim().slice(0, 1).toUpperCase() || 'N';
  const hospitalName = data.access?.hospitalName;
  const greeting = `${greetingFor(new Date().getHours())}, ${displayName}`;

  const navItems = role === 'nurse'
    ? [
        { label: 'Bookings', active: view === 'bookings', onClick: () => setView('bookings') },
        { label: 'Triage', active: view === 'triage', onClick: () => setView('triage') },
        { label: 'Queue', active: view === 'queue', onClick: () => setView('queue') },
      ]
    : [
        { label: 'Bookings', active: view === 'bookings', onClick: () => setView('bookings') },
        { label: 'Queue', active: view === 'queue', onClick: () => setView('queue') },
      ];

  return (
    <div className="app nv-patient">
      <TopBar>
        <Brand />
        <TopNav items={navItems} />
        <div className="actions">
          <button type="button" className="user-chip">
            <span style={{ fontWeight: 800 }}>{displayInitial}</span> <span>{data.access ? `Hi, ${displayName}` : copy.mockChip}</span>
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
            <p className="eyebrow">{hospitalName ? `${hospitalName} · ` : ''}{copy.portal.toLowerCase()} portal</p>
            <h1>{greeting}</h1>
            <p className="muted">{copy.tagline}</p>
          </div>
        </div>
      </section>

      {!isAuthenticated ? (
        <section className="nv-care-view">
          <div className="card card-pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, color: 'var(--text)' }}>{copy.portal} sign-in required</h3>
              <div className="muted small" style={{ marginTop: 4 }}>Sign in with your invited hospital email to open your {copy.portal.toLowerCase()} workspace.</div>
            </div>
            <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
          </div>
        </section>
      ) : (
        <>
          {data.error ? <p className="nv-error" role="alert" style={{ margin: '0 24px' }}>{data.error}</p> : null}
          {view === 'bookings' ? (
            <ScheduleBoard entries={data.appointments} role={role} loading={data.loading} loadError={data.bookingsError} onChanged={data.refresh} />
          ) : role === 'nurse' && view === 'triage' ? (
            <TriageBoard entries={data.triage} services={data.services} loading={data.loading} loadError={data.triageError} onChanged={data.refresh} />
          ) : (
            <QueueBoard entries={data.queue} services={data.services} role={role} loadError={data.queueError} onChanged={data.refresh} />
          )}
        </>
      )}
    </div>
  );
}
