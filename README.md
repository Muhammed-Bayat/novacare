# NovaCare

NovaCare is a production-ready platform foundation: a React 18 SPA authenticated by Auth0, an Express 5 API, and a Neon PostgreSQL database.

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

Use `render.yaml` or create a Node web service with root directory `backend`, build command `npm install --include=dev && npm run build`, and start command `npm run start`. The start command safely runs compiled migrations before starting Express. Configure `DATABASE_URL`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, and `CORS_ORIGINS` in Render, never in the repository.

### Vercel SPA

Import the GitHub repository with root directory `frontend`. Vercel uses `frontend/vercel.json` to rewrite SPA routes to `index.html`. Configure `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, and `VITE_API_BASE_URL` in Vercel.

### Auth0 and Neon

Auth0 must have an SPA application using Authorization Code Flow with PKCE and an API whose identifier is `AUTH0_AUDIENCE`. The API validates Auth0 access tokens with the issuer JWKS. Neon provides the pooled, SSL-enabled `DATABASE_URL`; it is only configured on the backend.
