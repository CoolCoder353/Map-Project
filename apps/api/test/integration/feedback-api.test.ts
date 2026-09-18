import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminService } from '@wayfinder/core';
import { type TestApp, createTestApp, makeUser, tokenFor } from '../helpers/app.js';

// A real 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const context = { screen: '/directions', platform: 'web', appVersion: '0.1.0', device: 'Firefox on Linux' };

let ta: TestApp;
let admin: { id: string };
let dev: { id: string };
let sam: { id: string };
let alex: { id: string };
const auth = async (u: { id: string }, role: 'user' | 'dev' | 'admin' = 'user') => ({ authorization: await tokenFor(ta, u, role) });
const send = async (u: { id: string }, body: Record<string, unknown>) =>
  ta.app.inject({ method: 'POST', url: '/api/feedback', headers: await auth(u), payload: { type: 'bug', message: 'The route line vanished', context, ...body } });

beforeAll(async () => {
  ta = await createTestApp();
  admin = await makeUser(ta.t.db, 'admin@example.com', 'admin');
  dev = await makeUser(ta.t.db, 'dev@example.com', 'dev');
  sam = await makeUser(ta.t.db, 'sam@example.com', 'user');
  alex = await makeUser(ta.t.db, 'alex@example.com', 'user');
});
afterAll(() => ta?.close());

describe('user feedback', () => {
  let reportId: string;

  it('is off by default: the config says so and reports are refused', async () => {
    expect((await ta.app.inject({ method: 'GET', url: '/api/config' })).json().feedbackEnabled).toBe(false);
    const res = await send(sam, {});
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('feedback_disabled');
  });

  it('an admin switches it on; users can then send a report with a screenshot', async () => {
    const on = await ta.app.inject({ method: 'PATCH', url: '/api/admin/app-settings', headers: await auth(admin, 'admin'), payload: { feedbackEnabled: true } });
    expect(on.statusCode).toBe(200);
    expect((await ta.app.inject({ method: 'GET', url: '/api/config' })).json().feedbackEnabled).toBe(true);
    const res = await send(sam, { screenshot: { mediaType: 'image/png', data: PNG }, context: { ...context, mapView: { center: [149.13, -35.28], zoom: 12 } } });
    expect(res.statusCode, res.body).toBe(201);
    reportId = res.json().id;
  });

  it('rejects screenshots that are not images and messages that are too short', async () => {
    expect((await send(alex, { screenshot: { mediaType: 'image/png', data: Buffer.from('not an image').toString('base64') } })).statusCode).toBe(400);
    expect((await send(alex, { message: 'x' })).statusCode).toBe(400);
    const huge = Buffer.alloc(2 * 1024 * 1024 + 10, 1).toString('base64');
    expect((await send(alex, { screenshot: { mediaType: 'image/png', data: huge } })).statusCode).toBe(400);
  });

  it('allows five reports an hour per person', async () => {
    for (let i = 0; i < 5; i++) expect((await send(alex, { type: 'idea', message: `Idea number ${i}` })).statusCode).toBe(201);
    const sixth = await send(alex, { message: 'One more thing' });
    expect(sixth.statusCode).toBe(429);
    expect((await send(sam, { message: 'Sam is not limited by Alex' })).statusCode).toBe(201);
  });

  it('dev can read reports and screenshots (audited) but not change them', async () => {
    const list = await ta.app.inject({ method: 'GET', url: '/api/admin/feedback?type=bug', headers: await auth(dev, 'dev') });
    expect(list.statusCode).toBe(200);
    const mine = list.json().items.find((i: { id: string }) => i.id === reportId);
    expect(mine).toMatchObject({ type: 'bug', status: 'new', hasScreenshot: true, user: { email: 'sam@example.com' } });
    expect(mine.context.mapView).toEqual({ center: [149.13, -35.28], zoom: 12 });
    expect(list.json().newCount).toBeGreaterThanOrEqual(7);
    expect((await ta.app.inject({ method: 'GET', url: `/api/admin/feedback/${reportId}`, headers: await auth(dev, 'dev') })).statusCode).toBe(200);
    const shot = await ta.app.inject({ method: 'GET', url: `/api/admin/feedback/${reportId}/screenshot`, headers: await auth(dev, 'dev') });
    expect(shot.headers['content-type']).toBe('image/png');
    expect(shot.rawPayload.equals(Buffer.from(PNG, 'base64'))).toBe(true);
    const patch = await ta.app.inject({ method: 'PATCH', url: `/api/admin/feedback/${reportId}`, headers: await auth(dev, 'dev'), payload: { status: 'done' } });
    expect(patch.statusCode).toBe(403);
    expect((await ta.app.inject({ method: 'GET', url: '/api/admin/feedback', headers: await auth(sam) })).statusCode).toBe(404);
  });

  it('admin triages: status and notes, then delete with confirmation, each audited', async () => {
    const admins = await auth(admin, 'admin');
    const patch = await ta.app.inject({ method: 'PATCH', url: `/api/admin/feedback/${reportId}`, headers: admins, payload: { status: 'planned', adminNotes: 'Seen on Firefox only' } });
    expect(patch.json()).toMatchObject({ status: 'planned', adminNotes: 'Seen on Firefox only' });
    expect((await ta.app.inject({ method: 'GET', url: '/api/admin/feedback?status=planned', headers: admins })).json().items.map((i: { id: string }) => i.id)).toEqual([reportId]);
    expect((await ta.app.inject({ method: 'DELETE', url: `/api/admin/feedback/${reportId}`, headers: admins, payload: { confirm: 'yes' } })).statusCode).toBe(400);
    expect((await ta.app.inject({ method: 'DELETE', url: `/api/admin/feedback/${reportId}`, headers: admins, payload: { confirm: 'DELETE' } })).statusCode).toBe(200);
    expect((await ta.app.inject({ method: 'GET', url: `/api/admin/feedback/${reportId}`, headers: admins })).statusCode).toBe(404);
    const actions = (await ta.app.inject({ method: 'GET', url: '/api/admin/audit?action=feedback.&limit=50', headers: admins })).json().items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['feedback.view', 'feedback.update', 'feedback.delete']));
  });

  it('turning it off stops new reports but keeps existing ones', async () => {
    await ta.app.inject({ method: 'PATCH', url: '/api/admin/app-settings', headers: await auth(admin, 'admin'), payload: { feedbackEnabled: false } });
    expect((await send(sam, { message: 'Still there?' })).statusCode).toBe(404);
    expect((await ta.app.inject({ method: 'GET', url: '/api/admin/feedback', headers: await auth(admin, 'admin') })).json().items.length).toBeGreaterThan(0);
  });

  it('purging a deleted account removes its reports', async () => {
    await ta.t.db.query(`UPDATE users SET deleted_at = now() - interval '8 days' WHERE id = $1`, [alex.id]);
    await adminService.purgeDeleted(ta.t.db);
    expect((await ta.t.db.query('SELECT count(*)::int AS n FROM feedback WHERE user_id = $1', [alex.id])).rows[0].n).toBe(0);
  });
});
