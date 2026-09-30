import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { authenticatedRequest, type AdminDepartment, type AdminOverview, type AuditEvent, type CurrentUser, type Department, type DisplaySettings, type HospitalDepartments, type HospitalTeam, type HospitalTeamMember, type AppointmentSlot, type SlotCreateResult, type TeamRole } from '../api.ts';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';

const roleLabels: Record<TeamRole, string> = {
  administrator: 'Administrator',
  nurse: 'Nurse',
  doctor: 'Doctor',
  dispatcher: 'Dispatcher',
};

const auditLabels: Record<string, string> = {
  'staff_invitation.created': 'Invitation created',
  'staff_invitation.claimed': 'Invitation claimed',
  'appointment_slots.created': 'Slots created',
  'appointment_slots.deleted': 'Slot removed',
  'department.created': 'Department created',
  'department.updated': 'Department updated',
  'department.deleted': 'Department removed',
  'hospital_membership.updated': 'Team member updated',
  'hospital_display.rotated': 'Display link regenerated',
  'hospital_display.activated': 'Waiting-room display turned on',
  'hospital_display.deactivated': 'Waiting-room display turned off',
  TRIAGE_CONFIRMED: 'Triage confirmed',
  QUEUE_ENTRY_CALLED: 'Patient called',
  CONSULTATION_STARTED: 'Consultation started',
  CONSULTATION_COMPLETED: 'Diagnosis recorded and consultation completed',
  QUEUE_ENTRY_REFERRED: 'Patient referred',
  QUEUE_ENTRY_CANCELLED: 'Queue entry cancelled',
};

function auditDetail(event: AuditEvent): string {
  const metadata = event.metadata;
  const parts: string[] = [];
  if (typeof metadata.email === 'string') parts.push(metadata.email);
  if (typeof metadata.role === 'string') parts.push(metadata.role);
  else if (metadata.role && typeof metadata.role === 'object') {
    const change = metadata.role as { from?: unknown; to?: unknown };
    if (typeof change.from === 'string' && typeof change.to === 'string') parts.push(`${change.from} → ${change.to}`);
  }
  if (typeof metadata.active === 'object' && metadata.active !== null) {
    const change = metadata.active as { from?: unknown; to?: unknown };
    if (change.from !== change.to) parts.push(change.to === true ? 'reactivated' : 'deactivated');
  }
  if (typeof metadata.name === 'string') parts.push(metadata.name);
  if (typeof metadata.departmentName === 'string') parts.push(metadata.departmentName);
  if (typeof metadata.created === 'number') parts.push(`${metadata.created} slots`);
  if (typeof metadata.date === 'string') parts.push(metadata.date);
  if (typeof metadata.category === 'string') parts.push(metadata.category);
  if (typeof metadata.reason === 'string') parts.push(metadata.reason);
  return parts.join(' · ');
}

function formatEventTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return '';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function formatMemberDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '' : new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(parsed);
}

function tomorrowDate(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

type AdminTab = 'overview' | 'team' | 'schedule' | 'departments' | 'display' | 'activity';

interface SlotFormState {
  departmentId: string;
  date: string;
  startTime: string;
  endTime: string;
  slotMinutes: string;
  capacity: string;
}

interface DepartmentFormState {
  id?: string;
  name: string;
  averageConsultationMinutes: string;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function AdminPortalPage() {
  const { isAuthenticated, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();
  const [access, setAccess] = useState<CurrentUser>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<AdminTab>('overview');

  const [team, setTeam] = useState<HospitalTeam>();
  const [teamError, setTeamError] = useState<string>();
  const [teamMessage, setTeamMessage] = useState<string>();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('nurse');
  const [inviteDepartmentIds, setInviteDepartmentIds] = useState<string[]>([]);
  const [inviteMessage, setInviteMessage] = useState<string>();
  const [inviteClaimUrl, setInviteClaimUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string>();
  const [inviting, setInviting] = useState(false);

  const [managingMemberId, setManagingMemberId] = useState<string>();
  const [manageRole, setManageRole] = useState<TeamRole>('nurse');
  const [manageActive, setManageActive] = useState(true);
  const [manageDepartmentIds, setManageDepartmentIds] = useState<string[]>([]);
  const [manageError, setManageError] = useState<string>();
  const [manageMessage, setManageMessage] = useState<string>();
  const [managing, setManaging] = useState(false);

  const [departments, setDepartments] = useState<Department[]>();
  const [slots, setSlots] = useState<AppointmentSlot[]>();
  const [scheduleError, setScheduleError] = useState<string>();
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [slotForm, setSlotForm] = useState<SlotFormState>({ departmentId: '', date: tomorrowDate(), startTime: '09:00', endTime: '12:00', slotMinutes: '15', capacity: '3' });
  const [slotError, setSlotError] = useState<string>();
  const [slotMessage, setSlotMessage] = useState<string>();
  const [creatingSlots, setCreatingSlots] = useState(false);
  const [deletingSlotId, setDeletingSlotId] = useState<string>();

  const [adminDepartments, setAdminDepartments] = useState<AdminDepartment[]>();
  const [adminDepartmentsError, setAdminDepartmentsError] = useState<string>();
  const [departmentForm, setDepartmentForm] = useState<DepartmentFormState>({ name: '', averageConsultationMinutes: '15' });
  const [departmentError, setDepartmentError] = useState<string>();
  const [departmentMessage, setDepartmentMessage] = useState<string>();
  const [savingDepartment, setSavingDepartment] = useState(false);
  const [deletingDepartmentId, setDeletingDepartmentId] = useState<string>();

  const [display, setDisplay] = useState<DisplaySettings>();
  const [displayError, setDisplayError] = useState<string>();
  const [displayMessage, setDisplayMessage] = useState<string>();
  const [displayBusy, setDisplayBusy] = useState(false);

  const [overview, setOverview] = useState<AdminOverview>();
  const [overviewError, setOverviewError] = useState<string>();

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>();
  const [auditError, setAuditError] = useState<string>();

  useEffect(() => {
    if (!isAuthenticated) { setAccess(undefined); setError(undefined); setTeam(undefined); return; }
    let cancelled = false;
    async function load() {
      try {
        const token = await getAccessTokenSilently();
        const [me, teamResult] = await Promise.all([
          authenticatedRequest<{ data: CurrentUser }>('/api/v1/me', token),
          authenticatedRequest<{ data: HospitalTeam }>('/api/v1/admin/staff', token),
        ]);
        if (cancelled) return;
        setAccess(me.data);
        setTeam(teamResult.data);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load administrator access.');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [isAuthenticated, getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated || tab !== 'overview') return;
    let cancelled = false;
    async function loadOverview() {
      try {
        const token = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: AdminOverview }>('/api/v1/admin/overview', token);
        if (!cancelled) { setOverview(result.data); setOverviewError(undefined); }
      } catch (loadError) {
        if (!cancelled) setOverviewError(loadError instanceof Error ? loadError.message : 'Could not load today\'s operations.');
      }
    }
    void loadOverview();
    return () => { cancelled = true; };
  }, [isAuthenticated, tab, getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated || tab !== 'schedule') return;
    let cancelled = false;
    async function loadSchedule() {
      if (!cancelled) setScheduleLoading(true);
      try {
        const token = await getAccessTokenSilently();
        const [departmentResult, slotResult] = await Promise.all([
          authenticatedRequest<{ data: HospitalDepartments }>('/api/v1/departments', token),
          authenticatedRequest<{ data: AppointmentSlot[] }>('/api/v1/admin/slots', token),
        ]);
        if (cancelled) return;
        setDepartments(departmentResult.data.departments);
        setSlots(slotResult.data);
        setScheduleError(undefined);
        setSlotForm((previous) => previous.departmentId ? previous : { ...previous, departmentId: departmentResult.data.departments[0]?.id ?? '' });
      } catch (loadError) {
        if (!cancelled) setScheduleError(loadError instanceof Error ? loadError.message : 'Could not load the schedule.');
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    }
    void loadSchedule();
    return () => { cancelled = true; };
  }, [isAuthenticated, tab, getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated || (tab !== 'team' && tab !== 'departments')) return;
    let cancelled = false;
    async function loadDepartments() {
      try {
        const token = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: AdminDepartment[] }>('/api/v1/admin/departments', token);
        if (!cancelled) { setAdminDepartments(result.data); setAdminDepartmentsError(undefined); }
      } catch (loadError) {
        if (!cancelled) setAdminDepartmentsError(loadError instanceof Error ? loadError.message : 'Could not load departments.');
      }
    }
    void loadDepartments();
    return () => { cancelled = true; };
  }, [isAuthenticated, tab, getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated || tab !== 'display') return;
    let cancelled = false;
    async function loadDisplay() {
      try {
        const token = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: DisplaySettings }>('/api/v1/admin/display', token);
        if (!cancelled) { setDisplay(result.data); setDisplayError(undefined); }
      } catch (loadError) {
        if (!cancelled) setDisplayError(loadError instanceof Error ? loadError.message : 'Could not load the display settings.');
      }
    }
    void loadDisplay();
    return () => { cancelled = true; };
  }, [isAuthenticated, tab, getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated || tab !== 'activity') return;
    let cancelled = false;
    async function loadAudit() {
      try {
        const token = await getAccessTokenSilently();
        const result = await authenticatedRequest<{ data: AuditEvent[] }>('/api/v1/admin/audit', token);
        if (!cancelled) { setAuditEvents(result.data); setAuditError(undefined); }
      } catch (loadError) {
        if (!cancelled) setAuditError(loadError instanceof Error ? loadError.message : 'Could not load the activity log.');
      }
    }
    void loadAudit();
    return () => { cancelled = true; };
  }, [isAuthenticated, tab, getAccessTokenSilently]);

  if (isAuthenticated && access && access.staffRole !== 'administrator') return <Navigate to="/" replace />;

  async function refreshTeam() {
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: HospitalTeam }>('/api/v1/admin/staff', token);
      setTeam(result.data);
      setTeamError(undefined);
    } catch (refreshError) {
      setTeamError(refreshError instanceof Error ? refreshError.message : 'Could not refresh the team list.');
    }
  }

  async function refreshAdminDepartments() {
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: AdminDepartment[] }>('/api/v1/admin/departments', token);
      setAdminDepartments(result.data);
      setAdminDepartmentsError(undefined);
    } catch (refreshError) {
      setAdminDepartmentsError(refreshError instanceof Error ? refreshError.message : 'Could not refresh departments.');
    }
  }

  async function refreshSlots() {
    const token = await getAccessTokenSilently();
    const result = await authenticatedRequest<{ data: AppointmentSlot[] }>('/api/v1/admin/slots', token);
    setSlots(result.data);
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true); setInviteError(undefined); setInviteMessage(undefined); setInviteClaimUrl(undefined); setCopied(false);
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: { message: string; claimUrl: string } }>('/api/v1/admin/staff', token, {
        method: 'POST',
        body: { email: inviteEmail, role: inviteRole, departmentIds: inviteRole === 'administrator' || inviteRole === 'dispatcher' ? [] : inviteDepartmentIds },
      });
      setInviteMessage(result.data.message);
      setInviteClaimUrl(result.data.claimUrl);
      setInviteEmail('');
      setInviteDepartmentIds([]);
      await refreshTeam();
    } catch (inviteFailure) {
      setInviteError(inviteFailure instanceof Error ? inviteFailure.message : 'Could not create invitation.');
    } finally {
      setInviting(false);
    }
  }

  function startManaging(member: HospitalTeamMember) {
    setManagingMemberId(member.membershipId);
    setManageRole(member.role);
    setManageActive(member.active);
    setManageDepartmentIds(member.departments.map((department) => department.id));
    setManageError(undefined);
    setManageMessage(undefined);
    setTeamMessage(undefined);
  }

  async function updateMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!managingMemberId) return;
    setManaging(true); setManageError(undefined); setManageMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest<{ data: { membershipId: string } }>(`/api/v1/admin/staff/${managingMemberId}`, token, {
        method: 'PATCH',
        body: {
          role: manageRole,
          active: manageActive,
          ...(manageRole !== 'administrator' && manageRole !== 'dispatcher' ? { departmentIds: manageDepartmentIds } : { departmentIds: [] }),
        },
      });
      setManageMessage('Team member updated.');
      await refreshTeam();
    } catch (manageFailure) {
      setManageError(manageFailure instanceof Error ? manageFailure.message : 'Could not update that team member.');
    } finally {
      setManaging(false);
    }
  }

  async function createOrUpdateDepartment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingDepartment(true); setDepartmentError(undefined); setDepartmentMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      const body = { name: departmentForm.name, averageConsultationMinutes: Number(departmentForm.averageConsultationMinutes) };
      if (departmentForm.id) {
        await authenticatedRequest<{ data: AdminDepartment }>(`/api/v1/admin/departments/${departmentForm.id}`, token, { method: 'PATCH', body });
        setDepartmentMessage('Department updated.');
      } else {
        const result = await authenticatedRequest<{ data: AdminDepartment }>('/api/v1/admin/departments', token, { method: 'POST', body });
        setDepartmentMessage(`Department "${result.data.name}" created.`);
      }
      setDepartmentForm({ name: '', averageConsultationMinutes: '15' });
      await refreshAdminDepartments();
    } catch (saveFailure) {
      setDepartmentError(saveFailure instanceof Error ? saveFailure.message : 'Could not save the department.');
    } finally {
      setSavingDepartment(false);
    }
  }

  async function toggleDepartment(department: AdminDepartment) {
    setDepartmentError(undefined); setDepartmentMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest<{ data: AdminDepartment }>(`/api/v1/admin/departments/${department.id}`, token, { method: 'PATCH', body: { active: !department.active } });
      setDepartmentMessage(department.active ? `"${department.name}" deactivated.` : `"${department.name}" reactivated.`);
      if (departmentForm.id === department.id) setDepartmentForm({ name: '', averageConsultationMinutes: '15' });
      await refreshAdminDepartments();
    } catch (toggleFailure) {
      setDepartmentError(toggleFailure instanceof Error ? toggleFailure.message : 'Could not update the department.');
    }
  }

  async function removeDepartment(department: AdminDepartment) {
    setDeletingDepartmentId(department.id); setDepartmentError(undefined); setDepartmentMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest<void>(`/api/v1/admin/departments/${department.id}`, token, { method: 'DELETE' });
      setDepartmentMessage(`"${department.name}" removed.`);
      if (departmentForm.id === department.id) setDepartmentForm({ name: '', averageConsultationMinutes: '15' });
      await refreshAdminDepartments();
    } catch (removeFailure) {
      setDepartmentError(removeFailure instanceof Error ? removeFailure.message : 'Could not remove the department.');
    } finally {
      setDeletingDepartmentId(undefined);
    }
  }

  async function rotateDisplay() {
    setDisplayBusy(true); setDisplayError(undefined); setDisplayMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: DisplaySettings }>('/api/v1/admin/display/rotate', token, { method: 'POST' });
      setDisplay(result.data);
      setDisplayMessage('New display link generated — the previous link no longer works.');
    } catch (rotateFailure) {
      setDisplayError(rotateFailure instanceof Error ? rotateFailure.message : 'Could not generate a display link.');
    } finally {
      setDisplayBusy(false);
    }
  }

  async function setDisplayActive(active: boolean) {
    setDisplayBusy(true); setDisplayError(undefined); setDisplayMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: DisplaySettings }>('/api/v1/admin/display', token, { method: 'PATCH', body: { active } });
      setDisplay((previous) => ({ token: previous?.token ?? null, active: result.data.active }));
      setDisplayMessage(active ? 'Waiting-room display is on.' : 'Waiting-room display is off.');
    } catch (settingFailure) {
      setDisplayError(settingFailure instanceof Error ? settingFailure.message : 'Could not update the display setting.');
    } finally {
      setDisplayBusy(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function copyClaimLink() {
    if (!inviteClaimUrl) return;
    await copyText(inviteClaimUrl);
  }

  async function createSlots(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingSlots(true); setSlotError(undefined); setSlotMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      const result = await authenticatedRequest<{ data: SlotCreateResult }>('/api/v1/admin/slots', token, {
        method: 'POST',
        body: {
          departmentId: slotForm.departmentId,
          date: slotForm.date,
          startTime: slotForm.startTime,
          endTime: slotForm.endTime,
          slotMinutes: Number(slotForm.slotMinutes),
          capacity: Number(slotForm.capacity),
        },
      });
      setSlotMessage(`Created ${result.data.created} slots for ${result.data.departmentName} on ${result.data.date}.`);
      await refreshSlots();
    } catch (slotFailure) {
      setSlotError(slotFailure instanceof Error ? slotFailure.message : 'Could not create slots.');
    } finally {
      setCreatingSlots(false);
    }
  }

  async function deleteSlot(slotId: string) {
    setDeletingSlotId(slotId); setSlotError(undefined); setSlotMessage(undefined);
    try {
      const token = await getAccessTokenSilently();
      await authenticatedRequest<void>(`/api/v1/admin/slots/${slotId}`, token, { method: 'DELETE' });
      setSlotMessage('Slot removed.');
      await refreshSlots();
    } catch (slotFailure) {
      setSlotError(slotFailure instanceof Error ? slotFailure.message : 'Could not remove that slot.');
    } finally {
      setDeletingSlotId(undefined);
    }
  }

  const adminName = access?.displayName ?? 'Admin';
  const hospitalName = team?.hospitalName ?? access?.hospitalName ?? 'your hospital';
  const displayInitial = adminName.trim().slice(0, 1).toUpperCase() || 'N';
  const scheduleSlots = slots ?? [];
  const assignableDepartments = (adminDepartments ?? []).filter((department) => department.active);
  const managingMember = team?.members.find((member) => member.membershipId === managingMemberId);
  const displayUrl = display?.token ? `${window.location.origin}/display/${display.token}` : null;

  const heroCopy: Record<AdminTab, string> = {
    overview: `A live snapshot of today's appointments, queues, and slot capacity at ${hospitalName}.`,
    team: `Invite administrators, nurses and doctors to ${hospitalName}. Each person claims their invitation by email and lands on their own dashboard.`,
    schedule: `Create appointment slots by department, day, and time for ${hospitalName}. Patients can only book the slots you publish here.`,
    departments: `Manage the departments patients can book and the average consultation time that drives estimated wait times.`,
    display: `Control the anonymized waiting-room display for ${hospitalName}. The screen never shows patient names, contacts, or clinical details.`,
    activity: `An audit trail of staff actions at ${hospitalName} — invitations, schedule changes, department edits, and display settings.`,
  };

  return (
    <div className="app nv-patient nv-admin">
      <TopBar>
        <Brand />
        <TopNav items={[
          { label: 'Overview', active: tab === 'overview', onClick: () => setTab('overview') },
          { label: 'Hospital team', active: tab === 'team', onClick: () => setTab('team') },
          { label: 'Schedule', active: tab === 'schedule', onClick: () => setTab('schedule') },
          { label: 'Departments', active: tab === 'departments', onClick: () => setTab('departments') },
          { label: 'Display', active: tab === 'display', onClick: () => setTab('display') },
          { label: 'Activity', active: tab === 'activity', onClick: () => setTab('activity') },
        ]} />
        <div className="actions">
          <button type="button" className="user-chip">
            <span style={{ fontWeight: 800 }}>{displayInitial}</span> <span>Hi, {adminName}</span>
          </button>
          {isAuthenticated ? (
            <button type="button" className="ghost-btn" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Logout</button>
          ) : (
            <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
          )}
        </div>
      </TopBar>

      <section className="hero-card hero nv-patient-hero">
        <div className="hero-left">
          <div className="hero-copy">
            <p className="eyebrow">{hospitalName} · Admin portal</p>
            <h1>Welcome back, {adminName}</h1>
            <p className="muted">{heroCopy[tab]}</p>
          </div>
        </div>
      </section>

      {!isAuthenticated ? (
        <section className="card nv-care-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--text)' }}>Administrator sign-in required</h3>
            <div className="muted small" style={{ marginTop: 4 }}>Sign in with your assigned administrator email to manage your hospital.</div>
          </div>
          <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Sign in</button>
        </section>
      ) : null}
      {error ? <p className="nv-error" role="alert" style={{ margin: '12px 4px 0' }}>{error}</p> : null}

      <section className="nv-care-view">
        {tab === 'overview' ? (
          <section className="card nv-care-card" aria-label="Operations overview">
            <header className="nv-care-card-head">
              <h2 className="section-title">Today's operations</h2>
              <p className="muted small">{overview ? `Snapshot for ${overview.date} — updated when you open this tab.` : 'Loading today\'s operations…'}</p>
            </header>
            {overviewError ? <p className="nv-error" role="alert">{overviewError}</p> : null}
            {overview ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                  <div className="nv-detail-card" style={{ padding: 14 }}>
                    <span className="muted small">Appointments today</span>
                    <p style={{ margin: '4px 0 0', fontSize: 30, fontWeight: 800 }}>{overview.totals.appointmentsBooked}</p>
                    <span className="muted small">{overview.totals.appointmentsCancelled} cancelled</span>
                  </div>
                  <div className="nv-detail-card" style={{ padding: 14 }}>
                    <span className="muted small">In the queue now</span>
                    <p style={{ margin: '4px 0 0', fontSize: 30, fontWeight: 800 }}>{overview.totals.queueWaiting + overview.totals.queueCalled}</p>
                    <span className="muted small">{overview.totals.queueCalled} called forward</span>
                  </div>
                  <div className="nv-detail-card" style={{ padding: 14 }}>
                    <span className="muted small">Slot capacity today</span>
                    <p style={{ margin: '4px 0 0', fontSize: 30, fontWeight: 800 }}>{overview.totals.reservedToday}/{overview.totals.capacityToday}</p>
                    <span className="muted small">{overview.totals.slotsToday} slots published</span>
                  </div>
                  <div className="nv-detail-card" style={{ padding: 14 }}>
                    <span className="muted small">Team</span>
                    <p style={{ margin: '4px 0 0', fontSize: 30, fontWeight: 800 }}>{overview.totals.activeMembers}</p>
                    <span className="muted small">{overview.totals.pendingInvitations} pending invitations</span>
                  </div>
                </div>
                <div className="nv-access-list" style={{ borderTop: 'none', paddingTop: 0 }}>
                  <strong className="small">By department</strong>
                  {overview.departments.length === 0 ? (
                    <p className="muted small" style={{ margin: 0 }}>No departments yet — add one on the Departments tab.</p>
                  ) : null}
                  {overview.departments.map((department) => (
                    <p key={department.id} className="nv-access-row">
                      <span>
                        {department.name}
                        <small className="muted"> · {department.averageConsultationMinutes} min average</small>
                      </span>
                      <span>
                        <span className="badge blue">{department.reservedToday}/{department.capacityToday} slots</span>{' '}
                        <span className="badge green">{department.appointmentsBooked} booked</span>{' '}
                        <span className={`badge ${department.queueWaiting + department.queueCalled > 0 ? 'yellow' : 'blue'}`}>{department.queueWaiting + department.queueCalled} waiting</span>
                      </span>
                    </p>
                  ))}
                </div>
              </>
            ) : !overviewError ? (
              <p className="muted small">Loading…</p>
            ) : null}
          </section>
        ) : tab === 'team' ? (
          <section className="card nv-care-card" aria-label="Hospital team">
            <header className="nv-care-card-head">
              <h2 className="section-title">Hospital team</h2>
              <p className="muted small">Nurses and doctors can be limited to specific departments at {hospitalName}. Invitations expire in 72 hours.</p>
            </header>
            <div className="nv-finder-grid">
              <div className="nv-finder-controls">
                {access ? (
                  managingMember ? (
                    <form className="nv-book-form" style={{ borderTop: 'none', paddingTop: 0 }} onSubmit={(event) => void updateMember(event)}>
                      <strong className="small">Manage {managingMember.displayName || managingMember.email}</strong>
                      <label className="nv-field">Role
                        <select aria-label="Member role" value={manageRole} onChange={(event) => setManageRole(event.target.value as TeamRole)}>
                          <option value="administrator">Administrator</option>
                          <option value="nurse">Nurse</option>
                          <option value="doctor">Doctor</option>
                          <option value="dispatcher">Dispatcher</option>
                        </select>
                      </label>
                      <label className="nv-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" aria-label="Active team member" checked={manageActive} onChange={(event) => setManageActive(event.target.checked)} />
                        Active team member
                      </label>
                      {manageRole !== 'administrator' && manageRole !== 'dispatcher' ? (
                        <fieldset className="nv-field" style={{ border: 'none', padding: 0, margin: 0 }}>
                          <legend className="small" style={{ fontWeight: 750, marginBottom: 6 }}>Departments — leave empty for all specialties</legend>
                          {assignableDepartments.map((department) => (
                            <label key={department.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <input
                                type="checkbox"
                                aria-label={`Assign ${department.name}`}
                                checked={manageDepartmentIds.includes(department.id)}
                                onChange={() => setManageDepartmentIds((previous) => toggleId(previous, department.id))}
                              />
                              {department.name}
                            </label>
                          ))}
                        </fieldset>
                      ) : null}
                      {manageError ? <p className="nv-error" role="alert">{manageError}</p> : null}
                      {manageMessage ? <p className="nv-notice" role="status">{manageMessage}</p> : null}
                      <div className="nv-book-actions">
                        <button type="submit" className="primary-btn" disabled={managing}>{managing ? 'Saving…' : 'Save changes'}</button>
                        <button type="button" className="ghost-btn" onClick={() => setManagingMemberId(undefined)}>Back to invitations</button>
                      </div>
                    </form>
                  ) : (
                    <form className="nv-book-form" style={{ borderTop: 'none', paddingTop: 0 }} onSubmit={(event) => void invite(event)}>
                      <label className="nv-field">Team member email
                        <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" required />
                      </label>
                      <label className="nv-field">Role
                        <select aria-label="Invite role" value={inviteRole} onChange={(event) => { setInviteRole(event.target.value as TeamRole); setInviteDepartmentIds([]); }}>
                          <option value="administrator">Administrator</option>
                          <option value="nurse">Nurse</option>
                          <option value="doctor">Doctor</option>
                          <option value="dispatcher">Dispatcher</option>
                        </select>
                      </label>
                      {inviteRole !== 'administrator' && inviteRole !== 'dispatcher' ? (
                        <fieldset className="nv-field" style={{ border: 'none', padding: 0, margin: 0 }}>
                          <legend className="small" style={{ fontWeight: 750, marginBottom: 6 }}>Departments — leave empty for all specialties</legend>
                          {assignableDepartments.map((department) => (
                            <label key={department.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <input
                                type="checkbox"
                                aria-label={`Invite to ${department.name}`}
                                checked={inviteDepartmentIds.includes(department.id)}
                                onChange={() => setInviteDepartmentIds((previous) => toggleId(previous, department.id))}
                              />
                              {department.name}
                            </label>
                          ))}
                        </fieldset>
                      ) : null}
                      {adminDepartmentsError ? <p className="nv-error" role="alert">{adminDepartmentsError}</p> : null}
                      {inviteError ? <p className="nv-error" role="alert">{inviteError}</p> : null}
                      {inviteMessage ? <p className="nv-notice" role="status">{inviteMessage}</p> : null}
                      {inviteClaimUrl ? (
                        <div className="nv-claim-box">
                          <strong className="small">Invitation link</strong>
                          <code>{inviteClaimUrl}</code>
                          <div className="nv-claim-copy">
                            <span className="muted small">Also sent by email. Open or share this link if the email does not arrive — the recipient must sign in with the invited email address.</span>
                            <button type="button" className="ghost-btn" onClick={() => void copyClaimLink()}>{copied ? 'Copied' : 'Copy link'}</button>
                          </div>
                        </div>
                      ) : null}
                      <div className="nv-book-actions">
                        <button type="submit" className="primary-btn" disabled={inviting}>{inviting ? 'Sending invitation…' : 'Send invitation'}</button>
                      </div>
                    </form>
                  )
                ) : <p className="muted small">Sign in to send invitations.</p>}
              </div>
              <div className="nv-finder-detail">
                <div className="nv-detail-card">
                  <div className="nv-access-list" style={{ borderTop: 'none', paddingTop: 0 }}>
                    <strong className="small">Team members</strong>
                    {teamError ? <p className="nv-error" role="alert">{teamError}</p> : null}
                    {teamMessage ? <p className="nv-notice" role="status">{teamMessage}</p> : null}
                    {team === undefined && !teamError ? <p className="muted small">Loading the team…</p> : null}
                    {team && team.members.length === 0 && team.pendingInvitations.length === 0 ? (
                      <p className="muted small" style={{ margin: 0 }}>No team members yet — send the first invitation.</p>
                    ) : null}
                    {team?.members.map((member) => (
                      <p key={member.membershipId} className="nv-access-row">
                        <span>
                          {member.displayName || member.email}
                          <small className="muted"> · {member.email}</small>
                          <small className="muted"> · since {formatMemberDate(member.since)}</small>
                          <small className="muted"> · {member.role === 'administrator' ? 'Hospital administrator' : member.role === 'dispatcher' ? 'Dispatch operations' : member.departments.length > 0 ? member.departments.map((department) => department.name).join(', ') : 'All specialties'}</small>
                        </span>
                        <span>
                          <span className="badge blue">{roleLabels[member.role]}</span>{' '}
                          <span className={`badge ${member.active ? 'green' : 'red'}`}>{member.active ? 'Active' : 'Inactive'}</span>{' '}
                          <button type="button" className="ghost-btn" onClick={() => startManaging(member)}>Manage</button>
                        </span>
                      </p>
                    ))}
                    {team?.pendingInvitations.map((invitation) => (
                      <p key={`${invitation.email}-${invitation.role}`} className="nv-access-row">
                        <span>
                          {invitation.email}
                          <small className="muted"> · {roleLabels[invitation.role]} invitation</small>
                          <small className="muted"> · {invitation.role === 'dispatcher' ? 'Dispatch operations' : invitation.departmentIds.length > 0 ? `${invitation.departmentIds.length} department${invitation.departmentIds.length === 1 ? '' : 's'} assigned` : 'All specialties'}</small>
                        </span>
                        <span className={`badge ${new Date(invitation.expiresAt) < new Date() ? 'red' : 'yellow'}`}>
                          {new Date(invitation.expiresAt) < new Date() ? 'Expired' : 'Invitation pending'}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : tab === 'schedule' ? (
          <section className="card nv-care-card" aria-label="Appointment schedule">
            <header className="nv-care-card-head">
              <h2 className="section-title">Appointment schedule</h2>
              <p className="muted small">Slots run between 07:00 and 19:00. Bookings are available 07:00 to 19:00 at {hospitalName}.</p>
            </header>
            <div className="nv-finder-grid">
              <div className="nv-finder-controls">
                {access ? (
                  <form className="nv-book-form" style={{ borderTop: 'none', paddingTop: 0 }} onSubmit={(event) => void createSlots(event)}>
                    <label className="nv-field">Department
                      <select aria-label="Slot department" value={slotForm.departmentId} onChange={(event) => setSlotForm({ ...slotForm, departmentId: event.target.value })} required>
                        <option value="" disabled>Choose a department</option>
                        {departments?.map((department) => (
                          <option key={department.id} value={department.id}>{department.name} · {department.averageConsultationMinutes} min</option>
                        ))}
                      </select>
                    </label>
                    <label className="nv-field">Date
                      <input type="date" aria-label="Slot date" value={slotForm.date} min={tomorrowDate()} onChange={(event) => setSlotForm({ ...slotForm, date: event.target.value })} required />
                    </label>
                    <div className="nv-finder-controls" style={{ display: 'flex', gap: 12 }}>
                      <label className="nv-field" style={{ flex: 1 }}>From
                        <input type="time" aria-label="Start time" value={slotForm.startTime} min="07:00" max="19:00" onChange={(event) => setSlotForm({ ...slotForm, startTime: event.target.value })} required />
                      </label>
                      <label className="nv-field" style={{ flex: 1 }}>To
                        <input type="time" aria-label="End time" value={slotForm.endTime} min="07:00" max="19:00" onChange={(event) => setSlotForm({ ...slotForm, endTime: event.target.value })} required />
                      </label>
                    </div>
                    <div className="nv-finder-controls" style={{ display: 'flex', gap: 12 }}>
                      <label className="nv-field" style={{ flex: 1 }}>Slot length (minutes)
                        <input type="number" aria-label="Slot length" min={5} max={240} value={slotForm.slotMinutes} onChange={(event) => setSlotForm({ ...slotForm, slotMinutes: event.target.value })} required />
                      </label>
                      <label className="nv-field" style={{ flex: 1 }}>Capacity per slot
                        <input type="number" aria-label="Slot capacity" min={1} max={50} value={slotForm.capacity} onChange={(event) => setSlotForm({ ...slotForm, capacity: event.target.value })} required />
                      </label>
                    </div>
                    {slotError ? <p className="nv-error" role="alert">{slotError}</p> : null}
                    {slotMessage ? <p className="nv-notice" role="status">{slotMessage}</p> : null}
                    <div className="nv-book-actions">
                      <button type="submit" className="primary-btn" disabled={creatingSlots || !slotForm.departmentId}>
                        {creatingSlots ? 'Creating slots…' : 'Create slots'}
                      </button>
                    </div>
                  </form>
                ) : <p className="muted small">Sign in to manage the schedule.</p>}
              </div>
              <div className="nv-finder-detail">
                <div className="nv-detail-card">
                  <div className="nv-access-list" style={{ borderTop: 'none', paddingTop: 0 }}>
                    <strong className="small">Published slots</strong>
                    {scheduleError ? <p className="nv-error" role="alert">{scheduleError}</p> : null}
                    {scheduleLoading && slots === undefined ? <p className="muted small">Loading the schedule…</p> : null}
                    {!scheduleLoading && scheduleSlots.length === 0 && !scheduleError ? (
                      <p className="muted small" style={{ margin: 0 }}>No slots yet — create tomorrow's slots for your busiest department.</p>
                    ) : null}
                    {scheduleSlots.map((slot) => (
                      <p key={slot.id} className="nv-access-row">
                        <span>
                          {slot.departmentName}
                          <small className="muted"> · {slot.date} · {slot.startTime}–{slot.endTime}</small>
                        </span>
                        <span>
                          <span className={`badge ${slot.reservedCount >= slot.capacity ? 'red' : 'blue'}`}>
                            {slot.reservedCount}/{slot.capacity} booked
                          </span>{' '}
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={deletingSlotId === slot.id || slot.reservedCount > 0}
                            onClick={() => void deleteSlot(slot.id)}
                          >
                            {deletingSlotId === slot.id ? 'Removing…' : 'Remove'}
                          </button>
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : tab === 'departments' ? (
          <section className="card nv-care-card" aria-label="Departments">
            <header className="nv-care-card-head">
              <h2 className="section-title">Departments</h2>
              <p className="muted small">Average consultation time feeds the estimated wait shown to patients in the queue.</p>
            </header>
            <div className="nv-finder-grid">
              <div className="nv-finder-controls">
                {access ? (
                  <form className="nv-book-form" style={{ borderTop: 'none', paddingTop: 0 }} onSubmit={(event) => void createOrUpdateDepartment(event)}>
                    <strong className="small">{departmentForm.id ? `Edit department` : 'Add a department'}</strong>
                    <label className="nv-field">Department name
                      <input type="text" aria-label="Department name" value={departmentForm.name} minLength={2} maxLength={80} placeholder="e.g. Radiology" onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} required />
                    </label>
                    <label className="nv-field">Average consultation (minutes)
                      <input type="number" aria-label="Average consultation minutes" min={5} max={240} value={departmentForm.averageConsultationMinutes} onChange={(event) => setDepartmentForm({ ...departmentForm, averageConsultationMinutes: event.target.value })} required />
                    </label>
                    {departmentError ? <p className="nv-error" role="alert">{departmentError}</p> : null}
                    {departmentMessage ? <p className="nv-notice" role="status">{departmentMessage}</p> : null}
                    <div className="nv-book-actions">
                      <button type="submit" className="primary-btn" disabled={savingDepartment}>
                        {savingDepartment ? 'Saving…' : departmentForm.id ? 'Save changes' : 'Add department'}
                      </button>
                      {departmentForm.id ? (
                        <button type="button" className="ghost-btn" onClick={() => setDepartmentForm({ name: '', averageConsultationMinutes: '15' })}>Cancel edit</button>
                      ) : null}
                    </div>
                  </form>
                ) : <p className="muted small">Sign in to manage departments.</p>}
              </div>
              <div className="nv-finder-detail">
                <div className="nv-detail-card">
                  <div className="nv-access-list" style={{ borderTop: 'none', paddingTop: 0 }}>
                    <strong className="small">Your departments</strong>
                    {adminDepartmentsError ? <p className="nv-error" role="alert">{adminDepartmentsError}</p> : null}
                    {adminDepartments === undefined && !adminDepartmentsError ? <p className="muted small">Loading departments…</p> : null}
                    {adminDepartments && adminDepartments.length === 0 ? (
                      <p className="muted small" style={{ margin: 0 }}>No departments yet — add your first one.</p>
                    ) : null}
                    {adminDepartments?.map((department) => (
                      <p key={department.id} className="nv-access-row">
                        <span>
                          {department.name}
                          <small className="muted"> · {department.averageConsultationMinutes} min average</small>
                          <small className="muted"> · {department.slotCount} slots · {department.appointmentCount} bookings</small>
                        </span>
                        <span>
                          <span className={`badge ${department.active ? 'green' : 'red'}`}>{department.active ? 'Active' : 'Inactive'}</span>{' '}
                          <button type="button" className="ghost-btn" onClick={() => setDepartmentForm({ id: department.id, name: department.name, averageConsultationMinutes: String(department.averageConsultationMinutes) })}>Edit</button>{' '}
                          <button type="button" className="ghost-btn" onClick={() => void toggleDepartment(department)}>
                            {department.active ? 'Deactivate' : 'Reactivate'}
                          </button>{' '}
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={deletingDepartmentId === department.id || department.slotCount > 0 || department.appointmentCount > 0}
                            title={department.slotCount > 0 || department.appointmentCount > 0 ? 'This department has published slots or bookings — deactivate it instead.' : undefined}
                            onClick={() => void removeDepartment(department)}
                          >
                            {deletingDepartmentId === department.id ? 'Removing…' : 'Remove'}
                          </button>
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : tab === 'display' ? (
          <section className="card nv-care-card" aria-label="Public display settings">
            <header className="nv-care-card-head">
              <h2 className="section-title">Waiting-room display</h2>
              <p className="muted small">The public screen shows an anonymous ticket number, department, and status only — never names, contacts, or diagnoses.</p>
            </header>
            <div className="nv-finder-grid">
              <div className="nv-finder-controls">
                {access ? (
                  <div className="nv-book-form" style={{ borderTop: 'none', paddingTop: 0 }}>
                    <strong className="small">Display link</strong>
                    {displayError ? <p className="nv-error" role="alert">{displayError}</p> : null}
                    {displayMessage ? <p className="nv-notice" role="status">{displayMessage}</p> : null}
                    {display === undefined && !displayError ? <p className="muted small">Loading display settings…</p> : null}
                    {display && displayUrl ? (
                      <>
                        <p style={{ margin: '4px 0 0' }}>
                          <span className={`badge ${display.active ? 'green' : 'red'}`}>{display.active ? 'Display on' : 'Display off'}</span>
                        </p>
                        <div className="nv-claim-box">
                          <strong className="small">Kiosk link</strong>
                          <code>{displayUrl}</code>
                          <div className="nv-claim-copy">
                            <span className="muted small">Open this link on the waiting-room screen. Treat it like a shared secret — anyone with the link can view the public queue screen.</span>
                            <button type="button" className="ghost-btn" onClick={() => void copyText(displayUrl)}>{copied ? 'Copied' : 'Copy link'}</button>
                          </div>
                        </div>
                        <div className="nv-book-actions">
                          <button type="button" className="primary-btn" disabled={displayBusy} onClick={() => void setDisplayActive(!display.active)}>
                            {displayBusy ? 'Saving…' : display.active ? 'Turn display off' : 'Turn display on'}
                          </button>
                          <button type="button" className="ghost-btn" disabled={displayBusy} onClick={() => void rotateDisplay()}>Generate new link</button>
                        </div>
                      </>
                    ) : null}
                    {display && !displayUrl ? (
                      <div className="nv-book-actions">
                        <button type="button" className="primary-btn" disabled={displayBusy} onClick={() => void rotateDisplay()}>
                          {displayBusy ? 'Generating…' : 'Generate display link'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : <p className="muted small">Sign in to manage the waiting-room display.</p>}
              </div>
              <div className="nv-finder-detail">
                <div className="nv-detail-card">
                  <div className="nv-access-list" style={{ borderTop: 'none', paddingTop: 0 }}>
                    <strong className="small">How it works</strong>
                    <p className="muted small" style={{ margin: 0 }}>1. Generate a link and open it full-screen on a TV or tablet in the waiting room.</p>
                    <p className="muted small" style={{ margin: 0 }}>2. Patients who check in appear as an anonymous ticket number with their department and status.</p>
                    <p className="muted small" style={{ margin: 0 }}>3. Generating a new link immediately invalidates the old one — useful if a screen is left unattended.</p>
                    <p className="muted small" style={{ margin: 0 }}>4. Turning the display off keeps the link but hides the screen until you switch it back on.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="card nv-care-card" aria-label="Activity log">
            <header className="nv-care-card-head">
              <h2 className="section-title">Activity</h2>
              <p className="muted small">Staff actions are recorded for accountability. The latest 50 events are shown.</p>
            </header>
            <div className="nv-access-list" style={{ borderTop: 'none', paddingTop: 0 }}>
              {auditError ? <p className="nv-error" role="alert">{auditError}</p> : null}
              {auditEvents === undefined && !auditError ? <p className="muted small">Loading activity…</p> : null}
              {auditEvents && auditEvents.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>No recorded activity yet — invite a teammate or publish some slots.</p>
              ) : null}
              {auditEvents?.map((event) => (
                <p key={event.id} className="nv-access-row">
                  <span>
                    {auditLabels[event.action] ?? event.action}
                    <small className="muted"> · {auditDetail(event)}</small>
                  </span>
                  <span>
                    <span className="muted small">{event.actor?.displayName || event.actor?.email || 'System'}</span>{' '}
                    <span className="badge blue">{formatEventTime(event.createdAt)}</span>
                  </span>
                </p>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
