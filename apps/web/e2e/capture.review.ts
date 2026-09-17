/** Screenshot capture for design review (not a test suite): CAPTURE=1 pnpm e2e --grep @capture */
import { type Page, expect, test } from '@playwright/test';

const OUT = '.impeccable/review';
const TRIP = '/directions?from=149.13500,-35.27100,Braddon&to=149.08480,-35.49170,Lanyon%20Homestead&mode=car';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('admin@demo.test');
  await page.getByLabel('Password').fill('demo password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/directions/);
}

const settle = (page: Page) => page.waitForTimeout(1800);

for (const scheme of ['light', 'dark'] as const) {
  test(`@capture desktop ${scheme}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const suffix = scheme === 'light' ? '' : '-dark';
    await page.goto('/sign-in');
    await settle(page);
    await page.screenshot({ path: `${OUT}/signin${suffix}.png` });
    await signIn(page);
    await page.goto(TRIP);
    await expect(page.getByRole('list', { name: 'Fastest route' })).toBeVisible();
    await page.getByRole('button', { name: /Explore 1/ }).click();
    await settle(page);
    await page.screenshot({ path: `${OUT}/desktop${suffix}.png` });
    await page.goto('/coverage');
    await settle(page);
    await page.screenshot({ path: `${OUT}/coverage${suffix}.png` });
    await page.goto('/admin');
    await settle(page);
    await page.screenshot({ path: `${OUT}/admin-overview${suffix}.png`, fullPage: true });
    await page.goto('/admin/performance');
    await settle(page);
    await page.screenshot({ path: `${OUT}/admin-performance${suffix}.png`, fullPage: true });
    await ctx.close();
  });
}

test('@capture mobile', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(TRIP);
  await expect(page.getByRole('list', { name: 'Fastest route' })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/mobile.png` });
  await page.goto('/admin/users');
  await settle(page);
  await page.screenshot({ path: `${OUT}/mobile-admin.png`, fullPage: true });
  await ctx.close();
});
