import { useState } from 'react';
import type { Appointment, QueueEntry } from '../../api.ts';
import { dateParts, formatDate } from './careMath.ts';

const copy = {
  actionFailed: 'Something went wrong. Please try again.',
  upcomingList: 'Upcoming appointments',
  noUpcoming: 'No upcoming appointments. Find a hospital below to book your next visit.',
  queueToday: 'Today’s queue',
  queuePosition: 'Your position',
  estWait: 'Est. wait',
  leaveQueue: 'Leave queue',
  cancelledList: 'Cancelled appointments',
  rebook: 'Rebook',
  cancel: 'Cancel',
  statusWaiting: 'In queue',
  statusCalled: 'Please proceed',
  statusAwaitingTriage: 'Awaiting nurse review',
  statusInConsultation: 'In consultation',
  triageNote: 'A nurse is reviewing your details before your queue position is assigned.',
  emergencyQueueNote: 'Your case has been flagged as urgent. Staff will attend to you immediately — you do not wait in the regular queue.',
  checkIn: 'Check in',
  checkedIn: 'Checked in',
};

interface AppointmentsPanelProps {
  appointments: Appointment[];
  queueEntries: QueueEntry[];
  onCancel: (id: string) => Promise<void>;
  onLeaveQueue: (id: string) => Promise<void>;
  onEdit: (appointment: Appointment) => void;
  onCheckIn: (id: string) => Promise<void>;
}

function joinedTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function urgencyLabel(value: NonNullable<Appointment['triageSummary']>['urgency']): string {
  switch (value) {
    case 'emergency': return 'Emergency';
    case 'urgent': return 'Urgent';
    case 'priority': return 'Priority';
    default: return 'Routine';
  }
}

export function AppointmentsPanel({ appointments, queueEntries, onCancel, onLeaveQueue, onEdit, onCheckIn }: AppointmentsPanelProps) {
  const [busyKey, setBusyKey] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const upcoming = appointments.filter((appointment) => appointment.status === 'booked' || appointment.status === 'checked_in');
  const cancelled = appointments.filter((appointment) => appointment.status === 'cancelled');

  async function run(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setActionError(undefined);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setBusyKey(undefined);
    }
  }

  return (
    <div className="nv-care-stack">
      <section className="nv-care-block" aria-label={copy.upcomingList}>
        <h2 className="section-title">{copy.upcomingList}</h2>
        {upcoming.length === 0 ? <div className="card nv-empty">{copy.noUpcoming}</div> : (
          <ul className="nv-appt-list">
            {upcoming.map((appointment) => {
              const { weekday, day, month } = dateParts(appointment.date);
              return (
                <li className="card nv-appt" key={appointment.id}>
                  <div className="nv-appt-date" aria-hidden="true"><span>{weekday}</span><strong>{day}</strong><span>{month}</span></div>
                  <div className="nv-appt-body">
                    <h3>{appointment.hospitalName}</h3>
                    <p className="muted small">{appointment.serviceName} · {formatDate(appointment.date)} · {appointment.time}</p>
                    <p className="muted small">{appointment.address}</p>
                    {appointment.triageSummary ? (
                      <div className="nv-appt-triage">
                        <span className={`badge urgency-${appointment.triageSummary.urgency}`}>{urgencyLabel(appointment.triageSummary.urgency)}</span>
                        <div>
                          <strong>{appointment.triageSummary.pathwayName} assessment</strong>
                          <p>{appointment.triageSummary.summary}</p>
                          {appointment.triageSummary.redFlags.length > 0 ? <small>{appointment.triageSummary.redFlags.join(', ')}</small> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="nv-appt-actions">
                    {appointment.status === 'checked_in' ? (
                      <span className="badge green">{copy.checkedIn}</span>
                    ) : (
                      <>
                        {appointment.date.slice(0, 10) === todayKey() ? (
                          <button
                            type="button"
                            className="primary-btn"
                            disabled={busyKey === `checkin:${appointment.id}`}
                            onClick={() => void run(`checkin:${appointment.id}`, () => onCheckIn(appointment.id))}
                          >
                            {copy.checkIn}
                          </button>
                        ) : null}
                        <button type="button" className="secondary-btn" onClick={() => onEdit(appointment)}>Reschedule</button>
                        <button
                          type="button"
                          className="ghost-btn nv-danger"
                          disabled={busyKey === `cancel:${appointment.id}`}
                          onClick={() => void run(`cancel:${appointment.id}`, () => onCancel(appointment.id))}
                        >
                          {copy.cancel}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {queueEntries.length > 0 ? (
        <section className="nv-care-block" aria-label={copy.queueToday}>
          <h2 className="section-title">{copy.queueToday}</h2>
          <ul className="nv-appt-list">
            {queueEntries.map((entry) => {
              const awaiting = entry.status === 'awaiting_triage';
              const emergency = entry.category === 'emergency';
              const statusLabel = entry.status === 'called'
                ? copy.statusCalled
                : entry.status === 'in_consultation'
                  ? copy.statusInConsultation
                  : awaiting
                    ? copy.statusAwaitingTriage
                    : copy.statusWaiting;
              const statusClass = entry.status === 'called' ? 'green' : awaiting ? 'yellow' : 'blue';
              return (
                <li className="card nv-appt" key={entry.id}>
                  <div className="nv-appt-date nv-queue-pos" aria-hidden="true"><strong>{entry.position ?? '–'}</strong><span>{copy.queuePosition}</span></div>
                  <div className="nv-appt-body">
                    <h3>{entry.hospitalName}</h3>
                    {awaiting ? (
                      <p className="muted small">{entry.serviceName} · {joinedTime(entry.joinedAt)}</p>
                    ) : (
                      <p className="muted small">{entry.serviceName} · {entry.estimatedWaitMinutes !== null ? `${copy.estWait} ±${entry.estimatedWaitMinutes} min · ` : ''}{joinedTime(entry.joinedAt)}</p>
                    )}
                    <p className="muted small">{entry.address}</p>
                    {awaiting ? <p className="muted small">{copy.triageNote}</p> : null}
                    {awaiting && entry.triageSummary?.urgency === 'emergency' ? (
                      <p className="nv-error" role="alert">You told us this may be an emergency. Please tell reception or call 10177 immediately if you feel worse.</p>
                    ) : null}
                    {emergency ? <p className="nv-notice">{copy.emergencyQueueNote}</p> : null}
                  </div>
                  <div className="nv-appt-actions">
                    <span className={`badge ${statusClass}`}>{statusLabel}</span>
                    {entry.category ? <span className={`badge urgency-${entry.category}`}>{urgencyLabel(entry.category)}</span> : null}
                    <button
                      type="button"
                      className="ghost-btn nv-danger"
                      disabled={busyKey === `queue:${entry.id}`}
                      onClick={() => void run(`queue:${entry.id}`, () => onLeaveQueue(entry.id))}
                    >
                      {copy.leaveQueue}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {cancelled.length > 0 ? (
        <section className="nv-care-block" aria-label={copy.cancelledList}>
          <h2 className="section-title">{copy.cancelledList}</h2>
          <ul className="nv-appt-list">
            {cancelled.map((appointment) => (
              <li className="card nv-appt nv-appt-cancelled" key={appointment.id}>
                <div className="nv-appt-body">
                  <h3>{appointment.hospitalName}</h3>
                  <p className="muted small">{appointment.serviceName} · {formatDate(appointment.date)} · {appointment.time}</p>
                </div>
                <div className="nv-appt-actions">
                  <button type="button" className="secondary-btn" onClick={() => onEdit(appointment)}>{copy.rebook}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {actionError ? <p className="nv-error" role="alert">{actionError}</p> : null}
    </div>
  );
}
