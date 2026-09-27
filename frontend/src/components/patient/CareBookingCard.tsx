import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { Appointment, AppointmentTriageSummary, Hospital } from '../../api.ts';
import { HospitalMap } from './HospitalMap.tsx';
import { BOOKING_END, BOOKING_START, distanceInKm, formatDate, type Coordinates } from './careMath.ts';

const copy = {
  locateFailed: 'Could not get your location. Distance sorting is off.',
  rebookedOk: 'Appointment rebooked',
  updatedOk: 'Appointment updated',
  bookedOk: 'Appointment booked',
  queueJoined: 'You’re in the queue',
  actionFailed: 'Something went wrong. Please try again.',
  findHospital: 'Find a hospital',
  findSub: 'Search by name, area or service. Allow location to sort by distance and see the closest hospitals on the map.',
  searchName: 'Hospital name',
  searchArea: 'Area or city',
  searchService: 'Service',
  nearMe: 'Near me',
  locating: 'Locating…',
  radius: 'Within',
  hospitalsFound: 'hospitals found',
  noResults: 'No hospitals match your search.',
  distanceAway: 'km away',
  selectPrompt: 'Select a hospital from the map or list to view details and book.',
  addressLabel: 'Address',
  dateLabel: 'Date',
  timeLabel: 'Time (07:00–19:00)',
  confirmBooking: 'Confirm booking',
  joinQueue: 'Join today’s queue',
  rebook: 'Rebook',
  reschedule: 'Reschedule',
  backToDashboard: 'Back to dashboard',
  autoReturn: 'Taking you back automatically…',
  queueJoinedDetail: 'A nurse will review your details shortly. You can follow today’s queue from your dashboard.',
};

interface CareBookingCardProps {
  hospitals: Hospital[];
  loading: boolean;
  editingAppointment: Appointment | null;
  bookingSuggestion: { hospitalId?: string; serviceId?: string; triageSummary: AppointmentTriageSummary } | null;
  onFinishEdit: () => void;
  onComplete: () => void;
  onCreate: (input: { hospitalId: string; serviceId: string; date: string; time: string; triageSummary?: AppointmentTriageSummary | null }) => Promise<void>;
  onUpdate: (id: string, input: { serviceId: string; date: string; time: string }) => Promise<void>;
  onRebook: (id: string, input: { serviceId: string; date: string; time: string }) => Promise<void>;
  onJoinQueue: (input: { hospitalId: string; serviceId: string; triageSummary?: AppointmentTriageSummary | null }) => Promise<void>;
}

export function CareBookingCard({ hospitals, loading, editingAppointment, bookingSuggestion, onFinishEdit, onComplete, onCreate, onUpdate, onRebook, onJoinQueue }: CareBookingCardProps) {
  const [hospitalName, setHospitalName] = useState('');
  const [area, setArea] = useState('');
  const [service, setService] = useState('');
  const [radius, setRadius] = useState('any');
  const [userLocation, setUserLocation] = useState<Coordinates>();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string>();
  const [selectedHospital, setSelectedHospital] = useState<Hospital>();
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(BOOKING_START);
  const [submitting, setSubmitting] = useState<'book' | 'queue'>();
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<{ title: string; detail: string }>();
  const cardRef = useRef<HTMLElement>(null);
  const returnTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(returnTimer.current), []);

  function showConfirmation(title: string, detail: string) {
    setConfirmation({ title, detail });
    returnTimer.current = window.setTimeout(() => onComplete(), 2800);
  }

  function returnNow() {
    window.clearTimeout(returnTimer.current);
    onComplete();
  }

  const deferredName = useDeferredValue(hospitalName);
  const deferredArea = useDeferredValue(area);
  const deferredService = useDeferredValue(service);

  useEffect(() => {
    if (!editingAppointment) return;
    const hospital = hospitals.find((item) => item.id === editingAppointment.hospitalId);
    if (hospital) {
      setSelectedHospital(hospital);
      setServiceId(editingAppointment.serviceId);
    }
    setDate(editingAppointment.date);
    setTime(editingAppointment.time);
  }, [editingAppointment, hospitals]);

  useEffect(() => {
    if (!bookingSuggestion || editingAppointment) return;
    const hospital = bookingSuggestion.hospitalId ? hospitals.find((item) => item.id === bookingSuggestion.hospitalId) : undefined;
    if (!hospital) return;
    setSelectedHospital(hospital);
    setServiceId(bookingSuggestion.serviceId && hospital.services.some((item) => item.id === bookingSuggestion.serviceId) ? bookingSuggestion.serviceId : hospital.services[0]?.id ?? '');
    setHospitalName(hospital.name);
    setService(hospital.services.find((item) => item.id === bookingSuggestion.serviceId)?.name ?? '');
    setError(undefined);
    cardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [bookingSuggestion, editingAppointment, hospitals]);

  function selectHospital(hospital: Hospital) {
    setSelectedHospital(hospital);
    setServiceId(hospital.services[0]?.id ?? '');
    setError(undefined);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationError(copy.locateFailed);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationError(undefined);
        setLocating(false);
      },
      () => {
        setLocationError(copy.locateFailed);
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedHospital || !serviceId) return;
    setSubmitting('book');
    setError(undefined);
    try {
      const serviceName = selectedHospital.services.find((item) => item.id === serviceId)?.name ?? '';
      const detail = `${selectedHospital.name} · ${serviceName} · ${formatDate(date)} ${time}`;
      if (editingAppointment) {
        const input = { serviceId, date, time };
        if (editingAppointment.status === 'cancelled') {
          await onRebook(editingAppointment.id, input);
          showConfirmation(copy.rebookedOk, detail);
        } else {
          await onUpdate(editingAppointment.id, input);
          showConfirmation(copy.updatedOk, detail);
        }
        onFinishEdit();
      } else {
        await onCreate({ hospitalId: selectedHospital.id, serviceId, date, time, triageSummary: bookingSuggestion?.triageSummary ?? null });
        showConfirmation(copy.bookedOk, detail);
      }
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : copy.actionFailed);
    } finally {
      setSubmitting(undefined);
    }
  }

  async function submitQueueJoin() {
    if (!selectedHospital || !serviceId) return;
    setSubmitting('queue');
    setError(undefined);
    try {
      await onJoinQueue({ hospitalId: selectedHospital.id, serviceId, triageSummary: bookingSuggestion?.triageSummary ?? null });
      const serviceName = selectedHospital.services.find((item) => item.id === serviceId)?.name ?? '';
      showConfirmation(copy.queueJoined, `${selectedHospital.name} · ${serviceName}. ${copy.queueJoinedDetail}`);
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : copy.actionFailed);
    } finally {
      setSubmitting(undefined);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const serviceOptions = [...new Set(hospitals.flatMap((hospital) => hospital.services.map((item) => item.name)))].sort();
  const radiusKm = radius === 'any' ? undefined : Number(radius);
  const results = hospitals
    .map((hospital) => ({ hospital, distance: userLocation ? distanceInKm(userLocation, hospital) : undefined }))
    .filter(({ hospital, distance }) => {
      const nameMatches = hospital.name.toLowerCase().includes(deferredName.trim().toLowerCase());
      const areaMatches = `${hospital.province} ${hospital.address}`.toLowerCase().includes(deferredArea.trim().toLowerCase());
      const serviceMatches = hospital.services.some((item) => item.name.toLowerCase().includes(deferredService.trim().toLowerCase()));
      const radiusMatches = !radiusKm || (distance !== undefined && distance <= radiusKm);
      return nameMatches && areaMatches && serviceMatches && radiusMatches;
    })
    .sort((left, right) => userLocation && left.distance !== undefined && right.distance !== undefined ? left.distance - right.distance : left.hospital.name.localeCompare(right.hospital.name));
  const closest = userLocation ? results.slice(0, 3) : [];
  const selectedDistance = selectedHospital && userLocation ? distanceInKm(userLocation, selectedHospital) : undefined;
  const editingLabel = editingAppointment
    ? `${editingAppointment.status === 'cancelled' ? copy.rebook : copy.reschedule} — ${editingAppointment.hospitalName}, ${formatDate(editingAppointment.date)} ${editingAppointment.time}`
    : undefined;

  return (
    <section className="card nv-care-card" aria-label={copy.findHospital} ref={cardRef}>
      <header className="nv-care-card-head">
        <h2 className="section-title">{copy.findHospital}</h2>
        <p className="muted small">{copy.findSub}</p>
      </header>
      {confirmation ? (
        <div className="nv-booking-success" role="status">
          <span className="nv-success-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          </span>
          <h3>{confirmation.title}</h3>
          <p className="muted">{confirmation.detail}</p>
          <div className="nv-success-actions">
            <button type="button" className="primary-btn" onClick={returnNow}>{copy.backToDashboard}</button>
            <span className="muted small">{copy.autoReturn}</span>
          </div>
        </div>
      ) : (
      <div className="nv-finder-grid">
        <div className="nv-finder-controls">
          <label className="nv-field">{copy.searchName}
            <input value={hospitalName} onChange={(event) => setHospitalName(event.target.value)} placeholder="Groote Schuur" autoComplete="off" />
          </label>
          <label className="nv-field">{copy.searchArea}
            <input value={area} onChange={(event) => setArea(event.target.value)} placeholder="Soweto, Gauteng" autoComplete="off" />
          </label>
          <label className="nv-field">{copy.searchService}
            <input list="nv-service-options" value={service} onChange={(event) => setService(event.target.value)} autoComplete="off" />
            <datalist id="nv-service-options">{serviceOptions.map((option) => <option key={option} value={option} />)}</datalist>
          </label>
          <div className="nv-locate-row">
            <button type="button" className="secondary-btn" onClick={useMyLocation} disabled={locating}>{locating ? copy.locating : copy.nearMe}</button>
            {userLocation ? (
              <label className="nv-field nv-radius">{copy.radius}
                <select value={radius} onChange={(event) => setRadius(event.target.value)}>
                  <option value="any">—</option>
                  <option value="10">10 km</option>
                  <option value="25">25 km</option>
                  <option value="50">50 km</option>
                  <option value="100">100 km</option>
                </select>
              </label>
            ) : null}
          </div>
          {locationError ? <p className="nv-error" role="alert">{locationError}</p> : null}
          <div className="nv-results" aria-live="polite">
            {!loading ? <p className="muted small">{results.length} {copy.hospitalsFound}</p> : null}
            {loading ? <p className="muted small">…</p> : null}
            {!loading && results.length === 0 ? <p className="muted small">{copy.noResults}</p> : null}
            {closest.length > 0 ? (
              <div className="nv-closest">
                {closest.map(({ hospital, distance }) => (
                  <button key={hospital.id} type="button" className={`nv-result ${selectedHospital?.id === hospital.id ? 'selected' : ''}`} onClick={() => selectHospital(hospital)}>
                    <span><strong>{hospital.name}</strong><small className="muted">{hospital.facilityType ?? hospital.province}</small></span>
                    <b>{distance?.toFixed(1)} km</b>
                  </button>
                ))}
              </div>
            ) : null}
            <ul className="nv-result-list">
              {results.map(({ hospital, distance }) => (
                <li key={hospital.id}>
                  <button type="button" className={`nv-result ${selectedHospital?.id === hospital.id ? 'selected' : ''}`} onClick={() => selectHospital(hospital)}>
                    <span><strong>{hospital.name}</strong><small className="muted">{hospital.address}</small></span>
                    {distance !== undefined ? <b>{distance.toFixed(1)} {copy.distanceAway}</b> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="nv-finder-detail">
          <HospitalMap hospitals={results.map((result) => result.hospital)} userLocation={userLocation} selectedId={selectedHospital?.id} onSelect={selectHospital} />
          {!selectedHospital ? (
            <div className="nv-select-prompt"><p className="muted small">{copy.selectPrompt}</p></div>
          ) : (
            <div className="nv-detail-card">
              {editingAppointment ? (
                <div className="nv-edit-note">
                  <span className="muted small">{editingLabel}</span>
                  <button type="button" className="ghost-btn" aria-label="Stop editing" onClick={onFinishEdit}>Close</button>
                </div>
              ) : null}
              <div className="nv-detail-head">
                <div>
                  <h3>{selectedHospital.name}</h3>
                  <p className="muted small">{selectedHospital.facilityType ?? selectedHospital.province}</p>
                </div>
                {selectedDistance !== undefined ? <span className="badge blue">{selectedDistance.toFixed(1)} km</span> : null}
              </div>
              <p className="muted small">{copy.addressLabel}: {selectedHospital.address}</p>
              <div className="nv-service-tags">
                {selectedHospital.services.map((item) => (
                  <button key={item.id} type="button" className={`nv-tag ${serviceId === item.id ? 'active' : ''}`} onClick={() => setServiceId(item.id)}>{item.name}</button>
                ))}
              </div>
              <form className="nv-book-form" onSubmit={(event) => void submitBooking(event)}>
                {!editingAppointment && bookingSuggestion ? (
                  <div className="nv-book-summary-note">
                    <strong>{bookingSuggestion.triageSummary.urgency} assessment</strong>
                    <span>{bookingSuggestion.triageSummary.summary}</span>
                  </div>
                ) : null}
                <label className="nv-field">{copy.dateLabel}
                  <input type="date" value={date} min={today} onChange={(event) => setDate(event.target.value)} required />
                </label>
                <label className="nv-field">{copy.timeLabel}
                  <input type="time" value={time} min={BOOKING_START} max={BOOKING_END} step={1800} onChange={(event) => setTime(event.target.value)} required />
                </label>
                {error ? <p className="nv-error" role="alert">{error}</p> : null}
                <div className="nv-book-actions">
                  <button type="submit" className="primary-btn" disabled={submitting !== undefined || !serviceId}>
                    {submitting === 'book' ? '…' : copy.confirmBooking}
                  </button>
                  <button type="button" className="secondary-btn" disabled={submitting !== undefined || !serviceId} onClick={() => void submitQueueJoin()}>
                    {submitting === 'queue' ? '…' : copy.joinQueue}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
      )}
    </section>
  );
}
