import { useState, type FormEvent } from 'react';
import type { ServiceRequestRow, ServiceStatus, ServiceUrgency } from '../../api.ts';
import { type ServiceRequestInput } from './useServiceRequests.ts';

const ambulanceReasonOptions = [
  { id: 'chest-pain', label: 'Chest pain' },
  { id: 'breathing-difficulty', label: 'Breathing difficulty' },
  { id: 'severe-bleeding', label: 'Severe bleeding' },
  { id: 'road-accident', label: 'Road accident' },
  { id: 'unconscious-person', label: 'Unconscious person' },
  { id: 'other-emergency', label: 'Other emergency' },
] as const;

const homeVisitReasonOptions = [
  { id: 'check-up', label: 'Check-up' },
  { id: 'chronic-care', label: 'Chronic care visit' },
  { id: 'medication-review', label: 'Medication review' },
  { id: 'wound-care', label: 'Wound care' },
  { id: 'other-visit', label: 'Other visit' },
] as const;

const consciousOptions = [
  { id: 'YES', label: 'Yes' },
  { id: 'NO', label: 'No' },
  { id: 'UNKNOWN', label: 'Not sure' },
] as const;

const responderOptions = [
  { id: 'DOCTOR', label: 'Doctor' },
  { id: 'NURSE', label: 'Nurse' },
  { id: 'EITHER', label: 'Either is fine' },
] as const;

const demoLocationOptions = [
  { id: 'sandton', label: 'Sandton demo point', latitude: -26.1076, longitude: 28.0567 },
  { id: 'rosebank', label: 'Rosebank demo point', latitude: -26.1467, longitude: 28.0417 },
  { id: 'parktown', label: 'Parktown demo point', latitude: -26.176, longitude: 28.045 },
] as const;

const statusLabels: Record<ServiceStatus, string> = {
  CREATED: 'Received',
  SEARCHING: 'Searching simulated facilities',
  NOTIFIED: 'Notified simulated facilities',
  ACKNOWLEDGED: 'Facility acknowledged',
  ACCEPTED: 'Facility accepted',
  ASSIGNED: 'Facility assigned',
  DISPATCHED: 'Simulated responder assigned',
  EN_ROUTE: 'En route (simulated)',
  ARRIVED: 'Arrived (simulated)',
  IN_PROGRESS: 'Care in progress (simulated)',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_PROVIDER_FOUND: 'No simulated provider found',
};

const statusTone: Record<ServiceStatus, 'blue' | 'yellow' | 'green' | 'gray' | 'red'> = {
  CREATED: 'blue',
  SEARCHING: 'blue',
  NOTIFIED: 'yellow',
  ACKNOWLEDGED: 'yellow',
  ACCEPTED: 'yellow',
  ASSIGNED: 'blue',
  DISPATCHED: 'blue',
  EN_ROUTE: 'green',
  ARRIVED: 'green',
  IN_PROGRESS: 'green',
  COMPLETED: 'gray',
  CANCELLED: 'red',
  NO_PROVIDER_FOUND: 'red',
};

const typeLabels = { AMBULANCE: 'Ambulance', HOME_VISIT: 'Home visit' } as const;
const urgencyLabels = { EMERGENCY: 'Emergency', URGENT: 'Urgent', STANDARD: 'Standard' } as const;

function formatTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

interface LocationCapture {
  latitude: number;
  longitude: number;
}

interface ServiceRequestPanelProps {
  requests: ServiceRequestRow[];
  loading: boolean;
  error: string | undefined;
  onCreate: (input: ServiceRequestInput) => Promise<ServiceRequestRow>;
}

export function ServiceRequestPanel({ requests, loading, error, onCreate }: ServiceRequestPanelProps) {
  const [mode, setMode] = useState<'AMBULANCE' | 'HOME_VISIT' | null>(null);
  const [ambulanceReason, setAmbulanceReason] = useState('');
  const [homeVisitReason, setHomeVisitReason] = useState('');
  const [conscious, setConscious] = useState<'YES' | 'NO' | 'UNKNOWN' | ''>('');
  const [preferredResponder, setPreferredResponder] = useState<'DOCTOR' | 'NURSE' | 'EITHER' | ''>('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<LocationCapture | null>(null);
  const [demoLocation, setDemoLocation] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [success, setSuccess] = useState<{ reference: string; type: 'AMBULANCE' | 'HOME_VISIT' } | null>(null);

  function chooseMode(next: 'AMBULANCE' | 'HOME_VISIT') {
    setMode(next);
    setFormError(undefined);
    setSuccess(null);
  }

  function useBrowserLocation() {
    if (!('geolocation' in window.navigator)) {
      setLocationError('This browser cannot share a location. Type an address instead.');
      return;
    }
    setLocating(true);
    setLocationError(undefined);
    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocationError('Could not read your location. Allow location access or type an address instead.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    if (mode === 'AMBULANCE' && !ambulanceReason) {
      setFormError('Choose what happened so the demo dispatcher sees the right category.');
      return;
    }
    if (mode === 'AMBULANCE' && !conscious) {
      setFormError('Let us know whether the person is conscious.');
      return;
    }
    if (mode === 'HOME_VISIT' && !homeVisitReason) {
      setFormError('Choose a reason for the home visit.');
      return;
    }
    if (mode === 'HOME_VISIT' && !preferredResponder) {
      setFormError('Choose whether you prefer a doctor, a nurse, or either.');
      return;
    }
    const trimmedAddress = address.trim();
    const selectedDemoLocation = demoLocationOptions.find((option) => option.id === demoLocation);
    const searchCoordinates = coords ?? (selectedDemoLocation ? { latitude: selectedDemoLocation.latitude, longitude: selectedDemoLocation.longitude } : null);
    if (!searchCoordinates && !trimmedAddress) {
      setFormError('Share your browser location or type your address so the demo search has a starting point.');
      return;
    }
    setBusy(true);
    setFormError(undefined);
    try {
      const input: ServiceRequestInput = {
        type: mode,
        urgency: mode === 'AMBULANCE' ? 'EMERGENCY' : 'STANDARD',
        triage:
          mode === 'AMBULANCE'
            ? { ambulanceReason, conscious: conscious as 'YES' | 'NO' | 'UNKNOWN' }
            : { homeVisitReason, preferredResponder: preferredResponder as 'DOCTOR' | 'NURSE' | 'EITHER' },
        ...(trimmedAddress ? { address: trimmedAddress } : {}),
        ...(searchCoordinates ? { latitude: searchCoordinates.latitude, longitude: searchCoordinates.longitude } : {}),
      };
      const row = await onCreate(input);
      setSuccess({ reference: row.reference_code, type: mode });
      setAmbulanceReason('');
      setHomeVisitReason('');
      setConscious('');
      setPreferredResponder('');
      setAddress('');
      setCoords(null);
      setDemoLocation('');
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : 'Could not send your test request. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="nv-care-view">
      <header className="nv-care-view-head">
        <h1 className="section-title">Emergency & home-visit requests</h1>
        <p className="muted">Send a development test request to the demo dispatcher console and follow its simulated status here.</p>
      </header>

      <div className="nv-sw-alert nv-sr-sim-banner" role="alert">
        <strong>Development prototype — not a real emergency service.</strong>
        <span>Every request sent from this page is a marked test request. Simulated facilities and responders are used for the demo and no real ambulance, doctor or nurse is dispatched.</span>
      </div>

      <div className="nv-sr-safety" role="note">
        <strong>If this is a real emergency, call 10177 or 112 now.</strong>
        <span>Do not wait for this demo page. South Africa&apos;s emergency numbers connect you to real help.</span>
      </div>

      <div className="nv-sr-actions">
        <button
          type="button"
          aria-label="Request an Ambulance"
          aria-pressed={mode === 'AMBULANCE'}
          className={`card nv-sr-action nv-sr-ambulance${mode === 'AMBULANCE' ? ' selected' : ''}`}
          onClick={() => chooseMode('AMBULANCE')}
        >
          <span className="nv-sr-action-tag">Development request</span>
          <h2>Request an Ambulance</h2>
          <p className="muted">Send a simulated ambulance test request with the reason and whether the person is conscious.</p>
        </button>
        <button
          type="button"
          aria-label="Request a Home Visit"
          aria-pressed={mode === 'HOME_VISIT'}
          className={`card nv-sr-action nv-sr-homevisit${mode === 'HOME_VISIT' ? ' selected' : ''}`}
          onClick={() => chooseMode('HOME_VISIT')}
        >
          <span className="nv-sr-action-tag">Development request</span>
          <h2>Request a Home Visit</h2>
          <p className="muted">Send a simulated home-visit test request and choose whether you prefer a doctor or a nurse.</p>
        </button>
      </div>

      {mode ? (
        <form className="card nv-care-card nv-sr-form" onSubmit={(event) => void submit(event)}>
          <div className="nv-care-card-head">
            <h2>{mode === 'AMBULANCE' ? 'Ambulance test request' : 'Home-visit test request'}</h2>
            <p className="muted">
              {mode === 'AMBULANCE'
                ? 'Tell the demo dispatcher what happened. This stays inside the simulation.'
                : 'Tell the demo dispatcher what the visit is for. This stays inside the simulation.'}
            </p>
          </div>

          {mode === 'AMBULANCE' ? (
            <>
              <label className="nv-field">
                What happened?
                <select value={ambulanceReason} onChange={(event) => setAmbulanceReason(event.target.value)}>
                  <option value="">Choose a reason…</option>
                  {ambulanceReasonOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <fieldset className="nv-sr-choice">
                <legend>Is the person conscious?</legend>
                <div className="nv-sr-choice-row">
                  {consciousOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`nv-sr-chip${conscious === option.id ? ' selected' : ''}`}
                      aria-pressed={conscious === option.id}
                      onClick={() => setConscious(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <label className="nv-field">
                Reason for the visit
                <select value={homeVisitReason} onChange={(event) => setHomeVisitReason(event.target.value)}>
                  <option value="">Choose a reason…</option>
                  {homeVisitReasonOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <fieldset className="nv-sr-choice">
                <legend>Who should come?</legend>
                <div className="nv-sr-choice-row">
                  {responderOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`nv-sr-chip${preferredResponder === option.id ? ' selected' : ''}`}
                      aria-pressed={preferredResponder === option.id}
                      onClick={() => setPreferredResponder(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          <fieldset className="nv-sr-choice">
            <legend>Where should the simulated team go?</legend>
            <div className="nv-sr-locate-row">
              <button type="button" className="secondary-btn" onClick={useBrowserLocation} disabled={locating}>
                {locating ? 'Locating…' : 'Use my current location'}
              </button>
              {coords ? (
                <span className="nv-sr-located">
                  Location captured ({coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}) — simulated search will start here.
                </span>
              ) : (
                <span className="muted small">Browser location is used only for this demo search.</span>
              )}
            </div>
            {locationError ? <p className="nv-error" role="alert">{locationError}</p> : null}
            <label className="nv-field">
              Or type your address
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="e.g. 7th Avenue, Parktown, Johannesburg"
              />
            </label>
            {!coords ? (
              <label className="nv-field">
                Simulated map point for manual-address testing
                <select value={demoLocation} onChange={(event) => setDemoLocation(event.target.value)}>
                  <option value="">No simulated coordinate selected</option>
                  {demoLocationOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="muted small">For a manual address, choose an optional simulated map point to run the demo radius search. Address-only requests are logged for dispatcher review.</p>
          </fieldset>

          {formError ? <p className="nv-error" role="alert">{formError}</p> : null}
          {success ? (
            <div className="nv-sr-success" role="status">
              <strong>NovaCare received your test request successfully.</strong>
              <span>
                Reference {success.reference} — {success.type === 'AMBULANCE' ? 'an' : 'a'} {typeLabels[success.type].toLowerCase()} test request. Track its simulated status below.
              </span>
            </div>
          ) : null}

          <div className="nv-book-actions">
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? 'Sending…' : mode === 'AMBULANCE' ? 'Send ambulance test request' : 'Send home-visit test request'}
            </button>
            <button type="button" className="ghost-btn" onClick={() => { setMode(null); setFormError(undefined); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="nv-care-block">
        <h2 className="section-title">Your test requests</h2>
        {error ? <p className="nv-error" role="alert">{error}</p> : null}
        {loading ? <p className="muted">Loading your test requests…</p> : null}
        {!loading && requests.length === 0 ? (
          <div className="card nv-empty">
            <p className="muted">No test requests yet. Use one of the actions above to send your first development request.</p>
          </div>
        ) : (
          <ul className="nv-sr-list">
            {requests.map((request) => (
              <li className="card nv-sr-row" key={request.id} data-no-translate>
                <div className="nv-sr-row-main">
                  <div className="nv-sr-row-head">
                    <strong>{request.reference_code}</strong>
                    <span className={`badge urgency-${request.urgency.toLowerCase() as Lowercase<ServiceUrgency>}`}>
                      {urgencyLabels[request.urgency]}
                    </span>
                  </div>
                  <p className="muted small">
                    {typeLabels[request.type]} · sent {formatTime(request.created_at)}
                    {request.address ? ` · ${request.address}` : ''}
                  </p>
                  <p className="muted small">
                    Reason:{' '}
                    {request.triage.ambulanceReason
                      ? (ambulanceReasonOptions.find((option) => option.id === request.triage.ambulanceReason)?.label ?? request.triage.ambulanceReason)
                      : request.triage.homeVisitReason
                        ? (homeVisitReasonOptions.find((option) => option.id === request.triage.homeVisitReason)?.label ?? request.triage.homeVisitReason)
                        : request.reason ?? 'Not specified'}
                    {request.triage.conscious ? ` · conscious: ${request.triage.conscious.toLowerCase()}` : ''}
                    {request.triage.preferredResponder ? ` · prefers ${request.triage.preferredResponder.toLowerCase()}` : ''}
                  </p>
                </div>
                <div className="nv-sr-row-status">
                  <span className={`nv-sr-badge nv-sr-${statusTone[request.status]}`}>{statusLabels[request.status]}</span>
                  {request.escalation_flag ? <span className="nv-sr-badge nv-sr-yellow">Widened search area</span> : null}
                  {request.status === 'NO_PROVIDER_FOUND' ? (
                    <span className="muted small">Demo request logged — no simulated facility accepted it.</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
