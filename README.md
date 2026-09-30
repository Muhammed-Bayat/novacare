# NovaCare

NovaCare is a production platform foundation: a React 18 SPA authenticated by Auth0, an Express 5 API, and a Neon PostgreSQL database.

## Live services

- Frontend: https://novacare-seven.vercel.app
- API health: https://novacare-api-lgyh.onrender.com/health
- Source: https://github.com/Muhammed-Bayat/novacare

## Repository layout

- `frontend`: Vite React SPA deployed to Vercel.
- `backend`: Express API and TypeScript PostgreSQL migrations deployed to Render.
- `e2e`: Playwright end-to-end scaffold.
- `.github/workflows/ci.yml`: GitHub Actions quality checks.

## Local development

Prerequisites: Node.js 22+ and npm. Copy `frontend/.env.example` to `frontend/.env` and `backend/.env.example` to `backend/.env`; enter values from the Auth0 and Neon setup phases. Never commit either `.env` file.

Install dependencies from the repository root:

```bash
npm install
```

Run database migrations after `DATABASE_URL` is configured:

```bash
npm --workspace @novacare/backend run migrate
```

### Showcase patients

The showcase patient seed creates only synthetic patient users, today's bookings, and today's clinical queues for one explicitly named hospital. Preview the exact plan first:

```bash
npm --workspace @novacare/backend run seed:showcase-patients -- --hospital-name="Helen Joseph Hospital" --dry-run
```

Apply requires both the hospital ID and plan fingerprint printed by that dry-run:

```bash
npm --workspace @novacare/backend run seed:showcase-patients -- --hospital-name="Helen Joseph Hospital" --apply --confirm-hospital=<hospital-id> --confirm-plan=<plan-fingerprint>
```

Repeated apply commands are no-ops while an active run exists. Preview or execute a complete cleanup with:

```bash
npm --workspace @novacare/backend run seed:showcase-patients -- --hospital-name="Helen Joseph Hospital" --rollback --dry-run --run-id=<run-id>
npm --workspace @novacare/backend run seed:showcase-patients -- --hospital-name="Helen Joseph Hospital" --rollback --run-id=<run-id> --confirm-hospital=<hospital-id>
```

Use `seed:showcase-patients:prod` instead after compiling the backend. These commands are manual and are never part of application startup.

Start the API and SPA in separate terminals:

```bash
npm --workspace @novacare/backend run dev
npm --workspace @novacare/frontend run dev
```

The API health endpoint is `http://localhost:4000/health`. The protected endpoints are `GET /api/v1/me`, which synchronizes the authenticated user, and `GET /api/v1/sample`.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Install the Playwright browser once, then run E2E tests after local Auth0 and Neon values are configured:

```bash
npm --workspace @novacare/e2e run test:install
npm --workspace @novacare/e2e test
```

## Deployment

### Render API

Use `render.yaml` or create a Node web service with root directory `backend`, build command `npm install --include=dev && npm run build`, and start command `npm run start`. The start command safely runs compiled migrations before starting Express. Configure `DATABASE_URL`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `CORS_ORIGINS`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `BREVO_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL`, and `PLATFORM_OVERSEER_EMAIL` in Render, never in the repository. `GEMINI_API_KEY` remains server-side; never add it as a `VITE_*` variable.

Run `npm --workspace @novacare/backend run gemini:check` during local setup or deployment diagnostics to verify that the explicitly configured `GEMINI_MODEL` supports `generateContent` for the configured key. This diagnostic is never called during a patient assessment.

### Vercel SPA

Import the GitHub repository with root directory `frontend`. Vercel uses `frontend/vercel.json` to rewrite SPA routes to `index.html`. Configure `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, and `VITE_API_BASE_URL` in Vercel.

### Auth0 and Neon

Auth0 must have an SPA application using Authorization Code Flow with PKCE and an API whose identifier is `AUTH0_AUDIENCE`. The API validates Auth0 access tokens with the issuer JWKS. Neon provides the pooled, SSL-enabled `DATABASE_URL`; it is only configured on the backend. Each account's `users.user_type` (`patient`, `staff`, or `admin`) decides which portal the SPA opens after sign-in; new accounts default to `patient` and are promoted with SQL in Neon.

## Launch checklist

- Confirm GitHub Actions is green on `main` before each deployment.
- Keep `DATABASE_URL` only in Neon-connected server environments; never expose it to Vercel or commit it.
- Keep Auth0 callback URLs, logout URLs, web origins, and `CORS_ORIGINS` synchronized when adding a domain.
- Upgrade the Render Free instance before serving production users; Free instances spin down and have no production SLA.
- NovaCare currently uses the shared Athlora Auth0 development tenant. Before a fully isolated production launch, move to a dedicated production tenant or approved custom domain.
- Review Neon backup, spending, access, and retention settings before storing real user data.
