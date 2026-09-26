import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import type { Appointment } from '../api.ts';
import { Brand, SearchButton, TopBar, TopNav } from '../components/TopBar.tsx';
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

function readStoredLanguage(): PatientLanguage {
  const stored = window.localStorage.getItem(languageStorageKey);
  const match = patientLanguages.find((option) => option.code === stored);
  return match ? match.code : 'en';
}

function SouthAfricanFlag() {
  return (
    <svg viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="300" height="150" fill="#fff" />
      <path d="M0,0 H300 V55 H170 L104,75 L170,95 H300 V150 H0 Z" fill="#e94f3d" />
      <path d="M0,0 H300 V55 H170 L104,75 L170,95 H300 V150 H0 Z" fill="#1f6fd1" transform="scale(1,-1) translate(0,-150)" />
      <path d="M0,0 L120,75 L0,150 Z" fill="#111" />
      <path d="M0,0 L145,75 L0,150 Z" fill="none" stroke="#f7c91f" strokeWidth="28" strokeLinejoin="round" />
      <path d="M0,0 L160,75 L0,150 Z" fill="none" stroke="#159b4f" strokeWidth="54" strokeLinejoin="round" />
    </svg>
  );
}

function PortraitIllustration() {
  return (
    <svg viewBox="0 0 560 420" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9edff" />
          <stop offset="1" stopColor="#eef7ff" />
        </linearGradient>
      </defs>
      <rect width="560" height="420" rx="28" fill="url(#sky)" />
      <path d="M0 290c80-70 155-90 219-73 26 8 55 21 76 24 52 10 107-13 160-58 39-33 70-45 105-48v285H0z" fill="#c7deef" />
      <path d="M0 310c79-33 155-20 236 13 34 14 66 25 96 25 57 0 110-31 228-38v110H0z" fill="#e6f1f8" />
      <g transform="translate(248 55)">
        <rect x="96" y="185" width="132" height="176" rx="58" fill="#f4ede7" />
        <circle cx="162" cy="112" r="66" fill="#f2caa9" />
        <path d="M103 94c7-46 43-73 89-73 43 0 80 28 83 74 0 0-13 7-21 22-14-12-34-20-59-19-28 1-54 14-72 33-18-18-23-37-20-37z" fill="#221c1d" />
        <circle cx="143" cy="115" r="5" fill="#6c4c42" />
        <circle cx="182" cy="115" r="5" fill="#6c4c42" />
        <path d="M145 145c13 12 35 12 49 0" fill="none" stroke="#bc6f5f" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g fill="#b5d0e5" opacity=".75">
        <rect x="18" y="272" width="10" height="38" rx="2" />
        <rect x="32" y="262" width="12" height="48" rx="2" />
        <rect x="49" y="248" width="16" height="62" rx="2" />
        <rect x="70" y="268" width="9" height="42" rx="2" />
        <rect x="85" y="254" width="12" height="56" rx="2" />
        <rect x="102" y="240" width="18" height="70" rx="2" />
        <rect x="126" y="262" width="10" height="48" rx="2" />
        <rect x="140" y="252" width="13" height="58" rx="2" />
        <rect x="159" y="268" width="11" height="42" rx="2" />
      </g>
    </svg>
  );
}

export function PatientPortalPage() {
  const [language, setLanguage] = useState<PatientLanguage>(readStoredLanguage);
  const t = patientTranslations[language];
  const { isAuthenticated, loginWithRedirect, user } = useAuth0();
  const careData = usePatientCare();
  const [view, setView] = useState<'dashboard' | 'appointments'>('dashboard');
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(languageStorageKey, language);
  }, [language]);

  const nextAppointment = careData.appointments.find((appointment) => appointment.status === 'booked');
  const nextDate = nextAppointment ? dateParts(nextAppointment.date) : undefined;
  const firstName = user?.given_name ?? user?.nickname ?? 'Thandi';
  const showRealUpcoming = isAuthenticated && nextAppointment && nextDate;

  const navItems = [
    { label: t.dashboard, active: view === 'dashboard', onClick: () => setView('dashboard') },
    { label: t.appointments, active: view === 'appointments', onClick: () => setView('appointments') },
    { label: t.prescriptions },
    { label: t.results },
    { label: t.messages },
    { label: t.support },
  ];

  return (
    <div className="app nv-patient">
      <TopBar>
        <Brand />
        <TopNav items={navItems} />
        <div className="actions">
          <SearchButton />
          <button type="button" className="user-chip">
            <span style={{ fontWeight: 800 }}>{firstName.slice(0, 1).toUpperCase()}</span> <span>Hi, {firstName}</span> <span style={{ fontSize: 12 }}>▼</span>
          </button>
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
      <section className="hero-card hero">
        <div className="hero-left">
          <h1>{t.welcome}</h1>
          <p className="muted">{t.welcomeSub}</p>
          <div className="lang-card">
            <div className="flag-large">
              <SouthAfricanFlag />
            </div>
            <div className="flag-small">
              <SouthAfricanFlag />
            </div>
            <div className="lang-top">
              <div className="icon-circle" style={{ width: 58, height: 58, fontSize: 24 }}>🌍</div>
              <div>
                <h2>{t.choose}</h2>
                <div className="muted">{t.chooseSub}</div>
              </div>
            </div>
            <div className="lang-grid">
              {patientLanguages.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  className={option.code === language ? 'lang-btn active' : 'lang-btn'}
                  onClick={() => setLanguage(option.code)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 16, color: '#1a77cf', fontWeight: 800, position: 'relative', zIndex: 2 }}>{t.sameCare}</div>
          </div>
        </div>
        <div className="hero-right">
          <div className="portrait">
            <PortraitIllustration />
          </div>
          <div className="hero-script">
            Healthier<br />South Africa,<br />Brighter<br />Tomorrows. ♡
          </div>
        </div>
      </section>

      <section className="quick-row">
        <article className="card quick-card">
          <div className="icon-circle">🗓️</div>
          <div>
            <button type="button" className="nv-quick-action" onClick={() => setView('appointments')}>
              <h3>{t.book}</h3>
            </button>
            <p>{t.bookSub}</p>
          </div>
        </article>
        <article className="card quick-card">
          <div className="icon-circle" style={{ background: '#e4faf0' }}>💊</div>
          <div>
            <h3>{t.viewRx}</h3>
            <p>{t.viewRxSub}</p>
          </div>
        </article>
        <article className="card quick-card">
          <div className="icon-circle" style={{ background: '#f1ecff' }}>📄</div>
          <div>
            <h3>{t.checkResults}</h3>
            <p>{t.checkResultsSub}</p>
          </div>
        </article>
        <article className="card quick-card">
          <div className="icon-circle">💬</div>
          <div>
            <h3>{t.msgDoctor}</h3>
            <p>{t.msgDoctorSub}</p>
          </div>
        </article>
      </section>

      <section className="widgets">
        <article className="card widget">
          <h3>
            🗓️ <span>{t.upcoming}</span>{' '}
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
                  <div className="row">🕙 {nextAppointment.time}</div>
                  <div className="small muted">⌖ {nextAppointment.address}</div>
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
              <div style={{ display: 'flex', gap: 16 }}>
                <div className="bigdate">
                  FRI<br />
                  <span style={{ fontSize: 34 }}>16</span>
                  <br />MAY
                </div>
                <div>
                  <strong>{t.general}</strong>
                  <div className="muted small">Dr. A. Mokoena</div>
                  <div className="row">🕙 10:00 AM</div>
                  <div className="small muted">
                    ⌖ Nova Care Medical Centre<br />Sandton, Johannesburg
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="button" className="primary-btn" onClick={() => setView('appointments')}>{t.details}</button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => { setEditingAppointment(null); setView('appointments'); }}
                >
                  {t.reschedule}
                </button>
              </div>
            </>
          )}
        </article>

        <article className="card widget">
          <h3>
            💊 <span>{t.medRem}</span> <span className="muted small" style={{ float: 'right' }}>{t.viewAll}</span>
          </h3>
          <div className="row">
            <strong>Amlodipine 5mg</strong>
            <div className="small muted">
              <span>{t.tabletDaily}</span> · <span>{t.today}</span>, 8:00 AM
            </div>
          </div>
          <div className="row">
            <strong>Metformin 500mg</strong>
            <div className="small muted">
              <span>{t.tabletTwice}</span> · <span>{t.today}</span>, 8:00 PM
            </div>
          </div>
          <div className="row">
            <strong>Vitamin D3</strong>
            <div className="small muted">
              <span>{t.capsuleDaily}</span> · <span>{t.tomorrow}</span>, 8:00 AM
            </div>
          </div>
        </article>

        <article className="card widget">
          <h3>
            📄 <span>{t.recentResults}</span> <span className="muted small" style={{ float: 'right' }}>{t.viewAll}</span>
          </h3>
          <div className="row">
            <strong>Blood Pressure</strong>
            <div className="badge green">{t.normal}</div>
            <div className="small muted">12 May 2024</div>
          </div>
          <div className="row">
            <strong>Cholesterol</strong>
            <div className="badge green">{t.normal}</div>
            <div className="small muted">08 May 2024</div>
          </div>
          <div className="row">
            <strong>Blood Sugar (HbA1c)</strong>
            <div className="badge green">{t.range}</div>
            <div className="small muted">02 May 2024</div>
          </div>
        </article>

        <article className="card widget">
          <h3>
            🎧 <span>{t.contact}</span>
          </h3>
          <p className="muted">{t.contactSub}</p>
          <button type="button" className="primary-btn" style={{ width: '100%', margin: '12px 0' }}>{t.send}</button>
          <button type="button" className="secondary-btn" style={{ width: '100%' }}>{t.call}</button>
          <div className="small" style={{ marginTop: 14, background: '#eef7ff', padding: 12, borderRadius: 12 }}>{t.emergency}</div>
        </article>
      </section>

      <section className="hero-card banner">
        <div>
          <strong>{t.better}</strong>
          <div className="muted small">{t.betterSub}</div>
        </div>
        <div style={{ fontSize: 48, color: '#bdd2e4' }}>⌁⌁⌁</div>
      </section>
      </>
      ) : null}
    </div>
  );
}
