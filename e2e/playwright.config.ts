import { defineConfig, devices } from '@playwright/test';

const frontendUrl = 'http://localhost:5174';
const backendUrl = 'http://localhost:4100';
const configured = Boolean(
  process.env.DATABASE_URL &&
  process.env.VITE_AUTH0_DOMAIN &&
  process.env.VITE_AUTH0_CLIENT_ID &&
  process.env.VITE_AUTH0_AUDIENCE,
);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: frontendUrl, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: configured ? [
    {
      command: 'npm --prefix ../backend run dev',
      url: `${backendUrl}/health`,
      timeout: 120_000,
      env: { ...process.env, PORT: '4100', CORS_ORIGINS: frontendUrl },
    },
    {
      command: 'npm --prefix ../frontend run dev -- --host localhost --port 5174 --strictPort',
      url: frontendUrl,
      timeout: 120_000,
      env: { ...process.env, VITE_API_BASE_URL: backendUrl },
    },
  ] : undefined,
});
