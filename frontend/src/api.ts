const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export interface CurrentUser {
  id: string;
  auth0Subject: string;
  email: string | null;
  displayName: string | null;
}

export async function authenticatedRequest<T>(
  path: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const message = isErrorPayload(payload) ? payload.error.message : 'Request failed';
    throw new Error(message);
  }

  return payload as T;
}

function isErrorPayload(payload: unknown): payload is { error: { message: string } } {
  return typeof payload === 'object' && payload !== null &&
    'error' in payload && typeof payload.error === 'object' && payload.error !== null &&
    'message' in payload.error && typeof payload.error.message === 'string';
}
