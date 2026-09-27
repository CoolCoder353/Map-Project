import { expect, test } from '@playwright/test';

const PAGES: Array<[string, string]> = [
  ['/admin', 'Overview'],
  ['/admin/performance', 'Performance'],
  ['/admin/errors', 'Errors'],
  ['/admin/jobs', 'Jobs & data'],
  ['/admin/usage', 'Usage'],
  ['/admin/users', 'Users'],
  ['/admin/feedback', 'Feedback'],
  ['/admin/invites', 'Invite codes'],
  ['/admin/audit', 'Audit log'],
  ['/admin/deleted', 'Recently deleted'],
  ['/admin/settings', 'App settings'],
];

test('every dashboard page loads its data without errors', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('admin@demo.test');
  await page.getByLabel('Password').fill('demo password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/directions/);
  // From here on, any failed API call or script error is a failure.
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) problems.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  for (const [path, title] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  // Seeded data shows up where it should.
  await page.goto('/admin/users');
  await expect(page.getByRole('link', { name: 'sam@demo.test' })).toBeVisible();
  await page.goto('/admin/errors');
  await expect(page.getByText('Routing engine unreachable: connect ECONNREFUSED', { exact: true })).toBeVisible();
  await page.goto('/admin/jobs');
  await expect(page.getByText('(demo data)')).toBeAttached();
  expect(problems).toEqual([]);
});

test('the side menu reaches every page and back to the map', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('admin@demo.test');
  await page.getByLabel('Password').fill('demo password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/directions/);
  await page.goto('/admin');
  const nav = page.getByRole('navigation', { name: 'Admin' });
  for (const [path, title] of PAGES.slice(1)) {
    await nav.getByRole('link', { name: new RegExp(`^${title}`) }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  await page.getByRole('link', { name: 'Back to the map' }).click();
  await expect(page).toHaveURL(/\/directions/);
});
