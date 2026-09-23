import { expect, test } from '@playwright/test';

test.skip(!process.env.VITE_AUTH0_DOMAIN, 'Requires configured Auth0 and Neon test environment');

test('shows the NovaCare sign-in entry point', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
