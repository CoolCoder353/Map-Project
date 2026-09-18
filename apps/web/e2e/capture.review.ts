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
    test.setTimeout(180_000);
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

    // Search suggestions, settings back button, feedback form and inbox.
    await page.goto('/directions?from=149.13500,-35.27100,Braddon&mode=car');
    const dest = page.getByRole('combobox', { name: 'Destination' });
    await dest.click();
    await dest.fill('Woolworths');
    await expect(page.getByRole('option', { name: /Woolworths Dickson/ })).toBeVisible();
    await page.screenshot({ path: `${OUT}/search${suffix}.png` });
    await page.goto('/settings');
    await settle(page);
    await page.screenshot({ path: `${OUT}/settings${suffix}.png` });
    await page.goto('/admin/settings');
    const toggle = page.getByRole('switch', { name: /User feedback/ });
    if (!(await toggle.isChecked())) await toggle.check();
    await page.screenshot({ path: `${OUT}/admin-settings${suffix}.png`, fullPage: true });
    await page.goto(TRIP);
    await expect(page.getByRole('list', { name: 'Fastest route' })).toBeVisible();
    await settle(page);
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.getByRole('menuitem', { name: 'Send feedback' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send feedback' });
    await dialog.getByRole('textbox').fill('The explore route disappeared after I swapped start and end.');
    await page.screenshot({ path: `${OUT}/feedback-dialog${suffix}.png` });
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog).toBeHidden();
    await page.goto('/admin/feedback');
    await expect(page.locator('.feedback-message-cell a').first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/admin-feedback${suffix}.png`, fullPage: true });
    await page.locator('.feedback-message-cell a').first().click();
    await expect(page.getByRole('img', { name: 'Screenshot sent with the report' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/admin-feedback-detail${suffix}.png`, fullPage: true });
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
  await page.goto('/coverage');
  await settle(page);
  await page.screenshot({ path: `${OUT}/mobile-coverage.png` });
  await page.goto('/admin/users');
  await settle(page);
  await page.screenshot({ path: `${OUT}/mobile-admin.png`, fullPage: true });
  await ctx.close();
});
