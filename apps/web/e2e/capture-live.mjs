/**
 * Capture review screenshots against a REAL stack (Docker: api on :3000 with built tiles).
 * Start a Vite dev server pointed at it first:
 *   WAYFINDER_API=http://127.0.0.1:3000 pnpm --filter @wayfinder/web exec vite --port 5175 --strictPort
 * then:
 *   node e2e/capture-live.mjs http://localhost:5175 admin@example.com 'password'
 */
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5175', email, password] = process.argv.slice(2);
if (!email || !password) throw new Error('usage: capture-live.mjs <baseUrl> <email> <password>');
const OUT = '.impeccable/review';
const TRIP = '/directions?from=149.13500,-35.27100,Braddon&to=149.08480,-35.49170,Lanyon%20Homestead&mode=car';

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const suffix = scheme === 'light' ? '' : '-dark';
  await page.goto(`${base}/sign-in`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/directions/);
  await page.goto(base + TRIP);
  await page.getByRole('list', { name: 'Fastest route' }).waitFor();
  await page.waitForTimeout(6000); // let real tiles finish loading
  await page.screenshot({ path: `${OUT}/live-routes${suffix}.png` });
  await page.goto(`${base}/coverage`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/live-coverage${suffix}.png` });
  await ctx.close();
}
await browser.close();
console.log('captured live-routes/live-coverage (light + dark)');
