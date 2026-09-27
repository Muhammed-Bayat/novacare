import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicGet, type DisplayData } from '../api.ts';
import '../styles/display.css';

const categoryColors: Record<string, string> = {
  emergency: '#ff5a5a',
  urgent: '#ff9f43',
  priority: '#f7b731',
  routine: '#25b36b',
};

export function DisplayPage() {
  const { token } = useParams<{ token: string }>();
  const [display, setDisplay] = useState<DisplayData>();
  const [error, setError] = useState<string>();
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await publicGet<{ data: DisplayData }>(`/api/v1/display/${token}`);
        if (!cancelled) { setDisplay(result.data); setError(undefined); }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load the waiting room display.');
      }
    }
    void load();
    const dataTimer = window.setInterval(() => void load(), 10000);
    const clockTimer = window.setInterval(() => setClock(new Date()), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(dataTimer);
      window.clearInterval(clockTimer);
    };
  }, [token]);

  return (
    <main className="nv-display">
      <header className="nv-display-head">
        <div>
          <p className="nv-display-eyebrow">NovaCare live waiting room</p>
          <h1>{display?.hospitalName ?? 'NovaCare hospital'}</h1>
        </div>
        <div className="nv-display-clock">
          {new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(clock)}
          <span>Queue updates automatically</span>
        </div>
      </header>
      {error ? <p className="nv-display-error" role="alert">{error}</p> : null}
      {!display && !error ? <p className="nv-display-note">Loading today&apos;s queues…</p> : null}
      {display && display.services.length === 0 ? <p className="nv-display-note">No queues are running yet today.</p> : null}
      <section className="nv-display-grid">
        {display?.services.map((service) => (
          <article className="nv-display-card" key={service.serviceName}>
            <h2>{service.serviceName}</h2>
            <div className="nv-display-serving">
              <span>Now serving</span>
              <strong>{service.nowServing !== null ? `#${service.nowServing}` : '—'}</strong>
            </div>
            {service.awaitingTriage > 0 ? <p className="nv-display-note">{service.awaitingTriage} patient{service.awaitingTriage === 1 ? '' : 's'} awaiting nurse review</p> : null}
            <div className="nv-display-tickets">
              {service.waiting.length === 0 ? (
                <span className="nv-display-ticket empty">No one waiting</span>
              ) : (
                service.waiting.map((ticket) => (
                  <span
                    key={ticket.ticket}
                    className="nv-display-ticket"
                    style={{ borderColor: categoryColors[ticket.category ?? 'routine'] ?? categoryColors.routine }}
                  >
                    #{ticket.ticket}
                  </span>
                ))
              )}
            </div>
          </article>
        ))}
      </section>
      <footer className="nv-display-foot">Tickets are anonymous — no patient names or details are shown on this screen.</footer>
    </main>
  );
}
