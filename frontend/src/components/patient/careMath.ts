export const BOOKING_START = '07:00';
export const BOOKING_END = '19:00';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function formatDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(parsed);
}

export function dateParts(value: string): { weekday: string; day: string; month: string } {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.valueOf())) return { weekday: '', day: value, month: '' };
  const formatter = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-ZA', options).format(parsed);
  return { weekday: formatter({ weekday: 'short' }), day: formatter({ day: 'numeric' }), month: formatter({ month: 'short' }) };
}

export function distanceInKm(from: Coordinates, to: Coordinates): number {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const latitudeDifference = radians(to.latitude - from.latitude);
  const longitudeDifference = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDifference / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDifference / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
