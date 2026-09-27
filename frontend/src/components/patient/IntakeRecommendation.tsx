import { useEffect, useState } from 'react';
import type { AppointmentTriageSummary, Hospital, QuestionnaireUrgency } from '../../api.ts';
import { distanceInKm, type Coordinates } from './careMath.ts';
import { matchingServices, readUserLocation, serviceKeywords, urgencyText } from './intakeShared.ts';

export function IntakeRecommendation({
  hospitals,
  pathwayName,
  source,
  urgency,
  department,
  reason,
  redFlags,
  onBookAppointment,
  onRestart,
}: {
  hospitals: Hospital[];
  pathwayName: string;
  source: 'gemini' | 'local';
  urgency: QuestionnaireUrgency;
  department: string;
  reason: string;
  redFlags: string[];
  onBookAppointment: (input: { hospitalId?: string; serviceId?: string; triageSummary: AppointmentTriageSummary }) => void;
  onRestart: () => void;
}) {
  const [userLocation, setUserLocation] = useState<Coordinates>();
  const [locationState, setLocationState] = useState<'locating' | 'ready' | 'unavailable'>('locating');

  useEffect(() => {
    if (userLocation) return;
    let cancelled = false;
    setLocationState('locating');
    void readUserLocation().then((location) => {
      if (cancelled) return;
      if (location) {
        setUserLocation(location);
        setLocationState('ready');
      } else {
        setLocationState('unavailable');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userLocation]);

  function locateMe() {
    setLocationState('locating');
    void readUserLocation().then((location) => {
      if (location) {
        setUserLocation(location);
        setLocationState('ready');
      } else {
        setLocationState('unavailable');
      }
    });
  }

  const keywords = serviceKeywords(pathwayName, department);
  const matches = hospitals.filter((hospital) => hospital.services.some((service) => {
    const name = service.name.toLowerCase();
    return keywords.some((keyword) => name.includes(keyword));
  }));
  const pool = matches.length > 0 ? matches : hospitals;
  const queueLength = (hospital: Hospital) => matchingServices(hospital, pathwayName, department)[0]?.waitingCount ?? 0;
  const recommendations = !userLocation
    ? [...pool].sort((left, right) => queueLength(left) - queueLength(right) || left.name.localeCompare(right.name)).slice(0, 3)
    : pool
      .map((hospital) => ({ hospital, distance: distanceInKm(userLocation, hospital), waiting: queueLength(hospital) }))
      // Each waiting patient counts like ~0.5 km so a slightly farther but much emptier hospital can win.
      .sort((left, right) => (left.distance + left.waiting * 0.5) - (right.distance + right.waiting * 0.5))
      .slice(0, 3)
      .map((entry) => entry.hospital);
  const resultSummary: AppointmentTriageSummary = { urgency, pathwayName, department, summary: reason, redFlags };

  return (
    <div className="nv-questionnaire-result">
      <p className="eyebrow">Recommended next step</p>
      <h2>{department}</h2>
      <p className="muted">{reason}</p>
      {source === 'local' ? (
        <p className="nv-notice" role="status">The AI assistant is briefly unavailable, so this is a conservative assessment from your message alone. A nurse reviews everything before you are placed in a queue.</p>
      ) : null}
      <div className={`nv-urgency-card urgency-${urgency}`}>
        <strong>{urgencyText(urgency).label}</strong>
        <span>{urgencyText(urgency).detail}</span>
      </div>
      {redFlags.length > 0 ? (
        <div className="nv-red-flags">
          <strong>Warning signs reported</strong>
          {redFlags.map((flag) => <span key={flag}>{flag}</span>)}
        </div>
      ) : null}
      <div className="nv-questionnaire-summary">
        <span>AI intake source: {source === 'gemini' ? 'Gemini' : 'Local fallback'}</span>
        <span>Pathway: {pathwayName}</span>
      </div>
      <div className="nv-recommended-care">
        <div className="nv-recommended-head">
          <div>
            <strong>{userLocation ? 'Nearest hospitals for this service' : 'Recommended hospitals for this service'}</strong>
            <p className="muted small">
              {locationState === 'locating' && !userLocation
                ? 'Locating you to rank the closest facilities.'
                : userLocation
                  ? 'Ranked by distance and queue length from your location.'
                  : 'These facilities have services that best match the assessment.'}
            </p>
          </div>
          {locationState === 'unavailable' && !userLocation ? (
            <button className="secondary-btn" type="button" onClick={locateMe}>Use my location</button>
          ) : null}
        </div>
        {recommendations.length > 0 ? (
          <div className="nv-recommended-list">
            {recommendations.map((hospital) => {
              const services = matchingServices(hospital, pathwayName, department);
              const selectedService = services[0];
              const distance = userLocation ? distanceInKm(userLocation, hospital) : undefined;
              const waiting = selectedService?.waitingCount ?? 0;
              return (
                <article className="nv-recommended-hospital" key={hospital.id}>
                  <div>
                    <strong>{hospital.name}</strong>
                    <span>{hospital.address}</span>
                    <span className="nv-distance">{distance !== undefined ? `${distance.toFixed(1)} km away · ` : ''}{waiting} in queue</span>
                  </div>
                  <div className="nv-service-tags">
                    {services.map((service) => <span className="nv-tag" key={`${hospital.id}-${service.id}`}>{service.name}</span>)}
                  </div>
                  {selectedService ? (
                    <button className="secondary-btn" type="button" onClick={() => onBookAppointment({ hospitalId: hospital.id, serviceId: selectedService.id, triageSummary: resultSummary })}>Book here</button>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="muted">No hospital service data is loaded yet. Open booking to refresh available facilities.</p>
        )}
      </div>
      <div className="nv-questionnaire-actions">
        <button className="primary-btn" type="button" onClick={() => onBookAppointment({ triageSummary: resultSummary })}>Book at a recommended hospital</button>
        <button className="secondary-btn" type="button" onClick={onRestart}>Start again</button>
      </div>
    </div>
  );
}
