# NovaCare — Implementation Roadmap

A step-by-step guide to building the product described in [`docs/Plan.md`](./Plan.md).
Each step lists **what to build**, **where it lives in this repo**, **dependencies**, and
**the check that means the step is done**. Steps are ordered so that every phase ends with
something demoable.

---

## 0. Current state of the repo (baseline)

Understanding what already exists prevents rebuilding it:

| Area | Status in repo today | Gap vs. Plan |
|---|---|---|
| Monorepo | npm workspaces: `frontend`, `backend`, `e2e`; root `test`/`typecheck`/`lint`/`build` scripts | — |
| Backend | Express 5 + TS app (`backend/src/app.ts`), Auth0 JWT validation (`auth.ts`), `pg` pool (`db.ts`) | Route handlers are inline; need modular split per §9 |
| Migrations | 001–011: users, hospitals/services, appointments, queue_entries, patient_profiles, platform_operators, hospital_memberships, staff_invitations | Missing: departments-as-modelled, slots, intake, documents, AI assessments, triage decisions, referrals, notifications, audit |
| Hospital directory | Large imported DoH dataset (`src/data/*.json`) + import migrations | Plan requires a curated seed hospital + staging pattern; current import must not become the source of truth |
| Frontend | React 18 + Vite + TS, Auth0 provider, routes `/`, `/signin`, `/patient`, `/staff`, `/admin`, `/care/*`, `/book`, `/queue`, `/profile` | Route names differ from Plan §9; portal pages partly mockup/styling-driven |
| Tests | `app.test.ts`, `App.test.tsx`, migration tests, one Playwright spec (`public-pages.spec.ts`) | No authz matrix, queue ordering, or E2E happy path |

**Rule for the whole build:** the stack in Plan §9 is fixed. Do not swap libraries,
frameworks, or hosting during the hackathon.

---

## Phase 1 — Foundation (Plan hours 0–8)

### Step 1.1: Freeze the schema and role matrix

- [ ] Write migration `012_core_domain.ts` implementing the Plan §10 data model, adapted to
      what already exists:
  - Keep `users`, `hospitals`, `hospital_memberships`, `staff_invitations`, `patient_profiles`, `queue_entries` (already in 001–011) — extend rather than duplicate.
  - Add missing tables: `departments`, `wellness_profiles`, `appointment_slots`,
    `intake_submissions`, `documents`, `ai_intake_assessments`, `triage_decisions`,
    `referrals`, `notifications`, `audit_events`.
  - Partial: `014_admin_domain.ts` adds `departments`, `appointment_slots`, `audit_events`
    (+ `average_consultation_minutes`); remaining tables still pending.
- [x] Reconcile `hospital_services` (existing) with `departments` (plan): pick one name and
      migrate/rename so there is a single concept. Carry over `average_consultation_minutes`.
- [ ] Add hospital-scoping foreign keys everywhere: every patient-facing or clinical row
      carries `hospital_id` (directly or via `appointment_id` → `appointments.hospital_id`).
- [x] Update `migrations/run.test.ts` assertions for the new tables.

**Depends on:** nothing.
**Done when:** `npm run typecheck && npm test` passes locally and migrations run cleanly
against a fresh Neon branch/database.

### Step 1.2: Auth → local identity sync

- [ ] In `backend/src/auth.ts` / `app.ts`, after JWT validation, upsert a local `users` row
      keyed by `auth0_subject` (idempotent `GET /api/v1/me` behaviour already started — extend it).
- [ ] Enforce the Plan §4 rule: **self-sign-up always yields `patient`**. Staff roles exist
      only via `hospital_memberships` created by an invitation claim or a platform-operator seed.
- [ ] Return `{ user, memberships[], defaultRole }` from `/api/v1/me`.

**Depends on:** 1.1.
**Done when:** a fresh Auth0 sign-up produces a local user with no staff role; test added in
`app.test.ts`.

### Step 1.3: Authorization middleware (the one thing everything else uses)

- [x] Create `backend/src/authorization.ts` with:
  - `requireRole(role)` — checks `hospital_memberships` server-side.
  - `requireHospital()` — resolves hospital ID **from membership, never from the request body**.
  - `requireOwnership(loadEntity)` — patient-scoped resource guard.
- [x] Build the authorization matrix from Plan §11 as a table-driven Vitest suite:
  roles × resource × read/write → allowed/denied. This test file is the contract for every
  later phase.

**Depends on:** 1.2.
**Done when:** `authorization.test.ts` covers patient/ admin/nurse/doctor × own/other-hospital
resources, all green.

### Step 1.4: Seed data for the demo hospital

- [ ] Write `backend/src/data/seed.ts` (idempotent, runnable via an npm script):
  - One primary demo hospital + departments (emergency, general medicine, outpatient,
    maternity, paediatrics, pharmacy, radiology, laboratory collection) with
    `average_consultation_minutes`.
  - A handful of extra hospitals for the facility finder (curated subset — **not** the raw
    full-directory import; see Plan §8: curated seed is the source of truth).
  - Platform operator account, one admin, two nurses, two doctors, one demo patient.
  - Public display token row for the demo hospital.
  - Partial: `npm run seed` exists and covers demo hospital + departments + staff/patient
    memberships; extra hospitals still pending. The display token column now exists
    (migration `015_admin_settings`) and a token can be generated from the admin
    Display tab — the public `/display/:token` endpoint itself is still Step 4.5.
- [ ] Decide the external-data stance now: current import migrations (005–008) stay as-is for
      the hackathon; no new external imports during the build (Plan §12 P2 only).

**Depends on:** 1.1.
**Done when:** `npm run seed` on an empty database yields a login-ready demo hospital.

### Step 1.5: Repo hygiene

- [x] Verify `.gitignore` covers `.env`; confirm no secrets in source (Plan §12 P0.8).
- [x] Confirm `render.yaml` + GitHub Actions run `typecheck`, `lint`, `test`, `build`.

**Done when:** CI is green on a clean push.

---

## Phase 2 — Identity, roles, invitations (Plan hours 3–8)

### Step 2.1: Staff invitation flow

- [x] `POST /api/v1/admin/staff` (exists — extend): validate admin membership, generate a
      signed expiring token, store only `token_hash`, create `staff_invitations` row, write an
      `audit_events` row.
- [x] Email sending: use the provider available in the Render environment if configured;
      otherwise fall back to **returning the invite link in the admin UI** for the demo
      (label it clearly). Do not block on email infrastructure.
- [x] `POST /api/v1/invitations/claim`: authenticated user submits token → server checks
      expiry/unused, matches the invited email, creates `hospital_memberships`, marks
      `claimed_at`, audits. Never accept a role from the client body.

**Depends on:** 1.3.
**Done when:** invited email → Auth0 sign-up → claim → user sees staff UI; patient
self-sign-up cannot reach this path (test).

### Step 2.2: Frontend role routing

- [ ] Introduce a single auth/role hook in `frontend/src` (e.g. `useSession()` → user,
      role, memberships) fed by `/api/v1/me`.
- [ ] Map roles to routes:
  - Patient → `/`, `/profile`, `/book`, `/appointments/:id/intake`, `/appointments/:id/queue`
  - Nurse → `/staff/triage`, `/staff/queue`
  - Doctor → `/staff/queue`
  - Admin → `/staff/schedule`, `/staff/team`
  - Public → `/display/:hospitalToken` (no auth)
- [ ] Keep existing routes as aliases initially (the app already has `/book`, `/queue`,
      `/profile`) to avoid breaking current pages; consolidate at the end.

**Depends on:** 2.1.
**Done when:** a nurse account lands on `/staff/triage`; a patient hitting `/staff/*` is
redirected; a patient hitting another patient's `:id` sees 403/empty, not data.

---

## Phase 3 — Scheduling and booking (Plan hours 8–16)

### Step 3.1: Admin schedule management

- [x] Endpoints: CRUD for `appointment_slots` scoped to hospital+department
      (`POST /api/v1/admin/slots`, `GET /api/v1/departments` public-to-hospital).
- [x] Validate capacity ≥ 1, no overlapping duplicate slots, hospital from membership.
- [x] UI at `/staff/schedule`: pick department, day, time range, slot length, capacity.
  - Note: implemented as the **Schedule tab on `/admin`**; `/staff/schedule` route alias
    pending Step 2.2 role routing.

**Depends on:** 1.4, 2.1.
**Done when:** admin can create tomorrow's slots for General Medicine and see them listed.

### Step 3.2: Patient booking

- [ ] Harden existing `POST /api/v1/appointments` in `app.ts`:
  - Server-side capacity check **inside the transaction** (`reserved_count < capacity`) to
    prevent double-booking.
  - Status starts as `booked`; patient = authenticated owner only.
- [ ] `GET /api/v1/slots?hospital=&department=&date=` for the booking screen.
- [ ] UI at `/book`: hospital → department → date → slot → confirm. Mobile-first, low-data.

**Depends on:** 3.1.
**Done when:** two rapid bookings of the last slot → exactly one succeeds (test).

### Step 3.3: Patient home / next action

- [ ] `/` (patient home) shows the single next action from Plan §5: complete profile →
      book → do intake → check in → view queue, derived from appointment status.
- [ ] Wire existing `Dashboard`/`BookingPage` under the agreed route names.

**Depends on:** 3.2.
**Done when:** fresh user sees "complete wellness profile" or "book appointment"; booked user
sees their appointment and its next step.

---

## Phase 4 — Queue core (Plan hours 16–24) — the demo's spine

### Step 4.1: Check-in and queue entry

- [ ] `POST /api/v1/appointments/:id/check-in`:
  - Creates/updates `queue_entries` with status `awaiting_triage`, `checked_in_at = now()`
    (Plan §5 — before nurse confirmation the entry is `awaiting_triage`, not yet ordered by
    category).
  - Hospital/department derived from the appointment, not the client.
- [ ] Patient check-in screen + staff-assisted check-in (nurse can check in a booked patient).

**Depends on:** 3.2.
**Done when:** booking → check-in creates a queue row; double check-in is idempotent.

### Step 4.2: Triage confirmation (nurse)

- [ ] `GET /api/v1/staff/triage` — intakes awaiting review for the nurse's hospital/departments.
- [ ] `POST /api/v1/staff/triage/:appointmentId/confirm`:
  - Writes `triage_decisions` (`nurse_id`, `department_id`, `category`, optional
    `override_reason`, `confirmed_at`).
  - Updates `queue_entries.status = triaged_waiting`, `category = confirmed category`,
    `triaged_at = now()`.
  - **The persisted nurse-confirmed category is the only ordering input** (Plan §6).
- [ ] Category enum: `critical | very_urgent | urgent | routine`.
- [ ] UI `/staff/triage`: queue of awaiting patients; form to set category + department;
      AI suggestion (phase 6) shown separately from the confirmed value.

**Depends on:** 4.1.
**Done when:** confirming a patient as `very_urgent` moves them above `routine` patients
(queue-ordering test below passes).

### Step 4.3: Queue ordering + ETA

- [ ] Implement ordering as a single SQL query / pure function with the exact rule from Plan §6:
  1. confirmed triage category,
  2. appointment/check-in eligibility,
  3. time waiting after triage,
  4. creation time as stable tie-breaker.
  `awaiting_triage` entries sit in a separate "to triage" band; never ordered by any AI score.
- [ ] ETA heuristic: `peopleAhead × department.average_consultation_minutes`, labelled
      "Estimated wait".
- [ ] Unit tests: category precedence, tie-breaker stability, ETA maths, awaiting-triage band.

**Depends on:** 4.2, 1.4 (avg consultation minutes).
**Done when:** `queue.test.ts` covers ordering + ETA and is green.

### Step 4.4: Patient queue view + staff queue view (polling)

- [ ] `GET /api/v1/appointments/:id/queue` — **patient-safe projection only**: department,
  status, position, ETA, next instruction. Own appointment only.
- [ ] `GET /api/v1/staff/queue?department=` — staff projection with allowed fields, filtered
  by hospital membership + assigned departments.
- [ ] Frontend: poll every ~5 s (Plan §9: polling first). Show `called` → go to room,
  `in_consultation`, etc.
- [ ] UI `/appointments/:id/queue` (patient) and `/staff/queue` (nurse/doctor).

**Depends on:** 4.3.
**Done when:** two browser windows (patient + staff) show the queue updating live via polling.

### Step 4.5: Anonymized public display

- [ ] `GET /api/v1/display/:hospitalToken` — a **separate endpoint and separate response
  shape** (Plan §11: never reuse the staff endpoint). Fields limited to: anonymized ticket
  token, department name, status, position. No names, emails, IDs, diagnoses, document data.
- [ ] Verify token belongs to an active hospital; rate-limit.
- [ ] UI `/display/:hospitalToken`: large-type kiosk view, no auth, auto-refresh.

**Depends on:** 4.4.
**Done when:** display test asserts the payload contains **no** keys matching
name/email/id/diagnosis/phone patterns (Plan §13).

---

## Phase 5 — Consultation and referral (Plan hours 24–30)

### Step 5.1: Doctor actions

- [ ] `POST /api/v1/staff/queue/:id/call` → `called`, `called_at`.
- [ ] `POST /api/v1/staff/queue/:id/start` → `in_consultation`.
- [ ] `POST /api/v1/staff/queue/:id/complete` → `completed`, `completed_at`.
- [ ] All guarded by doctor/nurse membership for that hospital + department.

### Step 5.2: Internal referral

- [ ] `POST /api/v1/staff/queue/:id/referral`: create `referrals` row, mark current entry
  `referred`, and create a **new** `queue_entries` row in the receiving department
  (starting at `awaiting_triage` or `triaged_waiting` with the carried-over category —
  decide once, document in code, test it).
- [ ] Patient sees the new department + instruction on their queue page.

**Depends on:** 4.4, 5.1.
**Done when:** doctor completes one patient and refers another; the referred patient's
position appears in the target department queue and on their own page.

### Step 5.3: In-app notifications (P1 but cheap here)

- [ ] `notifications` writes on: booking confirmed, called, referral created, alert raised.
- [ ] `GET /api/v1/notifications` + unread badge in the patient top bar.

**Depends on:** 5.1.
**Done when:** referral produces an in-app notification for the patient.

### Step 5.4: Authorization + queue test sweep

- [ ] Finish the Plan §13 backend test list for everything built so far (capacity,
  ordering, ownership, isolation, public display).
- [ ] Run the full Playwright happy path skeleton (Step 8.1).

---

## Phase 6 — AI-assisted intake (Plan hours 30–36, only after P0 stable)

> Gate: do not start until Phases 1–5 are demoable end-to-end. Plan §16 risk: scope overload.

### Step 6.1: Wellness profile + consent (P1 prerequisite)

- [ ] Extend `patient_profiles`/`wellness_profiles` endpoints (profile GET/PUT exist — add
  conditions, allergies, medications, notes, emergency contact, DOB).
- [ ] Store explicit `consented_at` for AI/document processing; block AI routes without it.
- [ ] UI `/profile`: plain-language consent copy, save action.

### Step 6.2: Intake submission

- [ ] `POST /api/v1/appointments/:id/intake` — symptom answers JSON + `consented_at`.
  Uploads optional; missing document must not block booking (Plan §5).
- [ ] UI `/appointments/:id/intake`: short questionnaire + optional upload entry point +
  consent checkbox + "This is not a diagnosis. A nurse will review your information."

### Step 6.3: AI suggestion service

- [ ] New module `backend/src/ai/intake.ts`:
  - Input: symptom answers (+ document text when present) + **fixed department list of the
    selected hospital**.
  - Output: strict JSON schema validated server-side:
    `{ summary, suggested_department_id, suggested_category, red_flags[], sources[] }`.
  - Prompt version + model version stored on `ai_intake_assessments`.
  - Timeout + failure → **fallback path**: no assessment row, patient goes to normal
    `awaiting_triage`, nurse routes manually (Plan §7).
- [ ] Red-flag ruleset: small, clinician-approved, code-reviewed list (severe chest pain,
  breathing difficulty, stroke symptoms, major bleeding, unconsciousness, severe allergic
  reaction) matched on answers **before/alongside** the model call — deterministic.
- [ ] Store nurse override + reason on `triage_decisions` for audit.

**Depends on:** 6.1, 6.2, 4.2.
**Done when:** unit test with a mocked model verifies schema validation, department
constraining, and the AI-unavailable fallback.

### Step 6.4: Nurse review card

- [ ] `/staff/triage` shows: AI summary, suggested department/category clearly labelled
  **"AI suggestion"**, red-flag reasons, and separate controls for the confirmed values.
- [ ] Confirm → Step 4.2 flow unchanged (AI never reorders the queue by itself — test this).

### Step 6.5: Emergency red-flag path

- [ ] On red-flag match: API returns emergency guidance payload + creates `critical_alert`
  queue state / `notifications` alert for triage staff.
- [ ] Patient UI shows immediate emergency instructions — **no ETA, no normal queue
  next-step** (Plan §5, test in Plan §13).
- [ ] Nurse sees high-visibility alert, acknowledges (record ack), category `critical`.

**Depends on:** 6.3.
**Done when:** E2E/unit test proves critical path suppresses ETA messaging and raises an alert.

---

## Phase 7 — Documents (Plan hours 36–41, only if P0/P1 stable)

### Step 7.1: Storage provider choice

- [ ] Pick one before writing code (Plan §9): Render-disk is not acceptable for private
  object storage — use S3-compatible bucket (e.g. Cloudflare R2 / AWS S3) with
  **presigned upload and download URLs**. Record the choice in `docs/`.
- [ ] Never store file bytes in Postgres; store `storage_key` + metadata + audit rows.

### Step 7.2: Upload pipeline

- [ ] `POST /api/v1/intake/:id/documents` → presigned upload URL.
- [ ] Validate type/size: PDF, JPG, JPEG, PNG only; reject others server-side.
- [ ] Private download: `GET /api/v1/documents/:id` → short-lived presigned URL, ownership
  or clinical-role check, `audit_events` write on every access.
- [ ] UI: upload control on the intake screen with progress + failure state.

### Step 7.3: Text extraction + summary (OCR is P2 — skip if time-boxed)

- [ ] Digital PDFs: extract text server-side; images → OCR only if time allows.
- [ ] Feed minimum relevant text to the AI service from Step 6.3; show source snippets in
  the nurse review card.

**Done when:** a fictional lab-report PDF uploads, appears on the nurse card as an extracted
summary, and access is audited.

---

## Phase 8 — Testing and E2E (parallel from Phase 5, hardening in hours 41–45)

### Step 8.1: Playwright critical path

- [ ] Extend `e2e/tests/` with the Plan §13 flow:
  1. patient signs up + books,
  2. submits symptoms + checks in,
  3. nurse confirms routing/urgency,
  4. patient queue position + public display update,
  5. doctor completes or refers.
- [ ] Use seeded accounts + a `npm run seed` reset between runs.

### Step 8.2: Test matrix completion

- [ ] Backend: authorization matrix, invitation expiry/claim, capacity/double-booking,
  queue ordering/tie-break, cross-patient isolation, nurse-gated AI routing, critical-alert
  ETA suppression, public-display anonymization.
- [ ] Frontend: booking/check-in state, queue ETA + empty/error states, nurse UI distinguishing
  AI suggestion from confirmed triage, public screen anonymity (Vitest + Testing Library).
- [ ] `npm run test` green at workspace level.

**Done when:** all Plan §13 items have a matching test.

---

## Phase 9 — Deployment and demo rehearsal (Plan hours 41–48)

### Step 9.1: Production deployment

- [ ] Vercel frontend, Render API, Neon production DB — run migrations, run seed.
- [ ] Configure Auth0 redirect/logout URLs for the deployed frontend; API JWKS/audience env vars.
- [ ] Confirm no secrets in source; all config via environment (Plan §12 P0.8).
- [ ] GitHub Actions green on `main`.

### Step 9.2: Demo rehearsal (Plan §15 narrative)

- [ ] Walk the full 7-step narrative twice, timed, with the fallback recording captured.
- [ ] Warm the Render service before the demo (cold-start risk, Plan §16).
- [ ] Reset seed data to a clean state between rehearsals.

### Step 9.3: Freeze

- [ ] Hours 45–48: bug fixes only. No new features. Deployment freeze before the pitch.

---

## Priority gates (from Plan §12)

- **P0 — must work before demo:** Steps 1.1–1.5, 2.1–2.2, 3.1–3.3, 4.1–4.5, 5.1–5.2, 9.1.
- **P1 — after P0 is stable:** 6.1, 6.2–6.4, 6.5, 5.3, 7.1–7.2.
- **P2 — stretch only:** 7.3 OCR, WhatsApp notifications, SSE/WebSocket live updates,
  external directory import, second demo hospital + cross-hospital referral.

**Freeze rule:** nothing from P2 starts until P0 is demoable and P1 items on the critical
narrative are in. If time runs out, cut in this order: documents → OCR → WhatsApp →
live push → external data.

---

## Standing engineering rules

1. **Hospital isolation:** every hospital-scoped query filters by hospital ID derived from
   server-side membership (Plan §11). No client-provided hospital ID is trusted.
2. **Patient ownership:** patients read/write only their own rows; enforced by
   `requireOwnership`, tested every phase.
3. **AI never decides:** nurse confirmation is required before any AI output affects a normal
   queue; critical red flags bypass normal ETA messaging instead of reordering it.
4. **Public display is a separate projection** — separate endpoint, separate response shape,
   tested for zero identifiers.
5. **Consent before processing:** no AI/document processing without a stored consent timestamp.
6. **Audit everything staff does:** membership changes, triage overrides, document access,
   alert acknowledgements → `audit_events`.
7. **No secrets in the repo;** no PII/clinical data in logs, URLs, or analytics.
