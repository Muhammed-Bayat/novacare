import { expect, test } from '@playwright/test';

test.skip(!process.env.VITE_AUTH0_DOMAIN, 'Requires configured Auth0 and Neon test environment');

test('shows the public landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Simple, Trusted Healthcare for Everyone' })).toBeVisible();
});

test('shows the Auth0 sign-in entry point on the dashboard route', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
