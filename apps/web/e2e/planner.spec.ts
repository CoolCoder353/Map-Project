import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page, email = 'admin@demo.test', password = 'demo password') {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/directions/);
}

async function pick(page: Page, label: string, query: string, option: string) {
  const box = page.getByRole('combobox', { name: label });
  await box.click();
  await box.fill(query);
  await page.getByRole('option', { name: new RegExp(option) }).click();
}

test('plan fastest and explore routes, send one to the phone', async ({ page }) => {
  await signIn(page);
  await pick(page, 'Starting point', 'Braddon', 'Braddon');
  await pick(page, 'Destination', 'Lanyon', 'Lanyon Homestead');
  const fastest = page.getByRole('list', { name: 'Fastest route' });
  await expect(fastest.getByText('Fastest')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ways you haven’t been' }).getByRole('listitem')).not.toHaveCount(0);
  await expect(page).toHaveURL(/from=.*to=.*mode=car/);

  await page.getByRole('button', { name: /Explore 1/ }).click();
  await page.getByRole('button', { name: 'Send to phone' }).click();
  await expect(page.getByRole('status').getByText(/Planned routes/)).toBeVisible();

  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByText(/Explore to Lanyon Homestead/)).toBeVisible();

  // Back returns to the same trip, not a blank planner.
  await page.getByRole('button', { name: 'Back to map' }).click();
  await expect(page).toHaveURL(/\/directions\?from=.*to=.*mode=car/);
  await expect(fastest.getByText('Fastest')).toBeVisible();
});

test('coverage stats, trip replay, and deleting a trip', async ({ page }) => {
  await signIn(page, 'sam@demo.test');
  await page.getByRole('link', { name: 'Coverage' }).click();
  await expect(page.getByText('Roads travelled')).toBeVisible();
  await expect(page.getByText(/km of road travelled/)).toBeVisible();

  await page.getByRole('link', { name: 'Trips' }).click();
  const trips = page.locator('a.trip-row');
  await expect(trips.first()).toBeVisible();
  const before = await trips.count();
  expect(before).toBeGreaterThan(0);
  await trips.first().click();
  await expect(page.getByRole('slider', { name: 'Replay position' })).toBeVisible();
  await page.getByRole('button', { name: 'Play replay' }).click();
  await page.getByRole('button', { name: 'Delete trip' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete trip' }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(trips).toHaveCount(before - 1);
});

test('discover and round trip panels return results', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Round trip' }).click();
  await pick(page, 'Start', 'Kingston', 'Kingston');
  await page.getByRole('button', { name: 'Make loops' }).click();
  await expect(page.getByRole('list', { name: 'Loops' }).getByRole('listitem').first()).toBeVisible();

  await page.getByRole('link', { name: 'Discover' }).click();
  await pick(page, 'Search from', 'Braddon', 'Braddon');
  await page.getByRole('slider', { name: /Within/ }).fill('120');
  await page.getByRole('button', { name: 'Find places' }).click();
  await expect(page.locator('.place-list li').first()).toBeVisible();
});

test('the start field fills itself in when the browser already allows location', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['geolocation'], geolocation: { longitude: 149.135, latitude: -35.271 }, locale: 'en-AU' });
  const page = await ctx.newPage();
  await signIn(page);
  await expect(page.getByRole('combobox', { name: 'Starting point' })).toHaveValue('Your location');
  // Still empty for a browser that hasn't granted location.
  const plain = await (await browser.newContext()).newPage();
  await signIn(plain);
  await expect(plain.getByRole('combobox', { name: 'Starting point' })).toHaveValue('');
  await ctx.close();
});
