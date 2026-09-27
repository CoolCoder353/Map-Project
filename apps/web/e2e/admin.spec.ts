import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/directions/);
}

test('invite → register → promote to dev → dev is read-only → admin deletes and restores a trip; all audited', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin@demo.test', 'demo password');
  await admin.goto('/admin/invites');
  await admin.getByLabel('Note (optional)').fill('for Riley');
  await admin.getByRole('button', { name: 'Create' }).click();
  const code = (await admin.locator('.created-codes code').first().textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const riley = await (await browser.newContext()).newPage();
  await riley.goto(`/register?code=${code}`);
  await riley.getByLabel('Email').fill('riley@demo.test');
  await riley.getByLabel('Password').fill('riley password 1');
  await riley.getByRole('button', { name: 'Create account' }).click();
  await expect(riley).toHaveURL(/\/directions/);

  await admin.goto('/admin/users');
  await admin.getByRole('link', { name: 'riley@demo.test' }).click();
  await admin.getByRole('combobox').first().selectOption('dev');
  const dialog = admin.getByRole('dialog');
  await dialog.getByRole('textbox').fill('riley@demo.test');
  await dialog.getByRole('button', { name: 'Change role' }).click();
  await expect(admin.getByText('Dev (read-only dashboard)')).toBeVisible();

  // Promotion signed Riley out; sign in again and check the dashboard is view-only.
  await signIn(riley, 'riley@demo.test', 'riley password 1');
  await riley.goto('/admin/users');
  await expect(riley.getByText('Dev (read-only)')).toBeVisible();
  await riley.getByRole('link', { name: 'sam@demo.test' }).click();
  await expect(riley.getByRole('button', { name: 'Delete account' })).toHaveCount(0);
  await riley.goto('/admin/invites');
  await expect(riley.getByRole('button', { name: 'Create' })).toHaveCount(0);

  // Admin deletes one of Sam's trips and restores it.
  await admin.goto('/admin/users');
  await admin.getByRole('link', { name: 'sam@demo.test' }).click();
  await admin.getByRole('button', { name: 'Delete trip' }).first().click();
  await admin.getByRole('dialog').getByRole('textbox').fill('DELETE');
  await admin.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(admin.getByText('Trip deleted. Restorable for 7 days.')).toBeVisible();
  await admin.goto('/admin/deleted');
  await admin.getByRole('button', { name: 'Restore' }).first().click();
  await expect(admin.getByText(/Trip restored/)).toBeVisible();

  await admin.goto('/admin/audit');
  for (const label of ['Created invites', 'Changed role', 'Deleted trip', 'Restored trip', 'Viewed trips']) {
    await expect(admin.getByRole('cell', { name: label }).first()).toBeVisible();
  }
});

test('app name and voice changes reach the sign-in page', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin@demo.test', 'demo password');
  await admin.goto('/admin/settings');
  await admin.getByLabel('App name').fill('Fogline');
  await admin.getByLabel(/Playful explorer/).check();
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(admin.getByText(/Saved/)).toBeVisible();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/sign-in');
  await expect(visitor.getByRole('heading', { name: 'Welcome back to Fogline' })).toBeVisible();
  await expect(visitor).toHaveTitle('Fogline');

  // The first save's toast lasts 5 s; a quick visitor check leaves it up beside the second one.
  await expect(admin.getByText(/Saved/)).toBeHidden();
  await admin.getByLabel('App name').fill('Wayfinder');
  await admin.getByLabel(/Plain and friendly/).check();
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(admin.getByText(/Saved/)).toBeVisible();
});

test('plain users cannot reach the dashboard', async ({ page }) => {
  await signIn(page, 'alex@demo.test', 'demo password');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/directions/);
  const res = await page.request.get('/api/admin/users');
  expect(res.status()).toBe(401); // no bearer token on raw requests; with one it is 404 (API tests)
});
