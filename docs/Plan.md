# NovaCare Hackathon Plan

## 1. Product Definition

NovaCare is a patient-centred coordination platform for South African public hospitals. It reduces two common failures in the patient journey:

1. Patients wait without knowing where to go, how long they may wait, or whether they are in the right queue.
2. Staff lack one shared view of appointments, arrivals, triage decisions, department queues, and referrals.

The hackathon product demonstrates one complete journey:

1. A patient self-registers and builds a wellness profile.
2. The patient books a hospital-managed appointment slot.
3. Before arrival, the patient completes symptom intake and may upload a lab report or referral photo/PDF.
4. AI summarizes the submitted information, detects configured red flags, and suggests a department and urgency category.
5. A nurse reviews, corrects, and confirms the triage decision.
6. The patient checks in, sees only their own status, queue position, and estimated wait.
7. An anonymized public waiting-room display shows queue progress.
8. A doctor completes the consultation or refers the patient to another department queue.

## 2. Hackathon Outcome

Build a working, deployable demonstration, not a simulated slide deck.

### Must demonstrate

- Patient self-sign-up and login using the existing Auth0 integration.
- Hospital-scoped departments, schedules, staff, appointments, and queues.
- Hospital administrator email invitations for nurses, doctors, and additional administrators.
- Patient wellness profile: age, contact details, chronic conditions, allergies, medications, and optional health notes.
- NovaCare-managed appointment slots and booking.
- Patient check-in and live queue status.
- AI-assisted intake that recommends routing and urgency for a nurse to confirm.
- Emergency-symptom guidance plus an immediate staff alert, outside the normal queue flow.
- Nurse triage confirmation, queue prioritization, and patient routing.
- Doctor queue, consultation completion, and internal department referral.
- An anonymized public display with no patient names, email addresses, ID numbers, diagnoses, or document data.
- A deployed frontend, API, database, Auth0 authentication, and a rehearsed end-to-end demo.

### Explicitly not in scope for the hackathon

- Autonomous diagnosis, prescribing, treatment recommendations, or clinical decision replacement.
- Direct Discovery Health eligibility, claims, or member-data integration.
- A guaranteed official national hospital/department data integration.
- Production-grade electronic medical records, billing, prescriptions, or HL7/FHIR interoperability.
- Real WhatsApp delivery unless the core journey is stable first.
- Full offline mutation sync. Design for low bandwidth; defer a robust outbox/conflict system.

## 3. Product Principles

### Patient first

- Patients self-register; they do not need a staff-created account.
- Patients only see their own appointments, documents, status, queue position, and estimated wait.
- The platform uses plain language, mobile-first screens, low-data pages, and clear next actions.
- The public display is anonymous and never exposes clinical information.

### Human clinical ownership

- AI is labelled as an intake and routing suggestion, not a diagnosis.
- A qualified nurse must confirm, amend, or reject every normal AI routing recommendation before it affects the clinical queue.
- Configured emergency red flags show immediate emergency guidance and create a high-visibility staff alert. The patient is not told to wait for ordinary queue routing.
- Doctors and nurses remain responsible for clinical decisions.

### Hospital isolation

- Every patient, staff member, department, queue, slot, and document belongs to one hospital.
- Hospital administrators can manage only their hospital.
- Nurses and doctors can access only patients and queues permitted for their hospital and departments.

### Privacy by default

- Collect the minimum personal and health information needed for the demo.
- Do not place national ID numbers, diagnoses, or document contents in logs, public displays, URLs, or frontend analytics.
- Require consent before AI processes symptom answers or uploaded reports.
- Store uploaded documents privately and make all access auditable.
- Treat POPIA, hospital policy, retention, and clinical governance as production requirements, not solved by the hackathon.

## 4. Roles and Access

| Role | How created | Core permissions |
|---|---|---|
| Patient | Self-sign-up through Auth0 | Own profile, bookings, intake, uploads, check-in, own queue status, notifications. |
| Hospital administrator | Seeded or invited by platform operator | Manage hospital departments, schedules, appointment slots, public display settings, and invite hospital staff by email. |
| Nurse | Email invitation, then Auth0 sign-up/login | Review AI intake, identify emergencies, assign/confirm triage, prioritize queues, route patients. |
| Doctor | Email invitation, then Auth0 sign-up/login | View assigned department queue, consultation completion, and referral. |
| Platform operator | Seeded hackathon account | Imports hospital directory data and provisions hospital administrators. |

### Invitation workflow

1. A hospital administrator enters a staff email, role, and optional department assignments.
2. NovaCare creates a pending invitation with a signed, expiring token.
3. The staff member receives an email link, signs in or signs up through Auth0, and claims the invitation.
4. NovaCare links the Auth0 subject to the pre-approved hospital role.
5. Patients can never claim staff roles through ordinary self-sign-up.

## 5. Core Patient Journey

### Account and wellness profile

- Patient creates an Auth0 account with the existing email/password Universal Login flow.
- On first login, create a local patient profile.
- Collect only necessary demographic and wellness fields: date of birth or age band, phone number, emergency contact, chronic conditions, allergies, medications, and optional notes.
- Capture explicit consent for AI-assisted intake and private document processing.

### Booking

- Patient selects a hospital, department/service, available day, and NovaCare-managed appointment slot.
- Booking creates an appointment with status `booked`.
- The patient receives in-app confirmation. Email notification is optional if time permits.
- A hospital administrator creates departments, clinician/service availability, and slots in NovaCare for the demo.

### Pre-visit intake

- Patient answers a short symptom questionnaire before arrival.
- Patient may upload a PDF or a phone photo of a lab report or referral letter.
- Uploads are optional to complete the booking; a missing document must not block care.
- AI returns a structured, reviewable summary: reported symptoms, relevant document facts, possible routing department, suggested urgency category, and red-flag reasons.
- The patient sees: "This is not a diagnosis. A nurse will review your information."

### Emergency handling

- Maintain a small clinician-approved hackathon red-flag ruleset, for example severe chest pain, difficulty breathing, stroke-like symptoms, major bleeding, loss of consciousness, or severe allergic reaction.
- If triggered, show immediate emergency instructions and create a `critical_alert` for triage staff.
- Do not display a normal queue ETA as the next action for these cases.
- Record that the alert was acknowledged by a nurse.

### Arrival, queue, consultation, and referral

- Patient checks in using the booking in the app or through a staff-assisted check-in screen.
- The queue entry begins as `awaiting_triage`.
- After nurse confirmation, the patient sees only department, status, queue position, estimated wait, and next instruction.
- Queue updates use polling first; real-time push is a stretch improvement.
- Doctor marks a queue entry as `in_consultation`, then `completed`, or refers the patient to another department.

## 6. Queue and Triage Design

### Queue states

```text
booked
checked_in
awaiting_triage
triaged_waiting
called
in_consultation
referred
completed
cancelled
critical_alert
```

### Triage categories

Use a simple, clinician-reviewed category model inspired by South African triage practice. Do not claim formal SATS certification.

| Category | Queue behaviour |
|---|---|
| Critical | Emergency alert and immediate staff attention; excluded from normal ETA messaging. |
| Very urgent | Moves ahead of routine queue after nurse confirmation. |
| Urgent | Prioritized above routine care. |
| Routine | Ordered primarily by confirmed check-in time and appointment context. |

### Ordering rule

```text
1. Confirmed triage category
2. Appointment/check-in eligibility
3. Time waiting after triage
4. Creation time as stable tie-breaker
```

Never allow an AI score alone to reorder the queue. The persisted nurse-confirmed category is the source of truth.

### Estimated wait

- Start with a transparent heuristic: people ahead in the same department multiplied by a configured average consultation duration.
- Label this as an estimate.
- Administrators can configure the average duration per department for the demo.

## 7. AI-Assisted Intake

### Purpose

- Turn patient-entered symptoms and uploaded report text into a concise nurse review card.
- Suggest a likely department/service and urgency category.
- Identify configured red flags for urgent human review.

### Required guardrails

- No diagnosis claims, prescriptions, medication changes, or certainty language.
- Structured JSON output only; validate the output server-side.
- Use a fixed department list from the selected hospital. The model cannot invent a department.
- Show source snippets or extracted facts for document summaries where possible.
- Store model version, prompt version, result, nurse override, and override reason for auditability.
- Provide a safe fallback when AI is unavailable: patient enters the normal `awaiting_triage` queue and a nurse performs manual routing.
- Obtain explicit consent before processing report documents or wellness information.

### Document pipeline

1. Validate file type and size: PDF, JPG, JPEG, PNG only.
2. Store privately in object storage; store metadata and access audit records in PostgreSQL.
3. Extract text from digital PDFs; use OCR for images only if time allows.
4. Send the minimum relevant text to the AI service.
5. Present the result as a draft summary for nurse review.

## 8. Hospital Data Strategy

- Seed a curated, realistic demo directory of South African public hospitals, locations, and departments. This is the required fallback.
- Research an external facility-location source in parallel, but do not make the demo depend on it.
- Validate official Department of Health facility data, OpenStreetMap locations, and open-data catalogues for licence, coverage, and freshness.
- Never assume an external location dataset contains current departments, waiting times, clinical capacity, or appointment availability.
- Import external facility records into a reviewed staging table before exposing them as active hospitals.

### Demo data

- One primary demo hospital with emergency, general medicine, outpatient, maternity, paediatrics, pharmacy, radiology, and laboratory collection.
- A small selection of additional hospitals for the facility finder.
- Seed staff accounts, slots, queue entries, public-display tokens, and realistic but fictional patient data.

## 9. Technical Plan

Use the platform already deployed in this repository. Do not replace the stack during the hackathon.

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite, TypeScript, React Router, Auth0 React SDK, mobile-first responsive UI. |
| Backend | Node.js 22, Express 5, TypeScript, `pg`, `jose`, Helmet, CORS, dotenv. |
| Database | Neon PostgreSQL with TypeScript migrations. |
| Authentication | Auth0 SPA Authorization Code Flow with PKCE; API JWT validation through JWKS. |
| File storage | Private object storage with signed upload/download URLs; choose a provider before implementing uploads. |
| Hosting | Vercel frontend, Render API, GitHub Actions CI. |
| Live updates | Start with short-interval polling. Add SSE or Socket.IO only after the core workflow is stable. |
| Testing | Vitest for API/domain logic and UI; Playwright critical-path E2E scaffold. |

### Frontend routes

| Route | Audience | Purpose |
|---|---|---|
| `/` | Patient | Authenticated patient home and next action. |
| `/profile` | Patient | Wellness profile and consent. |
| `/book` | Patient | Hospital, department, date, and slot selection. |
| `/appointments/:id/intake` | Patient | Symptoms, document upload, AI consent, pre-visit intake. |
| `/appointments/:id/queue` | Patient | Own status, position, ETA, and instructions. |
| `/staff/triage` | Nurse | Intake review, emergency alerts, routing, confirmation. |
| `/staff/queue` | Nurse/Doctor | Department queue operations. |
| `/staff/schedule` | Hospital admin | Departments, slots, and capacity configuration. |
| `/staff/team` | Hospital admin | Staff invitation and role management. |
| `/display/:hospitalToken` | Public screen | Anonymized queue progress only. |

### Backend modules

1. Identity and authorization: local users, hospital memberships, invitation claims, and role middleware.
2. Hospital directory: hospitals, locations, departments, external import staging, and curated seed data.
3. Scheduling: department schedules, slots, appointment booking/cancellation, and capacity.
4. Patient profile: wellness profile, consent records, and strict ownership checks.
5. Intake: symptom answers, file metadata, AI request/result, red flags, and nurse decision.
6. Queue: check-in, state transitions, ordering, ETA, patient-safe read model, and public-display read model.
7. Consultation/referral: clinician actions and receiving-department queue creation.
8. Notifications: in-app event feed first; WhatsApp mock/integration only as a stretch feature.
9. Audit: staff actions, AI suggestions, overrides, invitation activity, and document access.

## 10. Data Model

```text
users
  id, auth0_subject, email, display_name, created_at

hospitals
  id, name, province, address, latitude, longitude, source, external_id, active

departments
  id, hospital_id, name, service_code, average_consultation_minutes, active

hospital_memberships
  id, user_id, hospital_id, role[admin|nurse|doctor], active

staff_invitations
  id, hospital_id, email, role, department_ids, token_hash, expires_at, claimed_at

patient_profiles
  id, user_id, phone, date_of_birth, emergency_contact, consented_at

wellness_profiles
  id, patient_id, conditions, allergies, medications, notes, updated_at

appointment_slots
  id, hospital_id, department_id, starts_at, ends_at, capacity, reserved_count

appointments
  id, patient_id, hospital_id, department_id, slot_id, status, booked_at

intake_submissions
  id, appointment_id, symptoms, consented_at, submitted_at

documents
  id, patient_id, intake_id, storage_key, media_type, status, uploaded_at

ai_intake_assessments
  id, intake_id, model_version, suggested_department_id, suggested_category,
  red_flags, summary, status, created_at

triage_decisions
  id, appointment_id, nurse_id, department_id, category, override_reason, confirmed_at

queue_entries
  id, appointment_id, hospital_id, department_id, status, category,
  checked_in_at, triaged_at, called_at, completed_at

referrals
  id, queue_entry_id, from_department_id, to_department_id, doctor_id, reason, created_at

notifications
  id, user_id, type, payload, read_at, created_at

audit_events
  id, actor_user_id, hospital_id, entity_type, entity_id, action, metadata, created_at
```

## 11. Authorization Rules

- A patient can read and modify only their profile, own bookings, own intake, own documents, own notifications, and own queue status.
- A hospital administrator can manage only records for their hospital and cannot read patient documents unless explicitly granted a clinical workflow role.
- A nurse can access triage and queue data only for the hospital and assigned departments.
- A doctor can access consultation/referral information only for their hospital and assigned departments.
- The public display endpoint returns a deliberately separate, anonymized projection. It never reuses the staff queue endpoint.
- Every hospital-scoped database query must filter by hospital ID derived from server-side membership, never from a client-provided ID alone.

## 12. Delivery Priorities

### P0: must work before demo

1. Multi-hospital data model with one seeded demo hospital.
2. Patient self-sign-up, patient role default, and hospital staff invitation/claim flow.
3. Hospital admin creates slots; patient books an appointment.
4. Patient check-in creates queue entry.
5. Nurse triage confirms category and department; queue reorders.
6. Patient own queue page and anonymized public display update through polling.
7. Doctor completes consultation and creates an internal referral.
8. Deployed happy path with test data and no secrets in source control.

### P1: build after P0 is stable

1. Wellness profile and consent.
2. AI symptom summary and nurse-confirmed routing.
3. Emergency red-flag guidance and nurse alert.
4. In-app notifications.
5. PDF/photo upload with private storage and review card.

### P2: time-dependent stretch goals

1. OCR for photographed reports.
2. WhatsApp notifications or a working WhatsApp mock.
3. Live SSE/WebSocket updates instead of polling.
4. External hospital-directory import.
5. A second demo hospital and cross-hospital referral rules.

## 13. Testing Plan

### Backend and domain tests

- Role and hospital-isolation authorization matrix.
- Invitation expiration and staff-role claim rules.
- Appointment capacity and double-booking prevention.
- Queue ordering and stable tie-breaker logic.
- Patient cannot access another patient’s appointment, intake, document, or queue entry.
- Nurse confirmation is required before AI routing changes a normal queue.
- Critical-alert path bypasses ordinary ETA messaging.
- Public-display projection contains no direct identifiers or clinical fields.

### Frontend tests

- Patient booking and check-in state.
- Queue position/ETA presentation and empty/error states.
- Nurse review distinguishes AI suggestion from confirmed triage.
- Public screen shows anonymous tokens/status only.

### End-to-end demo test

1. Patient signs up and books a slot.
2. Patient submits symptoms and checks in.
3. Nurse confirms routing and urgency.
4. Patient queue position and public display update.
5. Doctor calls and completes the consultation or refers the patient.

## 14. 48-Hour Build Schedule

| Time | Deliverable |
|---|---|
| Hours 0-3 | Final schema, role matrix, routes, seed data, demo script, task split. |
| Hours 3-8 | Hospital/departments, memberships, Auth0 local-role sync, patient profile, staff invitation foundations. |
| Hours 8-16 | Slots, appointment booking, patient home, check-in, queue entry creation. |
| Hours 16-24 | Nurse triage, queue ordering/ETA, staff queue, patient queue, public display. |
| Hours 24-30 | Doctor completion/referral, notifications, authorization and queue tests. |
| Hours 30-36 | AI intake and emergency red-flag path, only after P0 is dependable. |
| Hours 36-41 | Document upload/summary if P0/P1 are stable; otherwise polish and test. |
| Hours 41-45 | Production deployment, seed reset, mobile testing, demo rehearsal. |
| Hours 45-48 | Bug fixes, pitch, fallback demo recording, deployment freeze. |

## 15. Demo Narrative

1. A patient creates a NovaCare account, completes a small wellness profile, and books an outpatient appointment.
2. Before arrival, the patient answers symptoms and uploads a fictional lab report. NovaCare clearly labels its output as a nurse-reviewed routing suggestion.
3. On arrival, the patient checks in. The public screen updates with an anonymous ticket/status only.
4. A nurse sees the intake summary, confirms or corrects the suggested department and urgency, and the queue changes transparently.
5. The patient sees their own position and ETA. No other patient information is visible.
6. A doctor completes the visit or refers the patient to another department. The patient receives the new queue instruction in-app.
7. Optional stretch: demonstrate a red-flag submission, emergency guidance, and immediate staff alert.

## 16. Risk Register

| Risk | Mitigation |
|---|---|
| AI is mistaken for diagnosis | Strong UX language, structured suggestion only, nurse confirmation, no treatment advice, audit overrides. |
| Clinical safety concern with emergency symptoms | Small approved red-flag ruleset, emergency instructions, staff alert, no ordinary queue promise. |
| Scope overload | Freeze P0 before AI, documents, WhatsApp, OCR, external data, or live sockets. |
| External hospital data unavailable or unreliable | Curated seed data is the demo source of truth; external import is optional. |
| Privacy breach on public display | Separate anonymous API/view model; test that identifiers and clinical data cannot appear. |
| Auth0 role escalation | Patients always default to patient; staff roles require a server-side invitation claim. |
| Render Free cold starts | Warm the service before demo; keep a fallback recording; upgrade for real rollout. |
| Shared Auth0 tenant branding | Accept for hackathon; use dedicated tenant or approved custom domain before real deployment. |

## 17. Post-Hackathon Path

1. Clinical governance review for triage rules, emergency copy, AI prompt/output, and nurse workflows.
2. POPIA impact assessment, consent/retention policy, access audit, penetration testing, and data-processing agreements.
3. Dedicated production Auth0 tenant/custom domain; staff SSO and stronger identity verification where required.
4. Production file storage, malware scanning, encryption/key management, backups, observability, and disaster recovery.
5. Validate a licensed hospital/facility directory and integrate only authoritative data.
6. Pilot with one hospital department, measure wait time, no-show rate, routing corrections, nurse override rate, and patient satisfaction.
7. Integrate verified provider systems only through approved interfaces; consider standards such as FHIR where relevant.
