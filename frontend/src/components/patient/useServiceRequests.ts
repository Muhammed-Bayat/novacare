import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useState } from 'react';
import { authenticatedRequest, type ServiceRequestRow } from '../../api.ts';

export interface ServiceRequestInput {
  type: 'AMBULANCE' | 'HOME_VISIT';
  urgency: 'EMERGENCY' | 'URGENT' | 'STANDARD';
  triage: Record<string, string>;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface ServiceRequestData {
  requests: ServiceRequestRow[];
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  createServiceRequest: (input: ServiceRequestInput) => Promise<ServiceRequestRow>;
}

export function useServiceRequests(): ServiceRequestData {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();
  const [requests, setRequests] = useState<ServiceRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: ServiceRequestRow[] }>('/api/v1/service-requests', token);
      setRequests(Array.isArray(result.data) ? result.data : []);
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your requests.');
    }
  }, [isAuthenticated, getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, refresh]);

  const createServiceRequest = useCallback(async (input: ServiceRequestInput) => {
    const token = await getAccessTokenSilently();
    const result = await authenticatedRequest<{ data: ServiceRequestRow }>('/api/v1/service-requests', token, { method: 'POST', body: input });
    await refresh();
    return result.data;
  }, [getAccessTokenSilently, refresh]);

  return { requests, loading, error, refresh, createServiceRequest };
}
