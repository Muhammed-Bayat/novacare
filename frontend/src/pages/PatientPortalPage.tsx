import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authenticatedRequest, type Appointment, type AppointmentTriageSummary, type ClinicalDiagnosis, type IntakeChatAnswer, type IntakeChatTurn } from '../api.ts';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';
import { AppointmentsPanel } from '../components/patient/AppointmentsPanel.tsx';
import { CareBookingCard } from '../components/patient/CareBookingCard.tsx';
import { IntakeChat } from '../components/patient/IntakeChat.tsx';
import { ServiceRequestPanel } from '../components/patient/ServiceRequestPanel.tsx';
import { dateParts } from '../components/patient/careMath.ts';
import { useLiveTranslation } from '../components/patient/useLiveTranslation.ts';
import { usePatientCare } from '../components/patient/usePatientCare.ts';
import { useServiceRequests } from '../components/patient/useServiceRequests.ts';
import {
  patientLanguages,
  type PatientLanguage,
} from '../i18n/patientLanguages.ts';
import '../styles/patient-portal.css';
import '../styles/patient-care.css';
import '../styles/service-request.css';

const languageStorageKey = 'novaCareLanguage';
const displayNameStorageKey = 'novaCareDisplayName';

function readStoredLanguage(): PatientLanguage {
  const stored = window.localStorage.getItem(languageStorageKey);
  const match = patientLanguages.find((option) => option.code === stored);
  return match ? match.code : 'en';
}

function readStoredDisplayName(): string | undefined {
  const stored = window.localStorage.getItem(displayNameStorageKey)?.trim();
  return stored || undefined;
}

function SouthAfricanFlag() {
  return (
    <svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="300" height="200" fill="#fff" />
      <path d="M0 0h300v66.67H145L82 100l63 33.33h155V200H0z" fill="#de3831" />
      <path d="M0 200h300v-66.67H145L82 100l63-33.33h155V0H0z" fill="#002395" />
      <path d="M0 0v200l124-66.67h176V66.67H124z" fill="#fff" />
      <path d="M0 0v200l108-58.33h192V58.33H108z" fill="#007a4d" />
      <path d="M0 0v200l88-100z" fill="#ffb612" />
      <path d="M0 26v148l65-74z" fill="#000" />
    </svg>
  );
}

export function PatientPortalPage() {
  const [language, setLanguage] = useState<PatientLanguage>(readStoredLanguage);
  const rootRef = useRef<HTMLDivElement>(null);
  useLiveTranslation(rootRef, language);
  const { isAuthenticated, loginWithRedirect, logout, user, getAccessTokenSilently } = useAuth0();
  const careData = usePatientCare();
  const serviceRequests = useServiceRequests();
  const authDisplayName = user?.given_name ?? user?.nickname ?? user?.name ?? 'Thandi';
  const [view, setView] = useState<'dashboard' | 'appointments' | 'results' | 'help'>('dashboard');
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [displayName, setDisplayName] = useState(() => readStoredDisplayName() ?? authDisplayName);
  const [draftDisplayName, setDraftDisplayName] = useState(displayName);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [bookingSuggestion, setBookingSuggestion] = useState<{ hospitalId?: string; serviceId?: string; triageSummary: AppointmentTriageSummary } | null>(null);
  const [diagnoses, setDiagnoses] = useState<ClinicalDiagnosis[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string>();

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(languageStorageKey, language);
  }, [language]);

  useEffect(() => {
    if (!readStoredDisplayName()) {
      setDisplayName(authDisplayName);
      setDraftDisplayName(authDisplayName);
    }
  }, [authDisplayName]);

  useEffect(() => {
    if (!isAuthenticated) {
      setDiagnoses([]);
      return;
    }
    if (view !== 'results') return;
    let cancelled = false;
    async function loadResults(silent = false) {
      if (!silent) setResultsLoading(true);
      setResultsError(undefined);
      try {
        const token = await getAccessTokenSilently();
        const response = await authenticatedRequest<{ data: { diagnoses?: ClinicalDiagnosis[] } }>('/api/v1/profile', token);
        if (!cancelled) setDiagnoses(response.data.diagnoses ?? []);
      } catch (error) {
        if (!cancelled) setResultsError(error instanceof Error ? error.message : 'Could not load your clinical results.');
      } finally {
        if (!cancelled && !silent) setResultsLoading(false);
      }
    }
    void loadResults();
    const timer = window.setInterval(() => void loadResults(true), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [isAuthenticated, getAccessTokenSilently, view]);

  function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextDisplayName = draftDisplayName.trim() || authDisplayName;
    setDisplayName(nextDisplayName);
    window.localStorage.setItem(displayNameStorageKey, nextDisplayName);
    setProfileMenuOpen(false);
  }

  async function createIntakeChatTurn(complaint: string, answers: IntakeChatAnswer[]): Promise<IntakeChatTurn> {
    const token = await getAccessTokenSilently();
    const response = await authenticatedRequest<{ data: IntakeChatTurn }>('/api/v1/intake/chat', token, { method: 'POST', body: { complaint, answers } });
    return response.data;
  }

  function bookFromQuestionnaire(input: { hospitalId?: string; serviceId?: string; triageSummary: AppointmentTriageSummary }) {
    setBookingSuggestion(input);
    setEditingAppointment(null);
    setView('appointments');
  }

  async function createAppointment(input: { hospitalId: string; serviceId: string; date: string; time: string; triageSummary?: AppointmentTriageSummary | null }) {
    await careData.createAppointment({ ...input, triageSummary: input.triageSummary ?? bookingSuggestion?.triageSummary ?? null });
    setBookingSuggestion(null);
  }

  const nextAppointment = careData.appointments.find((appointment) => appointment.status === 'booked');
  const nextDate = nextAppointment ? dateParts(nextAppointment.date) : undefined;
  const displayInitial = displayName.trim().slice(0, 1).toUpperCase() || 'T';
  const welcomeText = `Welcome back, ${displayName}`;
  const showRealUpcoming = isAuthenticated && nextAppointment && nextDate;

  const navItems = [
    { label: 'Dashboard', active: view === 'dashboard', onClick: () => setView('dashboard') },
    { label: 'Appointments', active: view === 'appointments', onClick: () => setView('appointments') },
    { label: 'My health', active: view === 'results', onClick: () => setView('results') },
    { label: 'Emergency', active: view === 'help', onClick: () => setView('help') },
  ];

  return (
    <div className="app nv-patient" ref={rootRef}>
      <TopBar>
        <Brand />
        <TopNav items={navItems} />
        <div className="actions">
          <label className="nv-language-select" data-no-translate>
            <span>Language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as PatientLanguage)}>
              {patientLanguages.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="nv-user-menu">
            <button
              type="button"
              className="user-chip"
              aria-expanded={profileMenuOpen}
              aria-haspopup="dialog"
              onClick={() => {
                setDraftDisplayName(displayName);
                setProfileMenuOpen((open) => !open);
              }}
            >
              <span style={{ fontWeight: 800 }}>{displayInitial}</span> <span>Hi, {displayName}</span> <span style={{ fontSize: 12 }}>Menu</span>
            </button>
            {profileMenuOpen ? (
              <form className="card nv-profile-menu" onSubmit={saveDisplayName} aria-label="Update display name">
                <h3>Profile</h3>
                <label className="nv-field">
                  Display name
                  <input value={draftDisplayName} onChange={(event) => setDraftDisplayName(event.target.value)} autoFocus />
                </label>
                <div className="nv-profile-actions">
                  <button type="button" className="ghost-btn nv-danger" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Logout</button>
                  <button type="button" className="secondary-btn" onClick={() => setProfileMenuOpen(false)}>Cancel</button>
                  <button type="submit" className="primary-btn">Save</button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </TopBar>

      {view === 'appointments' ? (
        <section className="nv-care-view">
          <header className="nv-care-view-head">
            <h1 className="section-title">Appointments</h1>
            <p className="muted">Book visits, manage your schedule and follow today’s queue.</p>
          </header>
          {!isAuthenticated ? (
            <div className="card nv-care-signin">
              <h3>Sign in to manage your appointments</h3>
              <p className="muted">Use your Nova Care account to book visits, find nearby hospitals and join queues.</p>
              <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign In</button>
            </div>
          ) : careData.error && careData.hospitals.length === 0 ? (
            <div className="card nv-empty">
              <p className="nv-error" role="alert">{careData.error}</p>
            </div>
          ) : (
            <>
              <AppointmentsPanel
                appointments={careData.appointments}
                queueEntries={careData.queueEntries}
                onCancel={careData.cancelAppointment}
                onLeaveQueue={careData.leaveQueue}
                onEdit={setEditingAppointment}
                onCheckIn={careData.checkIn}
              />
              <CareBookingCard
                hospitals={careData.hospitals}
                loading={careData.loading}
                editingAppointment={editingAppointment}
                bookingSuggestion={bookingSuggestion}
                onFinishEdit={() => setEditingAppointment(null)}
                onComplete={() => {
                  setBookingSuggestion(null);
                  setEditingAppointment(null);
                  setView('dashboard');
                }}
                onCreate={createAppointment}
                onUpdate={careData.updateAppointment}
                onRebook={careData.rebookAppointment}
                onJoinQueue={careData.joinQueue}
              />
            </>
          )}
        </section>
      ) : null}

      {view === 'help' ? (
        !isAuthenticated ? (
          <section className="nv-care-view">
            <div className="card nv-care-signin">
              <h3>Sign in to send a request</h3>
              <p className="muted">Use your Nova Care account to send an ambulance or home-visit request and track its status. For testing only. No real emergency services are contacted.</p>
              <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign In</button>
            </div>
          </section>
        ) : (
          <ServiceRequestPanel
            requests={serviceRequests.requests}
            loading={serviceRequests.loading}
            error={serviceRequests.error}
            onCreate={serviceRequests.createServiceRequest}
            onResolveLocation={serviceRequests.resolveLocation}
            onConfirmLocation={serviceRequests.confirmLocation}
          />
        )
      ) : null}

      {view === 'results' ? (
        <section className="nv-care-view">
          <header className="nv-care-view-head">
            <h1 className="section-title">My health</h1>
            <p className="muted">Review diagnoses and consultation notes shared by your care team.</p>
          </header>
          {!isAuthenticated ? (
            <div className="card nv-care-signin">
              <h3>Sign in to view your health information</h3>
              <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign In</button>
            </div>
          ) : resultsError ? (
            <div className="card nv-empty"><p className="nv-error" role="alert">{resultsError}</p></div>
          ) : resultsLoading ? (
            <div className="card nv-empty"><p className="muted">Loading your health information…</p></div>
          ) : diagnoses.length === 0 ? (
            <div className="card nv-empty"><p className="muted">No diagnoses have been shared with you yet.</p></div>
          ) : (
            <ul className="nv-results-list">
              {diagnoses.map((diagnosis) => (
                <li className="card nv-result" key={diagnosis.id}>
                  <div>
                    <h3>{diagnosis.diagnosis}</h3>
                    <p className="muted small">{new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(new Date(diagnosis.diagnosedOn))}{diagnosis.clinicianName ? ` · ${diagnosis.clinicianName}` : ''}</p>
                  </div>
                  {diagnosis.notes ? <p>{diagnosis.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {view === 'dashboard' ? (
        <>
          <section className="hero-card hero nv-patient-hero">
            <div className="hero-left">
              <div className="flag-band">
                <SouthAfricanFlag />
              </div>
              <div className="hero-copy">
                <p className="eyebrow">Nova Care Patient Portal</p>
                <h1>{welcomeText}</h1>
                <p className="muted">Your health matters. We’re here for a healthier, brighter tomorrow.</p>
              </div>
              <div className="hero-booking-card">
                <div>
                  <h2>Book an Appointment</h2>
                  <p className="muted">Find a doctor and book your next visit.</p>
                </div>
                <button type="button" className="primary-btn" onClick={() => setView('appointments')}>Book an Appointment</button>
              </div>
            </div>
          </section>

          <section className="widgets nv-dashboard-widgets">
            <IntakeChat
              isAuthenticated={isAuthenticated}
              hospitals={careData.hospitals}
              onSignIn={() => void loginWithRedirect()}
              onChatTurn={createIntakeChatTurn}
              onBookAppointment={bookFromQuestionnaire}
            />

            <article className="card widget nv-upcoming-widget">
              <h3>
                <span>Upcoming Appointment</span>{' '}
                <button type="button" className="muted small nv-viewall" onClick={() => setView('appointments')}>View all</button>
              </h3>
              {showRealUpcoming && nextAppointment && nextDate ? (
                <>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div className="bigdate">
                      {nextDate.weekday.toUpperCase()}<br />
                      <span style={{ fontSize: 34 }}>{nextDate.day}</span>
                      <br />{nextDate.month.toUpperCase()}
                    </div>
                    <div>
                      <strong>{nextAppointment.serviceName}</strong>
                      <div className="muted small">{nextAppointment.hospitalName}</div>
                      <div className="row">Time: {nextAppointment.time}</div>
                      <div className="small muted">{nextAppointment.address}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button type="button" className="primary-btn" onClick={() => setView('appointments')}>View Details</button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => { setEditingAppointment(nextAppointment); setView('appointments'); }}
                    >
                      Reschedule
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted">No live appointment yet. Book your next visit to see it here.</p>
                  <button type="button" className="primary-btn" onClick={() => setView('appointments')}>View appointments</button>
                </>
              )}
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
