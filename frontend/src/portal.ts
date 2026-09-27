import type { CurrentUser } from './api.ts';

export function getPortalPath(user: CurrentUser): string {
  if (user.isPlatformOperator) return '/overseer';
  if (user.staffRole === 'administrator') return '/admin';
  if (user.staffRole === 'dispatcher') return '/dispatcher';
  if (user.staffRole === 'nurse') return '/staff';
  if (user.staffRole === 'doctor') return '/doctor';
  return '/patient';
}
