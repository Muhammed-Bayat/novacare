import { expect, test } from '@playwright/test';

test.skip(!process.env.VITE_AUTH0_DOMAIN, 'Requires configured Auth0 and Neon test environment');

test('shows the public landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Simple, Trusted Healthcare for Everyone' })).toBeVisible();
});

test('links every landing tab to a section that exists', async ({ page }) => {
  await page.goto('/');
  const tabs: [string, string][] = [
    ['Home', '#top'],
    ['Services', '#services'],
    ['Appointments', '#appointments'],
    ['Support', '#support'],
    ['Contact', '#contact'],
  ];
  for (const [name, href] of tabs) {
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    await expect(page.locator(href)).toHaveCount(1);
  }
});

test('offers the Auth0 sign-in entry point on /signin', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
});

test('redirects the removed dashboard route to the landing page', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Simple, Trusted Healthcare for Everyone' })).toBeVisible();
});
