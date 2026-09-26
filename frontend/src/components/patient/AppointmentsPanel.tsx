import { useState } from 'react';
import type { Appointment, QueueEntry } from '../../api.ts';
import type { PatientStrings } from '../../i18n/patientTranslations.ts';
import { dateParts, formatDate } from './careMath.ts';

interface AppointmentsPanelProps {
  t: PatientStrings;
  appointments: Appointment[];
  queueEntries: QueueEntry[];
  onCancel: (id: string) => Promise<void>;
  onLeaveQueue: (id: string) => Promise<void>;
  onEdit: (appointment: Appointment) => void;
}

function joinedTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

export function AppointmentsPanel({ t, appointments, queueEntries, onCancel, onLeaveQueue, onEdit }: AppointmentsPanelProps) {
  const care = t.care;
  const [busyKey, setBusyKey] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const upcoming = appointments.filter((appointment) => appointment.status === 'booked');
  const cancelled = appointments.filter((appointment) => appointment.status === 'cancelled');

  async function run(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setActionError(undefined);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : care.actionFailed);
    } finally {
      setBusyKey(undefined);
    }
  }

  return (
    <div className="nv-care-stack">
      <section className="nv-care-block" aria-label={care.upcomingList}>
        <h2 className="section-title">{care.upcomingList}</h2>
        {upcoming.length === 0 ? <div className="card nv-empty">{care.noUpcoming}</div> : (
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
                  </div>
                  <div className="nv-appt-actions">
                    <button type="button" className="secondary-btn" onClick={() => onEdit(appointment)}>{t.reschedule}</button>
                    <button
                      type="button"
                      className="ghost-btn nv-danger"
                      disabled={busyKey === `cancel:${appointment.id}`}
                      onClick={() => void run(`cancel:${appointment.id}`, () => onCancel(appointment.id))}
                    >
                      {care.cancel}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {queueEntries.length > 0 ? (
        <section className="nv-care-block" aria-label={care.queueToday}>
          <h2 className="section-title">{care.queueToday}</h2>
          <ul className="nv-appt-list">
            {queueEntries.map((entry) => (
              <li className="card nv-appt" key={entry.id}>
                <div className="nv-appt-date nv-queue-pos" aria-hidden="true"><strong>{entry.position}</strong><span>{care.queuePosition}</span></div>
                <div className="nv-appt-body">
                  <h3>{entry.hospitalName}</h3>
                  <p className="muted small">{entry.serviceName} · {care.estWait} ±{entry.estimatedWaitMinutes} min · {joinedTime(entry.joinedAt)}</p>
                  <p className="muted small">{entry.address}</p>
                </div>
                <div className="nv-appt-actions">
                  <span className={`badge ${entry.status === 'called' ? 'green' : 'blue'}`}>{entry.status === 'called' ? care.statusCalled : care.statusWaiting}</span>
                  <button
                    type="button"
                    className="ghost-btn nv-danger"
                    disabled={busyKey === `queue:${entry.id}`}
                    onClick={() => void run(`queue:${entry.id}`, () => onLeaveQueue(entry.id))}
                  >
                    {care.leaveQueue}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cancelled.length > 0 ? (
        <section className="nv-care-block" aria-label={care.cancelledList}>
          <h2 className="section-title">{care.cancelledList}</h2>
          <ul className="nv-appt-list">
            {cancelled.map((appointment) => (
              <li className="card nv-appt nv-appt-cancelled" key={appointment.id}>
                <div className="nv-appt-body">
                  <h3>{appointment.hospitalName}</h3>
                  <p className="muted small">{appointment.serviceName} · {formatDate(appointment.date)} · {appointment.time}</p>
                </div>
                <div className="nv-appt-actions">
                  <button type="button" className="secondary-btn" onClick={() => onEdit(appointment)}>{care.rebook}</button>
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
