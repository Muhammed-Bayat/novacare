import type { Hospital, QuestionnaireUrgency } from '../../api.ts';
import type { Coordinates } from './careMath.ts';

export function urgencyText(urgency: QuestionnaireUrgency) {
  switch (urgency) {
    case 'emergency': return { label: 'Emergency assessment', detail: 'Warning signs were reported, so urgent in-person assessment is recommended.' };
    case 'urgent': return { label: 'Urgent', detail: 'Your answers suggest prompt clinical review is a safer next step.' };
    case 'priority': return { label: 'Priority', detail: 'Your answers should be reviewed before routine visits where possible.' };
    default: return { label: 'Routine', detail: 'Your answers appear suitable for a standard booking pathway in this service.' };
  }
}

export function serviceKeywords(pathwayName: string, department: string): string[] {
  const text = `${pathwayName} ${department}`.toLowerCase();
  if (text.includes('emergency') || text.includes('chest') || text.includes('breathing')) return ['emergency', 'trauma', 'cardiology', 'general'];
  if (text.includes('ortho') || text.includes('injury') || text.includes('musculoskeletal')) return ['orthopaedic', 'orthopedic', 'injury', 'trauma', 'general'];
  if (text.includes('abdominal')) return ['general', 'surgery', 'gastro', 'emergency'];
  if (text.includes('headache') || text.includes('neuro')) return ['general', 'neurology', 'emergency'];
  return ['general', 'family', 'outpatient', 'emergency'];
}

export function readUserLocation(): Promise<Coordinates | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

export function matchingServices(hospital: Hospital, pathwayName: string, department: string): Hospital['services'] {
  const keywords = serviceKeywords(pathwayName, department);
  const services = hospital.services.filter((service) => {
    const name = service.name.toLowerCase();
    return keywords.some((keyword) => name.includes(keyword));
  });
  return (services.length > 0 ? services : hospital.services).slice(0, 3);
}
