import { useAuth0 } from '@auth0/auth0-react';
import { useCallback, useEffect, useState } from 'react';
import { authenticatedRequest, type Appointment, type Hospital, type QueueEntry } from '../../api.ts';

export interface PatientCareData {
  hospitals: Hospital[];
  appointments: Appointment[];
  queueEntries: QueueEntry[];
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  cancelAppointment: (id: string) => Promise<void>;
  createAppointment: (input: { hospitalId: string; serviceId: string; date: string; time: string }) => Promise<void>;
  updateAppointment: (id: string, input: { serviceId: string; date: string; time: string }) => Promise<void>;
  rebookAppointment: (id: string, input: { serviceId: string; date: string; time: string }) => Promise<void>;
  joinQueue: (input: { hospitalId: string; serviceId: string }) => Promise<void>;
  leaveQueue: (id: string) => Promise<void>;
}

export function usePatientCare(): PatientCareData {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(undefined);
    try {
      const token = await getAccessTokenSilently();
      const [hospitalResult, appointmentResult, queueResult] = await Promise.all([
        authenticatedRequest<{ data: Hospital[] }>('/api/v1/hospitals', token),
        authenticatedRequest<{ data: Appointment[] }>('/api/v1/appointments', token),
        authenticatedRequest<{ data: QueueEntry[] }>('/api/v1/queue', token),
      ]);
      setHospitals(hospitalResult.data);
      setAppointments(appointmentResult.data);
      setQueueEntries(queueResult.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your care information.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, getAccessTokenSilently]);

  useEffect(() => {
    if (isAuthenticated) void refresh();
  }, [isAuthenticated, refresh]);

  const cancelAppointment = useCallback(async (id: string) => {
    const token = await getAccessTokenSilently();
    await authenticatedRequest(`/api/v1/appointments/${id}`, token, { method: 'DELETE' });
    await refresh();
  }, [getAccessTokenSilently, refresh]);

  const createAppointment = useCallback(async (input: { hospitalId: string; serviceId: string; date: string; time: string }) => {
    const token = await getAccessTokenSilently();
    await authenticatedRequest('/api/v1/appointments', token, { method: 'POST', body: input });
    await refresh();
  }, [getAccessTokenSilently, refresh]);

  const updateAppointment = useCallback(async (id: string, input: { serviceId: string; date: string; time: string }) => {
    const token = await getAccessTokenSilently();
    await authenticatedRequest(`/api/v1/appointments/${id}`, token, { method: 'PATCH', body: input });
    await refresh();
  }, [getAccessTokenSilently, refresh]);

  const rebookAppointment = useCallback(async (id: string, input: { serviceId: string; date: string; time: string }) => {
    const token = await getAccessTokenSilently();
    await authenticatedRequest(`/api/v1/appointments/${id}/rebook`, token, { method: 'POST', body: input });
    await refresh();
  }, [getAccessTokenSilently, refresh]);

  const joinQueue = useCallback(async (input: { hospitalId: string; serviceId: string }) => {
    const token = await getAccessTokenSilently();
    await authenticatedRequest('/api/v1/queue', token, { method: 'POST', body: input });
    await refresh();
  }, [getAccessTokenSilently, refresh]);

  const leaveQueue = useCallback(async (id: string) => {
    const token = await getAccessTokenSilently();
    await authenticatedRequest(`/api/v1/queue/${id}`, token, { method: 'DELETE' });
    await refresh();
  }, [getAccessTokenSilently, refresh]);

  return {
    hospitals,
    appointments,
    queueEntries,
    loading,
    error,
    refresh,
    cancelAppointment,
    createAppointment,
    updateAppointment,
    rebookAppointment,
    joinQueue,
    leaveQueue,
  };
}
