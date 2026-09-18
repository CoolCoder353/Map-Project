import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page, email: string, password = 'demo password') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/directions/);
}

const openAccountMenu = (page: Page) => page.getByRole('button', { name: /^Account:/ }).click();

test('admin turns feedback on → user reports a bug with a screenshot → admin triages it, audited → off again', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin@demo.test');
  await admin.goto('/admin/settings');
  const toggle = admin.getByRole('switch', { name: /User feedback/ });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(admin.getByText(/Feedback is on/)).toBeVisible();

  const sam = await (await browser.newContext()).newPage();
  await signIn(sam, 'sam@demo.test');
  await openAccountMenu(sam);
  await sam.getByRole('menuitem', { name: 'Send feedback' }).click();
  const dialog = sam.getByRole('dialog', { name: 'Send feedback' });
  await expect(dialog).toBeVisible();
  // The screen was captured before the form opened.
  await expect(dialog.getByRole('img', { name: 'Screenshot that will be sent' })).toBeVisible();
  await dialog.getByLabel('What went wrong?').fill('The explore route disappeared after I swapped start and end.');
  await dialog.getByLabel(/Include what the map is showing/).check();
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(sam.getByText('Thanks — your feedback was sent.')).toBeVisible();
  await expect(dialog).toBeHidden();

  await admin.goto('/admin/feedback');
  await expect(admin.getByLabel('1 new')).toBeVisible();
  await admin.getByRole('link', { name: /explore route disappeared/ }).click();
  await expect(admin.getByRole('heading', { name: 'Bug report' })).toBeVisible();
  await expect(admin.getByRole('img', { name: 'Screenshot sent with the report' })).toBeVisible();
  await expect(admin.getByText(/zoom \d/)).toBeVisible(); // the map view Sam chose to share
  await admin.getByLabel('Status').selectOption('planned');
  await expect(admin.getByText('Saved')).toBeVisible();
  await admin.getByLabel(/Notes/).fill('Reproduced in Firefox.');
  await admin.getByRole('button', { name: 'Save notes' }).click();

  await admin.goto('/admin/audit');
  await expect(admin.getByText('feedback.view').first()).toBeVisible();
  await expect(admin.getByText('feedback.update').first()).toBeVisible();

  await admin.goto('/admin/settings');
  await admin.getByRole('switch', { name: /User feedback/ }).uncheck();
  await expect(admin.getByText(/Feedback is off/)).toBeVisible();
  // Reports are refused straight away; the menu item goes once the cached config expires
  // (up to a minute), so check with a fresh browser.
  const later = await (await browser.newContext()).newPage();
  await signIn(later, 'sam@demo.test');
  await openAccountMenu(later);
  await expect(later.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(later.getByRole('menuitem', { name: 'Send feedback' })).toHaveCount(0);
});

test('search suggestions say what and where each place is, and how far', async ({ page }) => {
  await signIn(page, 'sam@demo.test');
  const start = page.getByRole('combobox', { name: 'Starting point' });
  await start.click();
  await start.fill('Braddon');
  await page.getByRole('option', { name: /Braddon/ }).first().click();
  const dest = page.getByRole('combobox', { name: 'Destination' });
  await dest.click();
  await dest.fill('Woolworths');
  const option = page.getByRole('option', { name: /Woolworths Dickson/ });
  await expect(option).toContainText('Supermarket · Dickson ACT 2602 · 2.');
  await expect(option).toContainText('Open 24 hours');
});
