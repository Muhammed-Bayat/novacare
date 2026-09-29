import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useState } from 'react';
import { authenticatedRequest, type LocationCandidate, type ServiceRequestRow } from '../../api.ts';

export interface ServiceRequestInput {
  type: 'AMBULANCE' | 'HOME_VISIT';
  urgency: 'EMERGENCY' | 'URGENT' | 'STANDARD';
  triage: Record<string, string>;
  address?: string;
  latitude?: number;
  longitude?: number;
  locationCandidateId?: string;
  locationReview?: boolean;
}

export interface LocationResolution {
  status: 'confirmation_required' | 'unresolved';
  candidates: LocationCandidate[];
}

export interface ServiceRequestData {
  requests: ServiceRequestRow[];
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  createServiceRequest: (input: ServiceRequestInput) => Promise<ServiceRequestRow>;
  resolveLocation: (address: string) => Promise<LocationResolution>;
  confirmLocation: (candidateId: string) => Promise<LocationCandidate>;
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

  const resolveLocation = useCallback(async (address: string) => {
    const token = await getAccessTokenSilently();
    return authenticatedRequest<LocationResolution>('/api/v1/locations/resolve', token, { method: 'POST', body: { address } });
  }, [getAccessTokenSilently]);

  const confirmLocation = useCallback(async (candidateId: string) => {
    const token = await getAccessTokenSilently();
    const result = await authenticatedRequest<{ status: 'confirmed'; candidate: LocationCandidate }>('/api/v1/locations/confirm', token, { method: 'POST', body: { candidateId } });
    return result.candidate;
  }, [getAccessTokenSilently]);

  return { requests, loading, error, refresh, createServiceRequest, resolveLocation, confirmLocation };
}
