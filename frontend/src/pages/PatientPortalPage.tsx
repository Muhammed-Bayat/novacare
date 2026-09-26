import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Appointment } from '../api.ts';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';
import { AppointmentsPanel } from '../components/patient/AppointmentsPanel.tsx';
import { CareBookingCard } from '../components/patient/CareBookingCard.tsx';
import { dateParts } from '../components/patient/careMath.ts';
import { usePatientCare } from '../components/patient/usePatientCare.ts';
import {
  patientLanguages,
  patientTranslations,
  type PatientLanguage,
} from '../i18n/patientTranslations.ts';
import '../styles/patient-portal.css';
import '../styles/patient-care.css';

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
  const t = patientTranslations[language];
  const { isAuthenticated, loginWithRedirect, logout, user } = useAuth0();
  const careData = usePatientCare();
  const authDisplayName = user?.given_name ?? user?.nickname ?? user?.name ?? 'Thandi';
  const [view, setView] = useState<'dashboard' | 'appointments'>('dashboard');
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [displayName, setDisplayName] = useState(() => readStoredDisplayName() ?? authDisplayName);
  const [draftDisplayName, setDraftDisplayName] = useState(displayName);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

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

  function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextDisplayName = draftDisplayName.trim() || authDisplayName;
    setDisplayName(nextDisplayName);
    window.localStorage.setItem(displayNameStorageKey, nextDisplayName);
    setProfileMenuOpen(false);
  }

  const nextAppointment = careData.appointments.find((appointment) => appointment.status === 'booked');
  const nextDate = nextAppointment ? dateParts(nextAppointment.date) : undefined;
  const displayInitial = displayName.trim().slice(0, 1).toUpperCase() || 'T';
  const welcomeText = t.welcome.replace('Thandi', displayName);
  const showRealUpcoming = isAuthenticated && nextAppointment && nextDate;

  const navItems = [
    { label: t.dashboard, active: view === 'dashboard', onClick: () => setView('dashboard') },
    { label: t.appointments, active: view === 'appointments', onClick: () => setView('appointments') },
  ];

  return (
    <div className="app nv-patient">
      <TopBar>
        <Brand />
        <TopNav items={navItems} />
        <div className="actions">
          <label className="nv-language-select">
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
            <h1 className="section-title">{t.care.appointmentsTitle}</h1>
            <p className="muted">{t.care.appointmentsSub}</p>
          </header>
          {!isAuthenticated ? (
            <div className="card nv-care-signin">
              <h3>{t.care.signInTitle}</h3>
              <p className="muted">{t.care.signInSub}</p>
              <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>{t.care.signInButton}</button>
            </div>
          ) : careData.error && careData.hospitals.length === 0 ? (
            <div className="card nv-empty">
              <p className="nv-error" role="alert">{careData.error}</p>
            </div>
          ) : (
            <>
              <AppointmentsPanel
                t={t}
                appointments={careData.appointments}
                queueEntries={careData.queueEntries}
                onCancel={careData.cancelAppointment}
                onLeaveQueue={careData.leaveQueue}
                onEdit={setEditingAppointment}
              />
              <CareBookingCard
                t={t}
                hospitals={careData.hospitals}
                loading={careData.loading}
                editingAppointment={editingAppointment}
                onFinishEdit={() => setEditingAppointment(null)}
                onCreate={careData.createAppointment}
                onUpdate={careData.updateAppointment}
                onRebook={careData.rebookAppointment}
                onJoinQueue={careData.joinQueue}
              />
            </>
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
                <p className="muted">{t.welcomeSub}</p>
              </div>
              <div className="hero-booking-card">
                <div>
                  <h2>{t.book}</h2>
                  <p className="muted">{t.bookSub}</p>
                </div>
                <button type="button" className="primary-btn" onClick={() => setView('appointments')}>{t.book}</button>
              </div>
            </div>
          </section>

          <section className="widgets nv-dashboard-widgets">
            <article className="card widget nv-upcoming-widget">
              <h3>
                <span>{t.upcoming}</span>{' '}
                <button type="button" className="muted small nv-viewall" onClick={() => setView('appointments')}>{t.viewAll}</button>
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
                    <button type="button" className="primary-btn" onClick={() => setView('appointments')}>{t.details}</button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => { setEditingAppointment(nextAppointment); setView('appointments'); }}
                    >
                      {t.reschedule}
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
