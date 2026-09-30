# NovaCare — Manual E2E Test Plan

Execution order: **P0 first** (the critical path a real user hits on day one), then P1, P2, P3.
Mark each checkbox as you go. Log failures with the test ID.

| Priority | Meaning |
|---|---|
| **P0** | Critical path — app is not shippable if any of these fail |
| **P1** | Core features — main value of the product |
| **P2** | Secondary features and role-specific workflows |
| **P3** | Edge cases, authz negatives, non-functional, known quirks |

---

## Phase 0 — Setup (once, before any test)

- [ ] Copy `frontend/.env.example` → `frontend/.env`, `backend/.env.example` → `backend/.env`, `e2e/.env.example` → `e2e/.env` (local values already exist for Auth0/Neon/Brevo/Gemini).
- [ ] **Boot gotcha**: `npm --workspace @novacare/backend run dev` runs `server.ts`, which throws unless `AT_CALLBACK_SECRET` and `AT_USSD_SERVICE_CODE` are set (`backend/src/server.ts:13-14`). Add dummy values to `backend/.env` if missing.
- [ ] `npm install`
- [ ] `npm --workspace @novacare/backend run migrate`
- [ ] `npm --workspace @novacare/backend run seed`
- [ ] `npm --workspace @novacare/backend run seed:dispatch`
- [ ] Start API (`:4000`) and SPA (`:5173`) in separate terminals.
- [ ] Verify `GET http://localhost:4000/health` → `{"status":"ok"}`.

### Test accounts (required for P0)

Seed rows use `seed|<email>` Auth0 subjects and never match a real login (`synchronizeUser` matches `auth0_subject` only — `backend/src/app.ts:371`). Either create Auth0 users with the seed emails, or after each account's **first sign-in** run in Neon:

```sql
SELECT id FROM hospitals WHERE name='NovaCare Demo Hospital';

INSERT INTO hospital_memberships (user_id, hospital_id, role)
SELECT u.id, '<hospitalId>', 'nurse'   -- or administrator / doctor / dispatcher
FROM users u WHERE lower(u.email)='you@example.com'
ON CONFLICT (user_id, hospital_id) DO UPDATE SET role = EXCLUDED.role, active = true;
```

Accounts needed:

| Role | Portal | Notes |
|---|---|---|
| patient | `/patient` | fresh Auth0 account, no membership |
| nurse | `/staff` | membership `nurse` |
| doctor | `/doctor` | membership `doctor` |
| administrator | `/admin` | membership `administrator` |
| dispatcher | `/dispatcher` | membership `dispatcher` |
| platform overseer | `/overseer` | Auth0 account email == `PLATFORM_OVERSEER_EMAIL` (auto-granted, `app.ts:383`) |

---

# P0 — Critical path (do first)

## P0-1 — Smoke & public pages
- [ ] **P0-1.1** Open `/` → landing renders: "Simple, Trusted Healthcare for Everyone", hero, 4 service cards, nav tabs each scroll to their section (Home → top, Services → service cards, Appointments → 3 booking steps, Support → help cards, Contact → contact details) and the active tab underline follows the section in view.
- [ ] **P0-1.2** Open `/signin` unauthenticated → "Sign in to NovaCare" + Sign In button.
- [ ] **P0-1.3** Open `/dashboard`, `/admin-portal`, `/care/admin`, `/foo` → all redirect to `/` landing.
- [ ] **P0-1.4** `GET :4000/health` → `ok`; `GET :4000/api/v1/me` without token → `401`.

## P0-2 — Authentication & role routing
- [ ] **P0-2.1** Landing → Sign In → Auth0 → callback → lands back at origin, calls `/api/v1/me`, redirects by role: patient→`/patient`, nurse→`/staff`, doctor→`/doctor`, admin→`/admin`, dispatcher→`/dispatcher`, operator→`/overseer`.
- [ ] **P0-2.2** Anonymous visit to `/patient`, `/admin`, `/dispatcher`, `/care` → shell + inline sign-in card, no crash, no auto-redirect.
- [ ] **P0-2.3** Wrong-role access: `/staff` as patient, `/admin` as nurse, `/dispatcher` as patient → bounced to `/`.
- [ ] **P0-2.4** Logout from patient portal → Auth0 logout → origin; re-visiting `/patient` shows sign-in card.

## P0-3 — Patient books an appointment
- [ ] **P0-3.1** `/patient` → Appointments → search hospital by name/area/service → results, "closest 3", map renders (`hospital-map`).
- [ ] **P0-3.2** Select hospital → service tag → tomorrow's date → 09:00 → **Confirm booking** → "Appointment booked" card, auto-returns ~2.8 s, appears in Upcoming.
- [ ] **P0-3.3** Dashboard shows the next appointment; empty state correct when none.
- [ ] **P0-3.4** Booking with no service selected → Confirm disabled; date/time outside 07:00–19:00 blocked by the form.
- [ ] **P0-3.5** Duplicate booking same department/date/time → `409 SLOT_UNAVAILABLE` surfaced as an error alert.
- [ ] **P0-3.6** Reschedule → "Appointment updated"; Cancel → moves to Cancelled; Rebook → "Appointment rebooked", back to Upcoming.

## P0-4 — Queue & check-in
- [ ] **P0-4.1** Patient → "Join today's queue" → "You're in the queue"; queue card shows position, status, est. wait.
- [ ] **P0-4.2** Book an appointment for **today** → Appointments shows **Check in** only for today's date → check in succeeds → status becomes checked-in, queue entry created.
- [ ] **P0-4.3** Check in again → `409 ALREADY_CHECKED_IN` error surfaced.

## P0-5 — Nurse triage → doctor completes (staff flow)
- [ ] **P0-5.1** Sign in as nurse → Triage tab shows the checked-in patient (department, urgency, red flags).
- [ ] **P0-5.2** Confirm triage → card moves to the queue; patient portal reflects the urgency badge (15 s poll).
- [ ] **P0-5.3** Queue tab → **Call** → patient status "Please proceed"; **Start consultation** → in consultation.
- [ ] **P0-5.4** Sign in as doctor → **Record diagnosis** (empty disabled; with diagnosis + notes) → **Complete** → patient's "My health" view shows the diagnosis.

## P0-6 — Admin can set up the hospital
- [ ] **P0-6.1** `/admin` Overview → KPI tiles + per-department rows.
- [ ] **P0-6.2** Departments → add a department → it appears in the list **and** in the patient booking service list.
- [ ] **P0-6.3** Schedule → create slots (dept, tomorrow, 09:00–11:00, 30 min) → "Created N slots…"; overlapping re-run → `409 SLOTS_EXIST`.
- [ ] **P0-6.4** Hospital team → invite an email as nurse → success + claim link box + **Copy link**; pending invitation row appears.
- [ ] **P0-6.5** Display tab → Generate link → open `/display/<token>` in an incognito window → public kiosk renders queues, **no patient names**.

---

# P1 — Core features

## P1-1 — AI intake (patient)
- [ ] **P1-1.1** Dashboard → intake chat; submit disabled under 4 chars; anonymous submit redirects to sign-in.
- [ ] **P1-1.2** Symptom "chest pain" → answer yes/no, scale, and text turns → recommendation with department, urgency card, red flags, source badge (`Gemini` or `Local fallback`).
- [ ] **P1-1.3** "Book at a recommended hospital" / "Book here" → booking form pre-selected with hospital/service → completes booking.
- [ ] **P1-1.4** With `GEMINI_API_KEY` removed → `Local fallback` badge + AI-unavailable notice, no broken UI.

## P1-2 — Emergency / home-visit service requests (patient)
- [ ] **P1-2.1** Emergency tab → ambulance submit with empty fields → validation alerts (reason, consciousness, location).
- [ ] **P1-2.2** Type an address → resolve → **confirm** the matching candidate → send → success `role=status` with reference code; row appears in "Your requests" (15 s poll).
- [ ] **P1-2.3** Address that never resolves → "Send for location review" → request created in dispatcher Unresolved.
- [ ] **P1-2.4** Home-visit variant (reason + responder + location) → created with correct type/status.
- [ ] **P1-2.5** Persistent banners always visible: "For testing only…" and "call 10177 or 112".

## P1-3 — Dispatcher lifecycle
- [ ] **P1-3.1** Sign in as dispatcher with a pending request → metrics cards + live pill "Live updates" (SSE).
- [ ] **P1-3.2** `DISPATCHER_LOCATION_REVIEW` request → manual resolve form (address/lat/lng) → location set.
- [ ] **P1-3.3** Notified facility → **Acknowledge** / **Unavailable** → row status changes.
- [ ] **P1-3.4** ACKNOWLEDGED → **Accept** → **Assign facility** → **Assign unit/responder** → status timeline grows each step.
- [ ] **P1-3.5** Mark en route → Arrived → Start care → Complete (forward button label changes; terminal state sticks).
- [ ] **P1-3.6** Cancel: empty reason disabled; with reason → CANCELLED + reason recorded.
- [ ] **P1-3.7** Administrator on `/dispatcher` → read-only view, actions replaced by "Read-only administrator view".
- [ ] **P1-3.8** Unresolved (n) tab count matches review-state requests.

## P1-4 — Invitation claim
- [ ] **P1-4.1** Open claim URL as invited email, unauthenticated → Auth0 login first → claim executes → correct portal.
- [ ] **P1-4.2** Claim the same token again → `400 INVITATION_UNAVAILABLE` → invalid-link state, sessionStorage cleared.
- [ ] **P1-4.3** Claim with a different Auth0 email than invited → `400 INVITATION_UNAVAILABLE`.
- [ ] **P1-4.4** Expired token (`expires_at = now() - interval '1 day'`) → `400 INVITATION_UNAVAILABLE`.
- [ ] **P1-4.5** Claim an admin/dispatcher invite on a deactivated membership → reactivated, correct portal.

## P1-5 — Public display kiosk
- [ ] **P1-5.1** Valid token → per-service cards "Now serving #n", urgency-coloured waiting tickets, clock every 30 s, queues refresh every 10 s.
- [ ] **P1-5.2** `/display/bogus-token` → error alert, no crash.
- [ ] **P1-5.3** Rotate the link in admin → old token stops working, new one works.

---

# P2 — Secondary features

## P2-1 — Patient extras
- [ ] **P2-1.1** Geolocation denied → "Location access is blocked" alert, booking still possible; "Near me" re-prompts.
- [ ] **P2-1.2** Profile chip → change display name → Save → banner updates and persists after reload (`novaCareDisplayName`).
- [ ] **P2-1.3** "Leave queue" removes the entry; queue status labels cycle correctly (In queue → Please proceed → Awaiting nurse review → In consultation).
- [ ] **P2-1.4** Check-in a tomorrow appointment via API → `400 CHECK_IN_NOT_OPEN`.

## P2-2 — Nurse/doctor extras
- [ ] **P2-2.1** Refer: empty reason → submit disabled; with reason → patient appears in the target department's queue.
- [ ] **P2-2.2** Empty queue state → "The queue is empty…".
- [ ] **P2-2.3** Critical/emergency count banner shows on the triage board.

## P2-3 — Admin extras
- [ ] **P2-3.1** Edit a department (name/minutes), Deactivate → Reactivate; deactivated department not bookable.
- [ ] **P2-3.2** Remove a department with no slots → succeeds; one with slots → `409 DEPARTMENT_IN_USE`, button disabled with tooltip.
- [ ] **P2-3.3** Remove an unbooked slot → deleted; booked slot → `SLOT_BOOKED` / disabled.
- [ ] **P2-3.4** Manage team member (role change, Active toggle) → persists in list.
- [ ] **P2-3.5** Turn display off → kiosk stops; audit log records activation/rotation **without the token value**.
- [ ] **P2-3.6** Activity tab → last-50 labelled audit events, includes everything from P2-3, scoped to this hospital only.
- [ ] **P2-3.7** Invite with Brevo misconfigured → claim link still shown in admin UI, invitation still claimable.

## P2-4 — i18n (patient portal only)
- [ ] **P2-4.1** Language → isiZulu → headings/buttons/placeholders translate; the Language label itself stays "Language"; `document.documentElement.lang=zu`.
- [ ] **P2-4.2** Switch back to English → originals restored, no double-translation.
- [ ] **P2-4.3** Reload → language + translations persist (`novaCareLanguage`, `novaCareTranslations:zu`).
- [ ] **P2-4.4** Switch language on Appointments/Emergency views → new nodes translate; `data-no-translate` request rows stay English.
- [ ] **P2-4.5** Unsupported stored language code → falls back to English.

## P2-5 — Overseer
- [ ] **P2-5.1** Sign in as platform overseer → `/overseer` hospital search loads; access panel opens.
- [ ] **P2-5.2** Assign administrator by email → message + claim URL + Copy link; "Sending invitation…" busy state.
- [ ] **P2-5.3** Non-operator visiting `/overseer` → redirected to `/`.

---

# P3 — Edge cases, authz, non-functional

## P3-1 — API negative / authz (curl with a real Bearer token from devtools)
- [ ] **P3-1.1** `GET /api/v1/admin/overview` with patient token → `403`.
- [ ] **P3-1.2** `GET /api/v1/staff/queue` with patient token; `/api/v1/dispatcher/service-requests` with nurse token → `403`.
- [ ] **P3-1.3** Patient A `PATCH`/`DELETE` patient B's appointment id → `404 APPOINTMENT_NOT_FOUND`.
- [ ] **P3-1.4** Tampered/expired Auth0 token on `/api/v1/me` → `401`.
- [ ] **P3-1.5** `GET /api/v1/admin/slots?date=31-12-2026` → `400 INVALID_DATE`; bad department → `404 DEPARTMENT_NOT_FOUND`.
- [ ] **P3-1.6** `GET /api/v1/admin/audit?limit=abc` → `200` with 50 rows (clamped 1–100).
- [ ] **P3-1.7** USSD/SMS callback with wrong secret → `403 CALLBACK_FORBIDDEN`.
- [ ] **P3-1.8** `GET /api/v1/display/<valid>` unauthenticated → `200` anonymized JSON.
- [ ] **P3-1.9** Malformed JSON / >100 kb body → **500 `INTERNAL_ERROR`** (known quirk — see below).
- [ ] **P3-1.10** Request from an origin not in `CORS_ORIGINS` → CORS rejection (shows as 500 in API log).

## P3-2 — Non-functional
- [ ] **P3-2.1** Polling: patient/staff/dispatcher views refresh every 15 s with no duplicate rows (network tab).
- [ ] **P3-2.2** Data isolation: patient A never sees patient B's appointments, queue, or requests.
- [ ] **P3-2.3** Public display shows no names/emails/phone numbers.
- [ ] **P3-2.4** Responsive check at 1440 / 1024 / 768 / 375 px on `/`, `/patient`, `/admin`, `/dispatcher`.
- [ ] **P3-2.5** Kill the API with a portal open → error card/alert, no white screen; SSE pill → "Reconnecting…" → "Polling every 15 s", recovers on restart.
- [ ] **P3-2.6** No kiosk token appears anywhere in `/api/v1/admin/audit`.
- [ ] **P3-2.7** `npm run lint && npm run typecheck && npm test && npm run build` green from the repo root.

---

## Known issues — record as "known", not new bugs

1. **Slot capacity is never enforced** — `POST /api/v1/appointments` ignores `appointment_slots`; booking a date/time with no published slot returns `201`. `reserved_count` is never written, so it always reads `0`.
2. Past-date `booked` appointments silently disappear from `GET /api/v1/appointments`.
3. Check-in is date-only — allowed at any hour on the day, even before the slot time.
4. Malformed JSON, oversized bodies, and CORS rejections surface as `500` instead of 4xx.
5. The slot-overlap probe misses windows that *start before* an existing slot (overlapping slots can coexist).
6. Seeded `seed|<email>` users cannot log in until the Auth0 subject is linked (Phase 0).
7. Legacy `/care`, `/book`, `/queue`, `/profile`, `/overseer` pages render unstyled — `src/styles.css` is never imported.
8. Playwright e2e (`e2e/tests/public-pages.spec.ts`) only covers 3 unauthenticated smoke tests and skips entirely without env vars; CI does not install browsers, so e2e is a no-op in CI.
