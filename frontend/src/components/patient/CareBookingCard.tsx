import { useDeferredValue, useEffect, useState } from 'react';
import type { Appointment, AppointmentTriageSummary, Hospital } from '../../api.ts';
import type { PatientStrings } from '../../i18n/patientTranslations.ts';
import { HospitalMap } from './HospitalMap.tsx';
import { BOOKING_END, BOOKING_START, distanceInKm, formatDate, type Coordinates } from './careMath.ts';

interface CareBookingCardProps {
  t: PatientStrings;
  hospitals: Hospital[];
  loading: boolean;
  editingAppointment: Appointment | null;
  bookingSuggestion: { hospitalId?: string; serviceId?: string; triageSummary: AppointmentTriageSummary } | null;
  onFinishEdit: () => void;
  onCreate: (input: { hospitalId: string; serviceId: string; date: string; time: string; triageSummary?: AppointmentTriageSummary | null }) => Promise<void>;
  onUpdate: (id: string, input: { serviceId: string; date: string; time: string }) => Promise<void>;
  onRebook: (id: string, input: { serviceId: string; date: string; time: string }) => Promise<void>;
  onJoinQueue: (input: { hospitalId: string; serviceId: string }) => Promise<void>;
}

export function CareBookingCard({ t, hospitals, loading, editingAppointment, bookingSuggestion, onFinishEdit, onCreate, onUpdate, onRebook, onJoinQueue }: CareBookingCardProps) {
  const care = t.care;
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
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

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
    setNotice(undefined);
  }, [bookingSuggestion, editingAppointment, hospitals]);

  function selectHospital(hospital: Hospital) {
    setSelectedHospital(hospital);
    setServiceId(hospital.services[0]?.id ?? '');
    setError(undefined);
    setNotice(undefined);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setLocationError(care.locateFailed);
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
        setLocationError(care.locateFailed);
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
    setNotice(undefined);
    try {
      if (editingAppointment) {
        const input = { serviceId, date, time };
        if (editingAppointment.status === 'cancelled') {
          await onRebook(editingAppointment.id, input);
          setNotice(care.rebookedOk);
        } else {
          await onUpdate(editingAppointment.id, input);
          setNotice(care.updatedOk);
        }
        onFinishEdit();
      } else {
        await onCreate({ hospitalId: selectedHospital.id, serviceId, date, time, triageSummary: bookingSuggestion?.triageSummary ?? null });
        setNotice(care.bookedOk);
      }
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : care.actionFailed);
    } finally {
      setSubmitting(undefined);
    }
  }

  async function submitQueueJoin() {
    if (!selectedHospital || !serviceId) return;
    setSubmitting('queue');
    setError(undefined);
    setNotice(undefined);
    try {
      await onJoinQueue({ hospitalId: selectedHospital.id, serviceId });
      setNotice(care.queueJoined);
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : care.actionFailed);
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
    ? `${editingAppointment.status === 'cancelled' ? care.rebook : t.reschedule} — ${editingAppointment.hospitalName}, ${formatDate(editingAppointment.date)} ${editingAppointment.time}`
    : undefined;

  return (
    <section className="card nv-care-card" aria-label={care.findHospital}>
      <header className="nv-care-card-head">
        <h2 className="section-title">{care.findHospital}</h2>
        <p className="muted small">{care.findSub}</p>
      </header>
      <div className="nv-finder-grid">
        <div className="nv-finder-controls">
          <label className="nv-field">{care.searchName}
            <input value={hospitalName} onChange={(event) => setHospitalName(event.target.value)} placeholder="Groote Schuur" autoComplete="off" />
          </label>
          <label className="nv-field">{care.searchArea}
            <input value={area} onChange={(event) => setArea(event.target.value)} placeholder="Soweto, Gauteng" autoComplete="off" />
          </label>
          <label className="nv-field">{care.searchService}
            <input list="nv-service-options" value={service} onChange={(event) => setService(event.target.value)} autoComplete="off" />
            <datalist id="nv-service-options">{serviceOptions.map((option) => <option key={option} value={option} />)}</datalist>
          </label>
          <div className="nv-locate-row">
            <button type="button" className="secondary-btn" onClick={useMyLocation} disabled={locating}>{locating ? care.locating : care.nearMe}</button>
            {userLocation ? (
              <label className="nv-field nv-radius">{care.radius}
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
            {!loading ? <p className="muted small">{results.length} {care.hospitalsFound}</p> : null}
            {loading ? <p className="muted small">…</p> : null}
            {!loading && results.length === 0 ? <p className="muted small">{care.noResults}</p> : null}
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
                    {distance !== undefined ? <b>{distance.toFixed(1)} {care.distanceAway}</b> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="nv-finder-detail">
          <HospitalMap hospitals={results.map((result) => result.hospital)} userLocation={userLocation} selectedId={selectedHospital?.id} onSelect={selectHospital} />
          {!selectedHospital ? (
            <div className="nv-select-prompt"><p className="muted small">{care.selectPrompt}</p></div>
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
              <p className="muted small">{care.addressLabel}: {selectedHospital.address}</p>
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
                <label className="nv-field">{care.dateLabel}
                  <input type="date" value={date} min={today} onChange={(event) => setDate(event.target.value)} required />
                </label>
                <label className="nv-field">{care.timeLabel}
                  <input type="time" value={time} min={BOOKING_START} max={BOOKING_END} step={1800} onChange={(event) => setTime(event.target.value)} required />
                </label>
                {error ? <p className="nv-error" role="alert">{error}</p> : null}
                {notice ? <p className="nv-notice" role="status">{notice}</p> : null}
                <div className="nv-book-actions">
                  <button type="submit" className="primary-btn" disabled={submitting !== undefined || !serviceId}>
                    {submitting === 'book' ? '…' : care.confirmBooking}
                  </button>
                  <button type="button" className="secondary-btn" disabled={submitting !== undefined || !serviceId} onClick={() => void submitQueueJoin()}>
                    {submitting === 'queue' ? '…' : care.joinQueue}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
