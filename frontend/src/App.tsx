import { useAuth0 } from '@auth0/auth0-react';
import { useDeferredValue, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { authenticatedRequest, type Appointment, type ClinicalDiagnosis, type CurrentUser, type Hospital, type PatientProfile, type QueueEntry } from './api.ts';
import { AdminPortalPage } from './pages/AdminPortalPage.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { PatientPortalPage } from './pages/PatientPortalPage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { StaffPortalPage } from './pages/StaffPortalPage.tsx';

const BOOKING_START = '07:00';
const BOOKING_END = '19:00';

function HomeRoute() {
  const { isAuthenticated } = useAuth0();
  const handlingAuthRedirect = new URLSearchParams(window.location.search).has('code');
  return isAuthenticated || handlingAuthRedirect ? <SignInPage /> : <LandingPage />;
}

function InvitationClaimPage() {
  const { isAuthenticated, isLoading, error, getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const [message, setMessage] = useState('Preparing your invitation...');
  const token = new URLSearchParams(window.location.search).get('token');

  useEffect(() => {
    if (!token || isLoading) return;
    if (!isAuthenticated) {
      void loginWithRedirect({ appState: { returnTo: `${window.location.pathname}${window.location.search}` } });
      return;
    }
    let cancelled = false;
    async function claim() {
      try {
        const accessToken = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: { role: string } }>('/api/v1/invitations/claim', accessToken, { method: 'POST', body: { token } });
        if (!cancelled) setMessage(`Your ${result.data.role} access has been activated. You can now continue to NovaCare.`);
      } catch (claimError) {
        if (!cancelled) setMessage(claimError instanceof Error ? claimError.message : 'We could not claim this invitation.');
      }
    }
    void claim();
    return () => { cancelled = true; };
  }, [getAccessTokenSilently, isAuthenticated, isLoading, loginWithRedirect, token]);

  if (!token) return <main className="status">This invitation link is invalid.</main>;
  if (error) return <main className="status">Sign-in failed: {error.message}</main>;
  return <main className="status">{message}</main>;
}

function formatDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? date : new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(parsed);
}

function distanceInKm(from: GeolocationCoordinates, to: Hospital): number {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const latitudeDifference = radians(to.latitude - from.latitude);
  const longitudeDifference = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDifference / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDifference / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ProtectedPage({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, error, loginWithRedirect } = useAuth0();
  if (isLoading) return <main className="status">Loading NovaCare...</main>;
  if (error) return <main className="status">Authentication error: {error.message}</main>;
  if (!isAuthenticated) {
    return <main className="landing"><p className="eyebrow">NovaCare platform</p><h1>Care coordination starts with a trusted sign-in.</h1><p>Sign in to find care and manage your bookings.</p><button type="button" onClick={() => void loginWithRedirect()}>Sign in</button></main>;
  }
  return <>{children}</>;
}

function Dashboard() {
  const { user, logout, getAccessTokenSilently } = useAuth0();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState<Appointment[]>();
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>();
  const [healthRecord, setHealthRecord] = useState<{ profile: PatientProfile | null; diagnoses: ClinicalDiagnosis[] }>();
  const [error, setError] = useState<string>();
  const [access, setAccess] = useState<CurrentUser>();
  const upcoming = appointments?.filter((appointment) => appointment.status === 'booked') ?? [];
  const cancelled = appointments?.filter((appointment) => appointment.status === 'cancelled') ?? [];

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      try {
        const token = await getAccessTokenSilently();
        const [me, upcoming, queue, profile] = await Promise.all([
          authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token),
          authenticatedRequest<{ data: Appointment[] }>('/api/v1/appointments', token),
          authenticatedRequest<{ data: QueueEntry[] }>('/api/v1/queue', token),
          authenticatedRequest<{ data: { profile: PatientProfile | null; diagnoses: ClinicalDiagnosis[] } }>('/api/v1/profile', token),
        ]);
        if (!cancelled) { setAccess(me.data); setAppointments(upcoming.data); setQueueEntries(queue.data); setHealthRecord(profile.data); }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load your bookings.');
      }
    }
    void loadDashboard();
    return () => { cancelled = true; };
  }, [getAccessTokenSilently]);
  if (access?.isPlatformOperator) return <Navigate to="/overseer" replace />;
  if (access?.staffRole === 'administrator') return <Navigate to="/admin" replace />;
  if (access?.staffRole === 'nurse') return <Navigate to="/staff" replace />;
  if (access?.staffRole === 'doctor') return <Navigate to="/doctor" replace />;

  async function cancelAppointment(appointment: Appointment) {
    if (!window.confirm(`Cancel your ${appointment.serviceName} booking at ${appointment.hospitalName}?`)) return;
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest(`/api/v1/appointments/${appointment.id}`, token, { method: 'DELETE' });
      setAppointments((current) => current?.map((item) => item.id === appointment.id ? { ...item, status: 'cancelled' } : item));
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel your booking.');
    }
  }

  async function leaveQueue(entry: QueueEntry) {
    if (!window.confirm(`Leave the ${entry.serviceName} queue at ${entry.hospitalName}?`)) return;
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest(`/api/v1/queue/${entry.id}`, token, { method: 'DELETE' });
      setQueueEntries((current) => current?.filter((item) => item.id !== entry.id));
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Could not leave the queue.');
    }
  }

  return <main className="dashboard">
    <header className="app-header">
      <div><p className="eyebrow">NovaCare patient</p><h1>Hello, {user?.given_name ?? user?.name ?? 'there'}</h1></div>
      <button type="button" className="secondary" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Sign out</button>
    </header>
    <section className="hero-card">
      <div><p className="eyebrow">Your next step</p><h2>Find care that fits your needs.</h2><p>Search public hospitals by name, area, or the service you need, then choose an appointment time.</p></div>
      <button type="button" onClick={() => navigate('/book')}>Make a booking</button>
    </section>
    <section className="queue-home" aria-labelledby="queue-title">
      <div className="section-heading"><div><p className="eyebrow">Virtual queue</p><h2 id="queue-title">Need care today?</h2></div><button type="button" onClick={() => navigate('/queue')}>Join today&apos;s queue</button></div>
      <p>Join a same-day service queue from home. Queue order is first in, first out for this demo.</p>
      {!queueEntries ? <p>Loading today&apos;s queue status...</p> : null}
      {queueEntries?.map((entry) => <article className="queue-card" key={entry.id}><div className="queue-position"><span>Position</span><strong>{entry.status === 'called' ? 'Called' : entry.position}</strong></div><div><h3>{entry.serviceName}</h3><p>{entry.hospitalName}</p><small>{entry.estimatedWaitMinutes > 0 ? `Estimated wait: about ${entry.estimatedWaitMinutes} minutes` : 'You are next in line.'}</small></div><button type="button" className="text-button danger-button" onClick={() => void leaveQueue(entry)}>Leave queue</button></article>)}
    </section>
    <section className="health-home"><div className="section-heading"><div><p className="eyebrow">Your health record</p><h2>Personal and medical information</h2></div><button type="button" onClick={() => navigate('/profile')}>{healthRecord?.profile ? 'Update profile' : 'Complete profile'}</button></div>{!healthRecord ? <p>Loading your private health record...</p> : <><p>{healthRecord.profile ? 'Keep your contact details, allergies, medications and care needs up to date.' : 'Add your details so care teams can support you safely.'}</p><div className="health-summary"><div><strong>Conditions</strong><span>{healthRecord.profile?.chronicConditions.length ?? 0} recorded</span></div><div><strong>Allergies</strong><span>{healthRecord.profile?.allergies.length ?? 0} recorded</span></div><div><strong>Clinician diagnoses</strong><span>{healthRecord.diagnoses.length} recorded</span></div></div>{healthRecord.diagnoses.length > 0 ? <div className="diagnosis-preview"><strong>Latest clinician diagnosis</strong><span>{healthRecord.diagnoses[0]?.diagnosis}</span></div> : <p className="health-note">Clinician diagnoses will appear here after a care team records them.</p>}</>}</section>
    <section className="upcoming" aria-labelledby="upcoming-title">
      <div className="section-heading"><div><p className="eyebrow">Appointments</p><h2 id="upcoming-title">Upcoming bookings</h2></div><button type="button" className="text-button" onClick={() => navigate('/book')}>New booking</button></div>
      {error ? <p role="alert" className="error-message">{error}</p> : null}
      {!error && !appointments ? <p>Loading your upcoming bookings...</p> : null}
      {appointments && upcoming.length === 0 ? <div className="empty-state"><strong>No upcoming bookings.</strong><p>Choose a hospital and service to reserve your visit.</p></div> : null}
      {upcoming.map((appointment) => <article className="appointment-card" key={appointment.id}>
        <div className="appointment-time"><strong>{formatDate(appointment.date)}</strong><span>{appointment.time}</span></div>
        <div><h3>{appointment.serviceName}</h3><p>{appointment.hospitalName}</p><small>{appointment.address}</small></div>
        <div className="appointment-actions"><span className="status-pill">Booked</span><button type="button" className="text-button" onClick={() => navigate('/book', { state: { appointment } })}>Edit</button><button type="button" className="text-button danger-button" onClick={() => void cancelAppointment(appointment)}>Cancel</button></div>
      </article>)}
      {cancelled.length > 0 ? <div className="cancelled-bookings"><h3>Cancelled bookings</h3>{cancelled.map((appointment) => <article className="appointment-card cancelled-card" key={appointment.id}><div className="appointment-time"><strong>{formatDate(appointment.date)}</strong><span>{appointment.time}</span></div><div><h3>{appointment.serviceName}</h3><p>{appointment.hospitalName}</p></div><button type="button" className="secondary" onClick={() => navigate('/book', { state: { appointment } })}>Rebook</button></article>)}</div> : null}
    </section>
  </main>;
}

function OverseerPage() {
  const { getAccessTokenSilently } = useAuth0(); const navigate = useNavigate();
  const [hospitals, setHospitals] = useState<Hospital[]>([]); const [hospitalId, setHospitalId] = useState(''); const [email, setEmail] = useState(''); const [message, setMessage] = useState<string>(); const [error, setError] = useState<string>();
  useEffect(() => { let cancelled = false; async function load() { try { const token = await getAccessTokenSilently(); const me = await authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token); if (!me.data.isPlatformOperator) { navigate('/', { replace: true }); return; } const result = await authenticatedRequest<{ data: Hospital[] }>('/api/v1/hospitals', token); if (!cancelled) { setHospitals(result.data); setHospitalId(result.data[0]?.id ?? ''); } } catch (loadError) { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load overseer tools.'); } } void load(); return () => { cancelled = true; }; }, [getAccessTokenSilently, navigate]);
  async function assign(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setError(undefined); try { const token = await getAccessTokenSilently(); const result = await authenticatedRequest<{ data: { message: string } }>('/api/v1/overseer/administrators', token, { method: 'POST', body: { hospitalId, email } }); setMessage(result.data.message); setEmail(''); } catch (inviteError) { setError(inviteError instanceof Error ? inviteError.message : 'Could not assign administrator.'); } }
  return <main className="profile-page"><header className="booking-header"><button className="back-button" type="button" onClick={() => navigate('/')}>Patient view</button><div><p className="eyebrow">Platform overseer</p><h1>Hospital access.</h1></div></header><div className="profile-layout"><form className="profile-form" onSubmit={(event) => void assign(event)}><section><p className="eyebrow">Assign hospital administrator</p><p>Administrators can manage one hospital and invite their own nurses and doctors.</p><label>Hospital<select value={hospitalId} onChange={(event) => setHospitalId(event.target.value)}>{hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name} · {hospital.province}</option>)}</select></label><label>Administrator email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label></section>{error ? <p className="error-message">{error}</p> : null}{message ? <p>{message}</p> : null}<button type="submit">Assign administrator</button></form><aside className="diagnosis-panel"><p className="eyebrow">Workflow</p><h2>How access works</h2><p>You assign an administrator to a hospital. They sign in with that email to claim access, then invite nurses and doctors.</p></aside></div></main>;
}

function QueuePage() {
  const { getAccessTokenSilently } = useAuth0();
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospitalName, setHospitalName] = useState('');
  const [area, setArea] = useState('');
  const [serviceQuery, setServiceQuery] = useState('');
  const [facilityType, setFacilityType] = useState('');
  const [radius, setRadius] = useState('any');
  const [userLocation, setUserLocation] = useState<GeolocationCoordinates>();
  const [locationError, setLocationError] = useState<string>();
  const [selectedHospital, setSelectedHospital] = useState<Hospital>();
  const [serviceId, setServiceId] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const deferredHospitalName = useDeferredValue(hospitalName);
  const deferredArea = useDeferredValue(area);
  const deferredService = useDeferredValue(serviceQuery);
  const serviceOptions = [...new Set(hospitals.flatMap((hospital) => hospital.services.map((item) => item.name)))].sort();
  const facilityTypes = [...new Set(hospitals.map((hospital) => hospital.facilityType).filter((value): value is string => Boolean(value)))].sort();
  const radiusKm = radius === 'any' ? undefined : Number(radius);
  const matches = hospitals.map((hospital) => ({ hospital, distance: userLocation ? distanceInKm(userLocation, hospital) : undefined })).filter(({ hospital, distance }) => hospital.name.toLowerCase().includes(deferredHospitalName.trim().toLowerCase()) && `${hospital.province} ${hospital.address}`.toLowerCase().includes(deferredArea.trim().toLowerCase()) && hospital.services.some((item) => item.name.toLowerCase().includes(deferredService.trim().toLowerCase())) && (!facilityType || hospital.facilityType === facilityType) && (!radiusKm || (distance !== undefined && distance <= radiusKm))).sort((left, right) => userLocation && left.distance !== undefined && right.distance !== undefined ? left.distance - right.distance : left.hospital.name.localeCompare(right.hospital.name)).slice(0, 50);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: Hospital[] }>('/api/v1/hospitals', token);
        if (!cancelled) setHospitals(result.data);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load hospitals.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [getAccessTokenSilently]);

  async function joinQueue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedHospital || !serviceId) return;
    setJoining(true); setError(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest('/api/v1/queue', token, { method: 'POST', body: { hospitalId: selectedHospital.id, serviceId } });
      navigate('/');
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Could not join the queue.');
    } finally { setJoining(false); }
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setLocationError('Location is not supported by this browser.'); return; }
    navigator.geolocation.getCurrentPosition((position) => { setUserLocation(position.coords); setLocationError(undefined); }, () => setLocationError('We could not access your location. Check your browser permission and try again.'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function clearFilters() { setHospitalName(''); setArea(''); setServiceQuery(''); setFacilityType(''); setRadius('any'); }

  return <main className="queue-page"><header className="booking-header"><button type="button" className="back-button" onClick={() => navigate('/')}>Back</button><div><p className="eyebrow">Same-day virtual queue</p><h1>Join care today.</h1></div></header><div className="queue-layout"><section className="finder"><div className="finder-heading"><div><p className="eyebrow">Step 1</p><h2>Find a hospital service</h2></div><button type="button" className="text-button" onClick={clearFilters}>Clear filters</button></div><div className="search-fields"><label>Hospital name<input value={hospitalName} onChange={(event) => setHospitalName(event.target.value)} placeholder="e.g. Groote Schuur" /></label><label>Area or province<input value={area} onChange={(event) => setArea(event.target.value)} placeholder="e.g. Soweto or Gauteng" /></label><label>Service or department<input list="queue-service-options" value={serviceQuery} onChange={(event) => setServiceQuery(event.target.value)} placeholder="e.g. cardiology or gynae" /><datalist id="queue-service-options">{serviceOptions.map((option) => <option key={option} value={option} />)}</datalist></label><label>Hospital level<select value={facilityType} onChange={(event) => setFacilityType(event.target.value)}><option value="">Any level</option>{facilityTypes.map((option) => <option key={option}>{option}</option>)}</select></label></div><div className="location-controls"><button type="button" className="secondary" onClick={useMyLocation}>Use my location</button>{userLocation ? <label>Within<select value={radius} onChange={(event) => setRadius(event.target.value)}><option value="any">Any distance</option><option value="10">10 km</option><option value="25">25 km</option><option value="50">50 km</option><option value="100">100 km</option></select></label> : null}</div>{locationError ? <p className="error-message">{locationError}</p> : null}<div className="queue-results">{loading ? <p>Loading hospitals...</p> : <p className="result-count">{matches.length} hospital{matches.length === 1 ? '' : 's'} found</p>}{matches.map(({ hospital, distance }) => <button type="button" className={`hospital-result ${selectedHospital?.id === hospital.id ? 'selected' : ''}`} key={hospital.id} onClick={() => { setSelectedHospital(hospital); setServiceId(hospital.services[0]?.id ?? ''); }}><strong>{hospital.name}</strong><small>{hospital.facilityType ?? 'Public hospital'} · {hospital.province}{distance !== undefined ? ` · ${distance.toFixed(1)} km away` : ''}</small><span className="service-tags">{hospital.services.map((item) => <em key={item.id}>{item.name}</em>)}</span></button>)}</div></section><section className="queue-join"><p className="eyebrow">Step 2</p>{!selectedHospital ? <><h2>Select a hospital</h2><p>Choose the service you need, then join today&apos;s first-in, first-out queue.</p></> : <form onSubmit={(event) => void joinQueue(event)}><h2>{selectedHospital.name}</h2><p>{selectedHospital.address}</p><label htmlFor="queue-service">Service<select id="queue-service" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{selectedHospital.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><p className="queue-note">This is a virtual same-day queue, separate from future appointment bookings. Check in at the hospital when requested.</p>{error ? <p role="alert" className="error-message">{error}</p> : null}<button type="submit" disabled={joining}>{joining ? 'Joining queue...' : 'Join today’s queue'}</button></form>}</section></div></main>;
}

const emptyProfile: PatientProfile = { phone: '', dateOfBirth: '', homeAddress: '', emergencyContactName: '', emergencyContactPhone: '', chronicConditions: [], allergies: [], medications: [], bloodType: '', accessNeeds: '', healthNotes: '', healthDataConsent: false };
function listText(values: string[]) { return values.join('\n'); }
function parseList(value: string) { return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean); }

function ProfilePage() {
  const { getAccessTokenSilently } = useAuth0();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PatientProfile>(emptyProfile);
  const [diagnoses, setDiagnoses] = useState<ClinicalDiagnosis[]>([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState<string>();
  useEffect(() => { let cancelled = false; async function load() { try { const token = await getAccessTokenSilently(); const result = await authenticatedRequest<{ data: { profile: PatientProfile | null; diagnoses: ClinicalDiagnosis[] } }>('/api/v1/profile', token); if (!cancelled) { setProfile(result.data.profile ?? emptyProfile); setDiagnoses(result.data.diagnoses); } } catch (loadError) { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load your health record.'); } finally { if (!cancelled) setLoading(false); } } void load(); return () => { cancelled = true; }; }, [getAccessTokenSilently]);
  async function save(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(undefined); try { const token = await getAccessTokenSilently(); await authenticatedRequest('/api/v1/profile', token, { method: 'PUT', body: profile }); navigate('/'); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save your health record.'); } finally { setSaving(false); } }
  const update = <K extends keyof PatientProfile>(key: K, value: PatientProfile[K]) => setProfile((current) => ({ ...current, [key]: value }));
  return <main className="profile-page"><header className="booking-header"><button type="button" className="back-button" onClick={() => navigate('/')}>Back</button><div><p className="eyebrow">Private health record</p><h1>Your care information.</h1></div></header>{loading ? <p>Loading your health record...</p> : <div className="profile-layout"><form className="profile-form" onSubmit={(event) => void save(event)}><section><p className="eyebrow">Contact details</p><div className="form-grid"><label>Phone<input value={profile.phone ?? ''} onChange={(event) => update('phone', event.target.value)} /></label><label>Date of birth<input type="date" value={profile.dateOfBirth ?? ''} onChange={(event) => update('dateOfBirth', event.target.value)} /></label></div><label>Home address<textarea value={profile.homeAddress ?? ''} onChange={(event) => update('homeAddress', event.target.value)} /></label><div className="form-grid"><label>Emergency contact name<input value={profile.emergencyContactName ?? ''} onChange={(event) => update('emergencyContactName', event.target.value)} /></label><label>Emergency contact phone<input value={profile.emergencyContactPhone ?? ''} onChange={(event) => update('emergencyContactPhone', event.target.value)} /></label></div></section><section><p className="eyebrow">Health profile</p><p className="form-help">Enter one item per line or separate items with commas.</p><label>Chronic conditions<textarea value={listText(profile.chronicConditions)} onChange={(event) => update('chronicConditions', parseList(event.target.value))} placeholder="e.g. Asthma" /></label><label>Allergies<textarea value={listText(profile.allergies)} onChange={(event) => update('allergies', parseList(event.target.value))} /></label><label>Current medications<textarea value={listText(profile.medications)} onChange={(event) => update('medications', parseList(event.target.value))} /></label><div className="form-grid"><label>Blood type<select value={profile.bloodType ?? ''} onChange={(event) => update('bloodType', event.target.value)}><option value="">Prefer not to say / unknown</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((type) => <option key={type}>{type}</option>)}</select></label><label>Access needs<input value={profile.accessNeeds ?? ''} onChange={(event) => update('accessNeeds', event.target.value)} placeholder="e.g. wheelchair access" /></label></div><label>Health notes<textarea value={profile.healthNotes ?? ''} onChange={(event) => update('healthNotes', event.target.value)} placeholder="Anything you want your care team to know" /></label></section><label className="consent"><input type="checkbox" checked={profile.healthDataConsent} onChange={(event) => update('healthDataConsent', event.target.checked)} />I consent to NovaCare storing this health information for my care.</label>{error ? <p role="alert" className="error-message">{error}</p> : null}<button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save health record'}</button></form><aside className="diagnosis-panel"><p className="eyebrow">Clinician record</p><h2>Diagnoses</h2><p>Only your care team can add or change diagnoses.</p>{diagnoses.length === 0 ? <p className="empty-state">No clinician diagnoses have been recorded yet.</p> : diagnoses.map((diagnosis) => <article key={diagnosis.id}><strong>{diagnosis.diagnosis}</strong><span>{formatDate(diagnosis.diagnosedOn)}</span>{diagnosis.clinicianName ? <small>{diagnosis.clinicianName}</small> : null}{diagnosis.notes ? <p>{diagnosis.notes}</p> : null}</article>)}</aside></div>}</main>;
}

function BookingPage() {
  const { getAccessTokenSilently } = useAuth0();
  const navigate = useNavigate();
  const location = useLocation();
  const editingAppointment = (location.state as { appointment?: Appointment } | null)?.appointment;
  const [hospitalName, setHospitalName] = useState('');
  const [area, setArea] = useState('');
  const [service, setService] = useState('');
  const [facilityType, setFacilityType] = useState('');
  const [radius, setRadius] = useState('any');
  const [userLocation, setUserLocation] = useState<GeolocationCoordinates>();
  const [locationError, setLocationError] = useState<string>();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<Hospital>();
  const [serviceId, setServiceId] = useState(editingAppointment?.serviceId ?? '');
  const [date, setDate] = useState(editingAppointment?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(editingAppointment?.time ?? BOOKING_START);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const deferredHospitalName = useDeferredValue(hospitalName);
  const deferredArea = useDeferredValue(area);
  const deferredService = useDeferredValue(service);

  useEffect(() => {
    let cancelled = false;
    async function loadHospitals() {
      setLoading(true);
      try {
        const token = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: Hospital[] }>('/api/v1/hospitals', token);
        if (!cancelled) setHospitals(result.data);
      } catch (searchError) {
        if (!cancelled) setError(searchError instanceof Error ? searchError.message : 'Could not search hospitals.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadHospitals();
    return () => { cancelled = true; };
  }, [getAccessTokenSilently]);

  useEffect(() => {
    if (!editingAppointment) return;
    const hospital = hospitals.find((item) => item.id === editingAppointment.hospitalId);
    if (hospital) setSelectedHospital(hospital);
  }, [editingAppointment, hospitals]);

  function chooseHospital(hospital: Hospital) {
    setSelectedHospital(hospital);
    setServiceId(hospital.services[0]?.id ?? '');
    setError(undefined);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationError('Location is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => { setUserLocation(position.coords); setLocationError(undefined); },
      () => setLocationError('We could not access your location. Check your browser permission and try again.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function clearFilters() {
    setHospitalName(''); setArea(''); setService(''); setFacilityType(''); setRadius('any');
  }

  async function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedHospital || !serviceId) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const token = await getAccessTokenSilently();
      if (editingAppointment) {
        const path = editingAppointment.status === 'cancelled' ? `/api/v1/appointments/${editingAppointment.id}/rebook` : `/api/v1/appointments/${editingAppointment.id}`;
        await authenticatedRequest(path, token, { method: editingAppointment.status === 'cancelled' ? 'POST' : 'PATCH', body: { serviceId, date, time } });
      } else {
        await authenticatedRequest('/api/v1/appointments', token, { method: 'POST', body: { hospitalId: selectedHospital.id, serviceId, date, time } });
      }
      navigate('/');
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : 'Could not make your booking.');
    } finally {
      setSubmitting(false);
    }
  }

  const mapUrl = selectedHospital ? `https://www.openstreetmap.org/export/embed.html?bbox=${selectedHospital.longitude - 0.015}%2C${selectedHospital.latitude - 0.01}%2C${selectedHospital.longitude + 0.015}%2C${selectedHospital.latitude + 0.01}&layer=mapnik&marker=${selectedHospital.latitude}%2C${selectedHospital.longitude}` : '';
  const serviceOptions = [...new Set(hospitals.flatMap((hospital) => hospital.services.map((item) => item.name)))].sort();
  const facilityTypes = [...new Set(hospitals.map((hospital) => hospital.facilityType).filter((value): value is string => Boolean(value)))].sort();
  const radiusKm = radius === 'any' ? undefined : Number(radius);
  const results = hospitals
    .map((hospital) => ({ hospital, distance: userLocation ? distanceInKm(userLocation, hospital) : undefined }))
    .filter(({ hospital, distance }) => {
      const nameMatches = hospital.name.toLowerCase().includes(deferredHospitalName.trim().toLowerCase());
      const areaMatches = `${hospital.province} ${hospital.address}`.toLowerCase().includes(deferredArea.trim().toLowerCase());
      const serviceMatches = hospital.services.some((item) => item.name.toLowerCase().includes(deferredService.trim().toLowerCase()));
      const typeMatches = !facilityType || hospital.facilityType === facilityType;
      const radiusMatches = !radiusKm || (distance !== undefined && distance <= radiusKm);
      return nameMatches && areaMatches && serviceMatches && typeMatches && radiusMatches;
    })
    .sort((left, right) => userLocation && left.distance !== undefined && right.distance !== undefined ? left.distance - right.distance : left.hospital.name.localeCompare(right.hospital.name));
  const recommendations = userLocation ? results.slice(0, 3) : [];
  return <main className="booking-page">
    <header className="booking-header"><button type="button" className="back-button" onClick={() => navigate('/')}>Back</button><div><p className="eyebrow">{editingAppointment?.status === 'cancelled' ? 'Rebook appointment' : editingAppointment ? 'Edit appointment' : 'Book an appointment'}</p><h1>{editingAppointment ? 'Choose a new time.' : 'Find the right hospital.'}</h1></div></header>
    <div className="booking-layout">
      <section className="finder" aria-label="Hospital finder">
        <div className="finder-heading"><div><p className="eyebrow">Hospital finder</p><h2>Start with what you need.</h2></div><button type="button" className="text-button" onClick={clearFilters}>Clear filters</button></div>
        <div className="search-fields">
          <label htmlFor="hospital-name">Hospital name<input id="hospital-name" value={hospitalName} onChange={(event) => setHospitalName(event.target.value)} placeholder="e.g. Groote Schuur" autoComplete="off" /></label>
          <label htmlFor="hospital-area">Area or province<input id="hospital-area" value={area} onChange={(event) => setArea(event.target.value)} placeholder="e.g. Soweto or Gauteng" autoComplete="off" /></label>
          <label htmlFor="hospital-service">Service or department<input id="hospital-service" list="service-options" value={service} onChange={(event) => setService(event.target.value)} placeholder="e.g. cardiology or gynae" autoComplete="off" /><datalist id="service-options">{serviceOptions.map((option) => <option value={option} key={option} />)}</datalist></label>
          <label htmlFor="hospital-level">Hospital level<select id="hospital-level" value={facilityType} onChange={(event) => setFacilityType(event.target.value)}><option value="">Any level</option>{facilityTypes.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
        </div>
        <div className="location-controls"><button type="button" className="secondary" onClick={useMyLocation}>Use my location</button>{userLocation ? <label htmlFor="radius">Within<select id="radius" value={radius} onChange={(event) => setRadius(event.target.value)}><option value="any">Any distance</option><option value="10">10 km</option><option value="25">25 km</option><option value="50">50 km</option><option value="100">100 km</option></select></label> : null}</div>
        {locationError ? <p className="error-message">{locationError}</p> : null}
        <div className="search-help">Combine filters to narrow the list. Choose <strong>General consultation</strong> for a routine check-up.</div>
        {recommendations.length > 0 ? <div className="recommendations"><p className="eyebrow">Closest matches</p>{recommendations.map(({ hospital, distance }) => <button type="button" className="recommendation" key={hospital.id} onClick={() => chooseHospital(hospital)}><span><strong>{hospital.name}</strong><small>{hospital.facilityType ?? 'Public hospital'}</small></span><b>{distance?.toFixed(1)} km</b></button>)}</div> : null}
        <div className="hospital-results" aria-live="polite">
          {!loading ? <p className="result-count">{results.length} hospital{results.length === 1 ? '' : 's'} found</p> : null}
          {loading ? <p>Loading the hospital directory...</p> : null}
          {!loading && results.length === 0 ? <p>No hospitals match these filters. Clear a filter or try a broader area.</p> : null}
          {results.map(({ hospital, distance }) => <article key={hospital.id} className={`hospital-result ${selectedHospital?.id === hospital.id ? 'selected' : ''}`}><button type="button" onClick={() => chooseHospital(hospital)}><span><strong>{hospital.name}</strong><small>{hospital.facilityType ?? 'Public hospital'} · {hospital.province}</small></span>{distance !== undefined ? <b>{distance.toFixed(1)} km away</b> : null}</button><p>{hospital.address}</p><span className="service-tags">{hospital.services.map((item) => <em key={item.id}>{item.name}</em>)}</span></article>)}
        </div>
      </section>
      <section className="booking-detail" aria-live="polite">
        {!selectedHospital ? <div className="selection-prompt"><p className="eyebrow">Step 1</p><h2>Select a hospital</h2><p>We will show its location, address and services before you book.</p></div> : <>
          <iframe className="hospital-map" title={`Map showing ${selectedHospital.name}`} src={mapUrl} loading="lazy" />
          <div className="location-card"><p className="eyebrow">Selected hospital</p><h2>{selectedHospital.name}</h2><p>{selectedHospital.address}</p><a href={`https://www.openstreetmap.org/?mlat=${selectedHospital.latitude}&mlon=${selectedHospital.longitude}#map=15/${selectedHospital.latitude}/${selectedHospital.longitude}`} target="_blank" rel="noreferrer">Open directions in OpenStreetMap</a></div>
          <form onSubmit={(event) => void submitBooking(event)} className="booking-form">
            <label htmlFor="service">Service needed</label>
            <select id="service" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{selectedHospital.services.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select>
            <div className="date-time-fields"><label htmlFor="date">Date<input id="date" type="date" min={new Date().toISOString().slice(0, 10)} value={date} onChange={(event) => setDate(event.target.value)} required /></label><label htmlFor="time">Time<input id="time" type="time" min={BOOKING_START} max="18:30" step="1800" value={time} onChange={(event) => setTime(event.target.value)} required /></label></div>
            <p className="booking-note">Booking hours are {BOOKING_START}–{BOOKING_END}. Listed services follow the hospital booking hours for this demo.</p>
            {error ? <p role="alert" className="error-message">{error}</p> : null}
            <button type="submit" disabled={submitting}>{submitting ? 'Saving booking...' : editingAppointment?.status === 'cancelled' ? 'Rebook appointment' : editingAppointment ? 'Save changes' : 'Confirm booking'}</button>
          </form>
        </>}
      </section>
    </div>
  </main>;
}

function App() {
  return <Routes>
    <Route path="/" element={<HomeRoute />} />
    <Route path="/signin" element={<SignInPage />} />
    <Route path="/patient" element={<PatientPortalPage />} />
    <Route path="/staff" element={<StaffPortalPage role="nurse" />} />
    <Route path="/doctor" element={<StaffPortalPage role="doctor" />} />
    <Route path="/admin" element={<AdminPortalPage />} />
    <Route path="/invitations/claim" element={<InvitationClaimPage />} />
    <Route path="/care" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
    <Route path="/care/book" element={<ProtectedPage><BookingPage /></ProtectedPage>} />
    <Route path="/care/queue" element={<ProtectedPage><QueuePage /></ProtectedPage>} />
    <Route path="/care/profile" element={<ProtectedPage><ProfilePage /></ProtectedPage>} />
    <Route path="/book" element={<ProtectedPage><BookingPage /></ProtectedPage>} />
    <Route path="/queue" element={<ProtectedPage><QueuePage /></ProtectedPage>} />
    <Route path="/profile" element={<ProtectedPage><ProfilePage /></ProtectedPage>} />
    <Route path="/overseer" element={<ProtectedPage><OverseerPage /></ProtectedPage>} />
    <Route path="/care/admin" element={<Navigate to="/admin" replace />} />
    <Route path="/landing" element={<LandingPage />} />
    <Route path="/admin-portal" element={<Navigate to="/admin" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default App;
