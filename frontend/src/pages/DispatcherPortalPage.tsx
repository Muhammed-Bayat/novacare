import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  apiBaseUrl,
  authenticatedRequest,
  type AvailableResponders,
  type CurrentUser,
  type DispatchNotificationEntry,
  type DispatcherQueue,
  type NotificationResponseStatus,
  type ServiceChannel,
  type ServiceRequestDetail,
  type ServiceRequestRow,
  type ServiceStatus,
  type ServiceUrgency,
} from '../api.ts';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';
import '../styles/patient-portal.css';
import '../styles/patient-care.css';
import '../styles/staff-workspace.css';
import '../styles/dispatcher-portal.css';

const statusLabels: Record<ServiceStatus, string> = {
  CREATED: 'Created',
  SEARCHING: 'Searching',
  NOTIFIED: 'Notified',
  ACKNOWLEDGED: 'Acknowledged',
  ACCEPTED: 'Accepted',
  ASSIGNED: 'Assigned',
  DISPATCHED: 'Dispatched',
  EN_ROUTE: 'En route',
  ARRIVED: 'Arrived',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_PROVIDER_FOUND: 'No provider found',
};

const statusBadge: Record<ServiceStatus, string> = {
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

const urgencyLabels: Record<ServiceUrgency, string> = { EMERGENCY: 'Emergency', URGENT: 'Urgent', STANDARD: 'Standard' };
const urgencyBadge: Record<ServiceUrgency, string> = { EMERGENCY: 'red', URGENT: 'yellow', STANDARD: 'gray' };
const channelLabels: Record<ServiceChannel, string> = { WEB: 'Web', USSD: 'USSD', SMS: 'SMS' };

const responseLabels: Record<NotificationResponseStatus, string> = {
  PENDING: 'Pending',
  ACKNOWLEDGED: 'Acknowledged',
  AVAILABLE: 'Available',
  UNAVAILABLE: 'Unavailable',
  ACCEPTED: 'Accepted',
};

const ambulanceReasonLabels: Record<string, string> = {
  'chest-pain': 'Chest pain',
  'breathing-difficulty': 'Breathing difficulty',
  'severe-bleeding': 'Severe bleeding',
  'road-accident': 'Road accident',
  'unconscious-person': 'Unconscious person',
  'other-emergency': 'Other emergency',
};

const homeVisitReasonLabels: Record<string, string> = {
  'check-up': 'Check-up',
  'chronic-care': 'Chronic care',
  'medication-review': 'Medication review',
  'wound-care': 'Wound care',
  'other-visit': 'Other visit',
};

const consciousLabels: Record<string, string> = { YES: 'Conscious', NO: 'Unconscious', UNKNOWN: 'Consciousness unknown' };
const responderPreferenceLabels: Record<string, string> = { DOCTOR: 'Doctor preferred', NURSE: 'Nurse preferred', EITHER: 'Doctor or nurse' };

const forwardActions: Partial<Record<ServiceStatus, { to: ServiceStatus; label: string }>> = {
  DISPATCHED: { to: 'EN_ROUTE', label: 'Mark en route' },
  EN_ROUTE: { to: 'ARRIVED', label: 'Mark arrived' },
  ARRIVED: { to: 'IN_PROGRESS', label: 'Start care' },
  IN_PROGRESS: { to: 'COMPLETED', label: 'Complete request' },
};

const cancellableStatuses: ServiceStatus[] = ['CREATED', 'SEARCHING', 'NOTIFIED', 'ACKNOWLEDGED', 'ACCEPTED', 'ASSIGNED', 'DISPATCHED', 'EN_ROUTE'];

function statusPresentation(request: Pick<ServiceRequestRow, 'status' | 'location_state'>): { label: string; badge: string } {
  if (request.location_state === 'DISPATCHER_LOCATION_REVIEW') {
    return { label: 'Location review required', badge: 'yellow' };
  }
  return { label: statusLabels[request.status], badge: statusBadge[request.status] };
}

function greetingFor(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function ageLabel(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}

function parseSseFrames(buffer: string): { events: string[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: string[] = [];
  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');
    if (data) events.push(data);
  }
  return { events, rest };
}

interface DispatcherData {
  access: CurrentUser | undefined;
  queue: DispatcherQueue | undefined;
  responders: AvailableResponders;
  selectedId: string | undefined;
  detail: ServiceRequestDetail | undefined;
  detailLoading: boolean;
  loading: boolean;
  error: string | undefined;
  streamState: 'live' | 'idle' | 'reconnecting';
  refresh: () => Promise<void>;
  select: (id: string | undefined) => void;
}

function useDispatcherData(isAuthenticated: boolean, getToken: () => Promise<string>): DispatcherData {
  const [access, setAccess] = useState<CurrentUser>();
  const [queue, setQueue] = useState<DispatcherQueue>();
  const [responders, setResponders] = useState<AvailableResponders>({ responders: [], units: [] });
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ServiceRequestDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [streamState, setStreamState] = useState<'live' | 'idle' | 'reconnecting'>('idle');

  const load = useCallback(async (silent: boolean) => {
    if (!isAuthenticated) return;
    if (!silent) setLoading(true);
    try {
      const token = await getToken();
      const me = await authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token);
      setAccess(me.data);
      if (me.data.staffRole !== 'dispatcher' && me.data.staffRole !== 'administrator') {
        setQueue(undefined);
        setResponders({ responders: [], units: [] });
        return;
      }
      const [queueResult, responderResult] = await Promise.all([
        authenticatedRequest<{ data: DispatcherQueue }>('/api/v1/dispatcher/service-requests', token),
        me.data.staffRole === 'dispatcher'
          ? authenticatedRequest<{ data: AvailableResponders }>('/api/v1/dispatcher/available-responders', token)
          : Promise.resolve({ data: { responders: [], units: [] } as AvailableResponders }),
      ]);
      setQueue(queueResult.data);
      setResponders(responderResult.data);
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the dispatch console.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, getToken]);

  const loadDetail = useCallback(async (id: string | undefined) => {
    if (!id || !isAuthenticated) {
      setDetail(undefined);
      return;
    }
    setDetailLoading(true);
    try {
      const token = await getToken();
      const result = await authenticatedRequest<{ data: ServiceRequestDetail }>(`/api/v1/dispatcher/service-requests/${id}`, token);
      setDetail(result.data);
    } catch {
      setDetail(undefined);
    } finally {
      setDetailLoading(false);
    }
  }, [isAuthenticated, getToken]);

  useEffect(() => {
    if (isAuthenticated) void load(false);
  }, [isAuthenticated, load]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = window.setInterval(() => void load(true), 15000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, load]);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const loadRef = useRef(load);
  const loadDetailRef = useRef(loadDetail);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    loadDetailRef.current = loadDetail;
  }, [loadDetail]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let reconnectTimer: number | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let controller: AbortController | undefined;
    let reconnectDelay = 2000;

    function reconnect() {
      if (cancelled || reconnectTimer !== undefined) return;
      setStreamState('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
        void connect();
      }, reconnectDelay);
    }

    async function connect() {
      if (cancelled) return;
      let token: string;
      try {
        token = await getToken();
      } catch {
        if (!cancelled) reconnect();
        return;
      }
      let response: Response;
      try {
        controller = new AbortController();
        response = await fetch(`${apiBaseUrl}/api/v1/service-requests/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      } catch {
        if (!cancelled) reconnect();
        return;
      }
      if (!response.ok || !response.body) {
        reconnect();
        return;
      }
      setStreamState('live');
      reconnectDelay = 2000;
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseFrames(buffer);
          buffer = parsed.rest;
          if (parsed.events.length > 0) {
            void loadRef.current(true);
            void loadDetailRef.current(selectedIdRef.current);
          }
        }
      } catch {
        // Connection dropped — reconnect below.
      }
      reconnect();
    }

    void connect();
    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      controller?.abort();
      reader?.cancel().catch(() => undefined);
    };
  }, [isAuthenticated, getToken]);

  const refresh = useCallback(async () => {
    await Promise.all([load(true), loadDetail(selectedId)]);
  }, [load, loadDetail, selectedId]);

  const select = useCallback((id: string | undefined) => setSelectedId(id), []);

  return { access, queue, responders, selectedId, detail, detailLoading, loading, error, streamState, refresh, select };
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function RequestCard({ request, selected, onSelect }: { request: ServiceRequestRow; selected: boolean; onSelect: () => void }) {
  const displayStatus = statusPresentation(request);
  return (
    <li>
      <button type="button" aria-pressed={selected} className={`card nv-dispatch-card${selected ? ' selected' : ''}`} onClick={onSelect}>
        <span className="nv-dispatch-card-head">
          <strong>{request.reference_code}</strong>
          <span className={`badge ${displayStatus.badge}`}>{displayStatus.label}</span>
        </span>
        <span className="nv-dispatch-badges">
          <span className={`badge ${request.type === 'AMBULANCE' ? 'red' : 'blue'}`}>{request.type === 'AMBULANCE' ? 'Ambulance' : 'Home visit'}</span>
          <span className={`badge ${urgencyBadge[request.urgency]}`}>{urgencyLabels[request.urgency]}</span>
          <span className="badge gray">{channelLabels[request.channel]}</span>
          {request.escalation_flag ? <span className="badge red">Escalated</span> : null}
        </span>
        <span className="muted small nv-dispatch-card-meta">
          {ageLabel(request.created_at)}
          {request.search_radius_km != null ? ` · radius ${request.search_radius_km} km` : ''}
          {request.address ? ` · ${request.address}` : ''}
        </span>
      </button>
    </li>
  );
}

function notificationActions(notification: DispatchNotificationEntry, status: ServiceStatus) {
  if (status === 'NOTIFIED' && notification.response_status === 'PENDING') {
    return [
      { key: 'acknowledge', label: 'Acknowledge', response: 'ACKNOWLEDGED' as const, className: 'secondary-btn' },
      { key: 'unavailable', label: 'Unavailable', response: 'UNAVAILABLE' as const, className: 'ghost-btn' },
    ];
  }
  if (status === 'ACKNOWLEDGED' && (notification.response_status === 'PENDING' || notification.response_status === 'ACKNOWLEDGED')) {
    return [
      { key: 'accept', label: 'Accept', response: 'ACCEPTED' as const, className: 'primary-btn' },
      { key: 'available', label: 'Available', response: 'AVAILABLE' as const, className: 'secondary-btn' },
      { key: 'unavailable', label: 'Unavailable', response: 'UNAVAILABLE' as const, className: 'ghost-btn' },
    ];
  }
  return [];
}

function RequestDetail({ detail, loading, responders, canOperate, onChanged }: { detail: ServiceRequestDetail | undefined; loading: boolean; responders: AvailableResponders; canOperate: boolean; onChanged: () => Promise<void> }) {
  const { getAccessTokenSilently } = useAuth0();
  const [busyKey, setBusyKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [facilityId, setFacilityId] = useState('');
  const [assignment, setAssignment] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualLatitude, setManualLatitude] = useState('');
  const [manualLongitude, setManualLongitude] = useState('');

  useEffect(() => {
    setFacilityId('');
    setAssignment('');
    setCancelOpen(false);
    setCancelReason('');
    setManualAddress('');
    setManualLatitude('');
    setManualLongitude('');
    setError(undefined);
  }, [detail?.id, detail?.status]);

  async function act(key: string, path: string, body?: unknown) {
    setBusyKey(key);
    setError(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest(path, token, { method: 'POST', body });
      setCancelOpen(false);
      setCancelReason('');
      await onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That action failed. Please try again.');
    } finally {
      setBusyKey(undefined);
    }
  }

  async function patchStatus(key: string, body: unknown) {
    setBusyKey(key);
    setError(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest(`/api/v1/dispatcher/service-requests/${detail?.id}/status`, token, { method: 'PATCH', body });
      setCancelOpen(false);
      setCancelReason('');
      await onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That action failed. Please try again.');
    } finally {
      setBusyKey(undefined);
    }
  }

  if (loading || !detail) {
    return (
      <div className="card nv-empty nv-dispatch-detail">
        <p className="muted">{loading ? 'Loading request detail…' : 'Select a request from the list to review it here.'}</p>
      </div>
    );
  }

  const assignableFacilities = detail.notifications.filter((notification) =>
    ['ACCEPTED', 'AVAILABLE'].includes(notification.response_status),
  );
  const assignedFacilityId = detail.assigned_facility_id;
  const preferredResponder = detail.triage?.preferredResponder;
  const assignmentOptions = detail.type === 'AMBULANCE'
    ? responders.units
        .filter((unit) => unit.hospital_id === assignedFacilityId)
        .map((unit) => ({ value: `unit:${unit.id}`, label: `${unit.callsign} — ${unit.hospital_name}` }))
    : responders.responders
        .filter((responder) => responder.hospital_id === assignedFacilityId && responder.home_visit_eligible && (preferredResponder === 'EITHER' || !preferredResponder || responder.role === preferredResponder.toLowerCase()))
        .map((responder) => ({ value: `responder:${responder.id}`, label: `${responder.display_name ?? responder.email ?? 'Responder'} — ${responder.hospital_name}` }));
  const assignedUnit = detail.assigned_unit_id ? responders.units.find((unit) => unit.id === detail.assigned_unit_id) : undefined;
  const assignedResponder = detail.assigned_responder_id ? responders.responders.find((responder) => responder.id === detail.assigned_responder_id) : undefined;
  const assignedFacility = detail.assigned_facility_id ? detail.notifications.find((notification) => notification.facility_id === detail.assigned_facility_id) : undefined;
  const forward = forwardActions[detail.status];
  const cancellable = cancellableStatuses.includes(detail.status);
  const triage = detail.triage ?? {};
  const canResolveLocation = detail.status === 'CREATED' && detail.location_state === 'DISPATCHER_LOCATION_REVIEW' && canOperate;
  const displayStatus = statusPresentation(detail);

  return (
    <div className="card nv-dispatch-detail">
      <header className="nv-dispatch-detail-head">
        <div>
          <h2>{detail.reference_code}</h2>
          <p className="muted small">
            {channelLabels[detail.channel]} channel · opened {formatTime(detail.created_at)}
            {detail.search_radius_km != null ? ` · search radius ${detail.search_radius_km} km` : ''}
            {detail.facilities_notified != null ? ` · ${detail.facilities_notified} facilities notified` : ''}
          </p>
        </div>
        <div className="nv-dispatch-badges">
          <span className={`badge ${detail.type === 'AMBULANCE' ? 'red' : 'blue'}`}>{detail.type === 'AMBULANCE' ? 'Ambulance' : 'Home visit'}</span>
          <span className={`badge ${urgencyBadge[detail.urgency]}`}>{urgencyLabels[detail.urgency]}</span>
          <span className={`badge ${displayStatus.badge}`}>{displayStatus.label}</span>
          {detail.escalation_flag ? <span className="badge red">Escalated — widen search</span> : null}
        </div>
      </header>

      {detail.address || detail.latitude != null ? (
        <div className="nv-dispatch-block">
          <strong className="small">Location</strong>
          <div className="nv-dispatch-location-visual" aria-label="Request location">
            <span aria-hidden="true" className="nv-dispatch-location-pin" />
            <div>
              <strong>Request point</strong>
              <p className="muted small">{detail.address ?? 'Coordinates only'}</p>
              {detail.latitude != null && detail.longitude != null ? (
                <p className="muted small">{detail.latitude.toFixed(5)}, {detail.longitude.toFixed(5)}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {detail.reason || triage.ambulanceReason || triage.homeVisitReason ? (
        <div className="nv-dispatch-block">
          <strong className="small">Reported details</strong>
          {detail.reason ? <p className="muted small">{detail.reason}</p> : null}
          <div className="nv-dispatch-badges">
            {triage.ambulanceReason ? <span className="badge yellow">{ambulanceReasonLabels[triage.ambulanceReason] ?? triage.ambulanceReason}</span> : null}
            {triage.conscious ? <span className="badge blue">{consciousLabels[triage.conscious] ?? triage.conscious}</span> : null}
            {triage.homeVisitReason ? <span className="badge blue">{homeVisitReasonLabels[triage.homeVisitReason] ?? triage.homeVisitReason}</span> : null}
            {triage.preferredResponder ? <span className="badge gray">{responderPreferenceLabels[triage.preferredResponder] ?? triage.preferredResponder}</span> : null}
          </div>
        </div>
      ) : null}

      {detail.status === 'NO_PROVIDER_FOUND' ? (
        <div className="nv-sw-alert" role="alert">
          <strong>No provider found within the maximum search radius.</strong>
          <span>Review the request details and contact the requester directly. No further notifications will be sent.</span>
        </div>
      ) : null}

      {detail.location_state === 'DISPATCHER_LOCATION_REVIEW' ? (
        <div className="nv-sw-alert" role="alert">
          <strong>Location requires manual dispatcher review.</strong>
          <span>No facility matching or notification has started for this request.</span>
        </div>
      ) : null}

      {canResolveLocation ? (
        <div className="nv-dispatch-block">
          <strong className="small">Resolve location manually</strong>
          <p className="muted small">Enter a dispatcher-verified address and coordinates. This starts provider matching.</p>
          <label className="nv-field">
            Verified address
            <input value={manualAddress} onChange={(event) => setManualAddress(event.target.value)} placeholder="Verified address" />
          </label>
          <div className="nv-dispatch-location-fields">
            <label className="nv-field">Latitude<input value={manualLatitude} onChange={(event) => setManualLatitude(event.target.value)} inputMode="decimal" /></label>
            <label className="nv-field">Longitude<input value={manualLongitude} onChange={(event) => setManualLongitude(event.target.value)} inputMode="decimal" /></label>
          </div>
          <button
            type="button"
            className="primary-btn"
            disabled={busyKey === 'resolve-location' || !manualAddress.trim() || !manualLatitude.trim() || !manualLongitude.trim()}
            onClick={() => void act('resolve-location', `/api/v1/dispatcher/service-requests/${detail.id}/location`, {
              address: manualAddress,
              latitude: Number(manualLatitude),
              longitude: Number(manualLongitude),
            })}
          >
            {busyKey === 'resolve-location' ? 'Starting matching...' : 'Confirm location and start matching'}
          </button>
        </div>
      ) : null}

      {detail.status === 'CANCELLED' ? (
        <div className="nv-dispatch-block">
          <strong className="small">Cancelled</strong>
          <p className="muted small">{detail.cancel_reason ?? 'No reason recorded'}{detail.cancelled_at ? ` · ${formatTime(detail.cancelled_at)}` : ''}</p>
        </div>
      ) : null}

      {assignedFacility || assignedUnit || assignedResponder ? (
        <div className="nv-dispatch-block">
          <strong className="small">Current assignment</strong>
          {assignedFacility ? <p className="muted small">Facility: {assignedFacility.facility_name}</p> : null}
          {assignedUnit ? <p className="muted small">Unit: {assignedUnit.callsign} — {assignedUnit.hospital_name}</p> : null}
          {assignedResponder ? <p className="muted small">Responder: {assignedResponder.display_name ?? assignedResponder.email} — {assignedResponder.hospital_name}</p> : null}
        </div>
      ) : null}

      <div className="nv-dispatch-block">
        <strong className="small">Status history</strong>
        <ol className="nv-dispatch-timeline">
          {detail.history.map((entry) => (
            <li key={entry.id}>
              <span className="nv-dispatch-timeline-status">
                {entry.from_status ? `${statusLabels[entry.from_status]} → ` : ''}{statusLabels[entry.to_status]}
              </span>
              {entry.note ? <span className="muted small">{entry.note}</span> : null}
              <span className="muted small">{formatTime(entry.created_at)}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="nv-dispatch-block">
        <strong className="small">Notified facilities</strong>
        {detail.notifications.length === 0 ? (
          <p className="muted small">No facilities have been notified yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="nv-dispatch-table">
              <thead>
                <tr>
                  <th>Facility</th>
                  <th>Distance</th>
                  <th>Notified</th>
                  <th>Response</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {detail.notifications.map((notification) => {
                  const actions = canOperate ? notificationActions(notification, detail.status) : [];
                  return (
                    <tr key={notification.id}>
                      <td>
                        {notification.facility_name}
                        <span className="nv-dispatch-sub">Facility</span>
                      </td>
                      <td>{notification.distance_km != null ? `${notification.distance_km.toFixed(1)} km` : '—'}</td>
                      <td>{formatTime(notification.notified_at)}</td>
                      <td><span className={`badge ${notification.response_status === 'UNAVAILABLE' ? 'gray' : notification.response_status === 'PENDING' ? 'yellow' : 'green'}`}>{responseLabels[notification.response_status]}</span></td>
                      <td>
                        {actions.length > 0 ? (
                          <span className="nv-dispatch-row-actions">
                            {actions.map((action) => (
                              <button
                                key={action.key}
                                type="button"
                                className={action.className}
                                disabled={busyKey !== undefined}
                                onClick={() => void act(`${action.key}:${notification.id}`, `/api/v1/dispatcher/service-requests/${detail.id}/respond`, { facilityId: notification.facility_id, response: action.response })}
                              >
                                {action.label}
                              </button>
                            ))}
                          </span>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canOperate && detail.status === 'ACCEPTED' ? (
        <form className="nv-dispatch-assign" onSubmit={(event) => {
          event.preventDefault();
          if (facilityId) void act('assign-facility', `/api/v1/dispatcher/service-requests/${detail.id}/assign-facility`, { facilityId });
        }}>
          <strong className="small">Assign facility</strong>
          <div className="nv-dispatch-assign-row">
            <select value={facilityId} onChange={(event) => setFacilityId(event.target.value)} aria-label="Choose facility">
              <option value="">Choose a responding facility…</option>
              {assignableFacilities.map((notification) => (
                <option key={notification.facility_id} value={notification.facility_id}>
                  {notification.facility_name}{notification.distance_km != null ? ` (${notification.distance_km.toFixed(1)} km)` : ''}
                </option>
              ))}
            </select>
            <button type="submit" className="primary-btn" disabled={busyKey !== undefined || !facilityId}>Assign facility</button>
          </div>
        </form>
      ) : null}

      {canOperate && detail.status === 'ASSIGNED' ? (
        <form className="nv-dispatch-assign" onSubmit={(event) => {
          event.preventDefault();
          if (!assignment) return;
          const [kind, ...rest] = assignment.split(':');
          const body = kind === 'unit' ? { unitId: rest.join(':') } : { responderId: rest.join(':') };
          void act('assign-responder', `/api/v1/dispatcher/service-requests/${detail.id}/assign-responder`, body);
        }}>
          <strong className="small">{detail.type === 'AMBULANCE' ? 'Assign a response unit' : 'Assign a home-visit responder'}</strong>
          <div className="nv-dispatch-assign-row">
            <select
              value={assignment}
              onChange={(event) => setAssignment(event.target.value)}
              aria-label={detail.type === 'AMBULANCE' ? 'Choose response unit' : 'Choose responder'}
            >
              <option value="">{detail.type === 'AMBULANCE' ? 'Choose an available unit…' : 'Choose an available responder…'}</option>
              {assignmentOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button type="submit" className="primary-btn" disabled={busyKey !== undefined || !assignment}>{detail.type === 'AMBULANCE' ? 'Assign unit' : 'Assign responder'}</button>
          </div>
          {assignmentOptions.length === 0 ? <p className="muted small">Nothing available right now — wait for a unit or responder to become free, or cancel the request.</p> : null}
        </form>
      ) : null}

      {error ? <p className="nv-error" role="alert">{error}</p> : null}

      {canOperate ? <div className="nv-dispatch-actions">
        {forward ? (
          <button type="button" className="primary-btn" disabled={busyKey !== undefined} onClick={() => void patchStatus(`forward:${forward.to}`, { status: forward.to })}>
            {forward.label}
          </button>
        ) : null}
        {cancellable ? (
          cancelOpen ? (
            <form className="nv-dispatch-cancel" onSubmit={(event) => {
              event.preventDefault();
              if (cancelReason.trim()) void patchStatus('cancel', { status: 'CANCELLED', cancelReason: cancelReason.trim() });
            }}>
              <label className="nv-field">Cancellation reason
                <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="e.g. Requester confirmed it was a false alarm" required />
              </label>
              <div className="nv-dispatch-row-actions">
                <button type="submit" className="primary-btn" disabled={busyKey !== undefined || !cancelReason.trim()}>Confirm cancellation</button>
                <button type="button" className="ghost-btn" onClick={() => { setCancelOpen(false); setCancelReason(''); }}>Back</button>
              </div>
            </form>
          ) : (
            <button type="button" className="ghost-btn" disabled={busyKey !== undefined} onClick={() => setCancelOpen(true)}>Cancel request</button>
          )
        ) : null}
      </div> : <p className="muted small">Read-only administrator view. Dispatcher access is required to change a request.</p>}
    </div>
  );
}

export function DispatcherPortalPage() {
  const { isAuthenticated, loginWithRedirect, logout, getAccessTokenSilently, user } = useAuth0();
  const data = useDispatcherData(isAuthenticated, getAccessTokenSilently);
  const [view, setView] = useState<'queue' | 'unresolved'>('queue');

  if (isAuthenticated && data.access && data.access.staffRole !== 'dispatcher' && data.access.staffRole !== 'administrator') return <Navigate to="/" replace />;

  const displayName = data.access?.displayName ?? user?.given_name ?? user?.name ?? 'Dispatcher';
  const displayInitial = displayName.trim().slice(0, 1).toUpperCase() || 'D';
  const greeting = `${greetingFor(new Date().getHours())}, ${displayName}`;
  const canOperate = data.access?.staffRole === 'dispatcher';

  const live = data.queue?.live ?? [];
  const unresolved = data.queue?.unresolved ?? [];
  const metrics = data.queue?.metrics;
  const visible = view === 'queue' ? live : unresolved;

  const navItems = [
    { label: 'Queue', active: view === 'queue', onClick: () => setView('queue') },
    { label: `Unresolved (${unresolved.length})`, active: view === 'unresolved', onClick: () => setView('unresolved') },
  ];

  return (
    <div className="app nv-patient">
      <TopBar>
        <Brand />
        <TopNav items={navItems} />
        <div className="actions">
          <button type="button" className="user-chip">
            <span style={{ fontWeight: 800 }}>{displayInitial}</span> <span>{data.access ? `Hi, ${displayName}` : 'Dispatch console'}</span>
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
            <p className="eyebrow">Dispatcher portal</p>
            <h1>{greeting}</h1>
            <p className="muted">{canOperate ? 'Monitor ambulance and home-visit requests, coordinate facilities, and track each request through to completion.' : 'Review the dispatch queue and request history. Operational changes require a dispatcher account.'}</p>
          </div>
        </div>
      </section>

      {!isAuthenticated ? (
        <section className="nv-care-view">
          <div className="card card-pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, color: 'var(--text)' }}>Dispatcher sign-in required</h3>
              <div className="muted small" style={{ marginTop: 4 }}>Sign in with your invited dispatcher email to open the dispatch console.</div>
            </div>
            <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
          </div>
        </section>
      ) : (
        <>
          <div className="nv-sw-alert nv-dispatch-sim-banner" role="alert">
            <strong>For testing only. No real emergency services are contacted.</strong>
          </div>

          {data.error ? <p className="nv-error" role="alert" style={{ margin: '0 24px' }}>{data.error}</p> : null}

          <p className="nv-visually-hidden" role="status" aria-live="polite">{data.streamState === 'live' ? 'Dispatcher queue live updates connected.' : 'Dispatcher queue updates are reconnecting or polling.'}</p>

          {metrics ? (
            <div className="nv-dispatch-metrics">
              <MetricCard label="Active requests" value={metrics.active} />
              <MetricCard label="Ambulance" value={metrics.ambulance} />
              <MetricCard label="Home visits" value={metrics.homeVisit} />
              <MetricCard label="Awaiting assignment" value={metrics.awaitingAssignment} />
              <MetricCard label="Dispatched" value={metrics.dispatched} />
            </div>
          ) : null}

          <section className="nv-dispatch-layout">
            <div className="nv-dispatch-list">
              <div className="nv-dispatch-list-head">
                <h2 className="section-title">{view === 'queue' ? 'Live queue' : 'Unresolved requests'}</h2>
                <span className={`nv-dispatch-stream ${data.streamState}`}>
                  {data.streamState === 'live' ? 'Live updates' : data.streamState === 'reconnecting' ? 'Reconnecting…' : 'Polling every 15 s'}
                </span>
              </div>
              {visible.length === 0 ? (
                <div className="card nv-empty">
                  <p className="muted">
                    {data.loading
                      ? 'Loading requests…'
                      : view === 'queue'
                        ? 'No active requests right now. New requests appear here in real time.'
                        : 'No unresolved requests. Requests with no provider appear here.'}
                  </p>
                </div>
              ) : (
                <ul className="nv-dispatch-cards">
                  {visible.map((request) => (
                    <RequestCard key={request.id} request={request} selected={data.selectedId === request.id} onSelect={() => data.select(request.id)} />
                  ))}
                </ul>
              )}
            </div>
            <RequestDetail detail={data.detail} loading={data.detailLoading} responders={data.responders} canOperate={canOperate} onChanged={data.refresh} />
          </section>
        </>
      )}
    </div>
  );
}
