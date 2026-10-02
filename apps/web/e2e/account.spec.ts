import { type Browser, type Page, expect, test } from '@playwright/test';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/directions/);
}

/** A fresh account, registered through an invite the demo admin creates. */
async function newAccount(browser: Browser, email: string, password: string) {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin@demo.test', 'demo password');
  await admin.goto('/admin/invites');
  await admin.getByRole('button', { name: 'Create' }).click();
  const code = (await admin.locator('.created-codes code').first().textContent())!.trim();
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await page.goto(`/register?code=${code}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/directions/);
  return { admin, page };
}

test('a wrong password is refused, and a deep link survives signing in', async ({ page }) => {
  await page.goto('/coverage');
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel('Email').fill('sam@demo.test');
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Password').fill('demo password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/coverage$/);
  await expect(page.getByText('km of road travelled')).toBeVisible();
});

test('settings persist, data downloads, and signing out ends the session', async ({ browser }) => {
  const { page } = await newAccount(browser, 'jo@demo.test', 'jo password 12');
  await page.getByRole('button', { name: /Account:/ }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('radiogroup', { name: 'Default travel mode' }).getByRole('radio', { name: 'Walk' }).click();
  // The switch shows the saved setting, so it flips once the server has it.
  await page.getByRole('switch').click();
  await expect(page.getByRole('switch')).toBeChecked();
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Default travel mode' }).getByRole('radio', { name: 'Walk' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch')).toBeChecked();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^wayfinder-export-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8'));
  expect(data.user.email).toBe('jo@demo.test');
  expect(data.travelledRoads.type).toBe('FeatureCollection');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto('/trips');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('an admin’s reset link sets a new password; the old one stops working', async ({ browser }) => {
  const { admin } = await newAccount(browser, 'kai@demo.test', 'kai password 1');
  await admin.goto('/admin/users');
  await admin.getByRole('link', { name: 'kai@demo.test' }).click();
  await admin.getByRole('button', { name: 'Password reset link' }).click();
  const link = (await admin.locator('code.copyable').textContent())!.trim();
  const url = new URL(link);

  const kai = await (await browser.newContext()).newPage();
  await kai.goto(url.pathname + url.search);
  await kai.getByLabel('New password').fill('kai new password');
  await kai.getByRole('button', { name: 'Save password' }).click();
  await expect(kai.getByRole('heading', { name: 'Password changed' })).toBeVisible();
  await kai.goto('/sign-in');
  await kai.getByLabel('Email').fill('kai@demo.test');
  await kai.getByLabel('Password').fill('kai password 1');
  await kai.getByRole('button', { name: 'Sign in' }).click();
  await expect(kai.getByRole('alert')).toBeVisible();
  await signIn(kai, 'kai@demo.test', 'kai new password');
  // The link works once.
  await kai.goto(url.pathname + url.search);
  await kai.getByLabel('New password').fill('another password');
  await kai.getByRole('button', { name: 'Save password' }).click();
  await expect(kai.getByRole('alert')).toBeVisible();
});

test('deleting your account signs you out and stops sign-in; an admin can restore it', async ({ browser }) => {
  const { page, admin } = await newAccount(browser, 'lee@demo.test', 'lee password 1');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  await expect(dialog.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  await dialog.getByRole('textbox').fill('lee@demo.test');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel('Email').fill('lee@demo.test');
  await page.getByLabel('Password').fill('lee password 1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await admin.goto('/admin/deleted');
  await admin.getByRole('row', { name: /lee@demo.test/ }).getByRole('button', { name: 'Restore' }).click();
  await expect(admin.getByText('Account restored.')).toBeVisible();
  // Having signed out (by deleting), the next sign-in starts at Directions, not back in Settings.
  await page.getByLabel('Password').fill('lee password 1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/directions$/);
});

test('the privacy policy and deletion pages open without signing in', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
  await page.getByRole('link', { name: 'how to delete your account' }).click();
  await expect(page).toHaveURL(/\/delete-account$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Delete your account' })).toBeVisible();
  // Settings needs an account: the link asks for sign-in first.
  await page.getByRole('link', { name: 'Sign in and open Settings' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});
