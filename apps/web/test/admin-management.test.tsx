import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsPage } from '../src/admin/pages/AppSettingsPage';
import { AuditPage } from '../src/admin/pages/AuditPage';
import { DeletedPage } from '../src/admin/pages/DeletedPage';
import { FeedbackDetailPage, FeedbackPage } from '../src/admin/pages/FeedbackPage';
import { InvitesPage } from '../src/admin/pages/InvitesPage';
import { UserDetailPage } from '../src/admin/pages/UserDetailPage';
import { UsersPage } from '../src/admin/pages/UsersPage';
import { type Routes, apiError } from './fakeApi';
import { adminUser, adminUserDetail, auditEntry, deletedItems, feedbackItem, invite, trip, tripDetail, user } from './fixtures';
import { renderApp, where } from './harness';

const admin = user({ id: 'u-admin', role: 'admin', email: 'admin@example.test' });
const dev = user({ id: 'u-dev', role: 'dev', email: 'dev@example.test' });

const clipboard = { writeText: vi.fn(async () => undefined) };
beforeEach(() => Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true }));
afterEach(() => clipboard.writeText.mockClear());

describe('Users', () => {
  it('lists users with status, and searches and filters from the first page', async () => {
    const users = [adminUser(), adminUser({ id: 'u-3', email: 'off@example.test', role: 'dev', disabledAt: '2026-09-02T00:00:00.000Z' }), adminUser({ id: 'u-4', email: 'gone@example.test', role: 'admin', deletedAt: '2026-09-03T00:00:00.000Z', settings: { trackingEnabled: false, defaultMode: 'car', exploreBudgetMin: 15 } })];
    const { api } = await renderApp(<UsersPage />, { path: '/admin/users', user: admin, api: { 'GET /api/admin/users': () => ({ items: users, total: 120 }) } });
    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('alex@example.test');
    expect(rows[1]).toHaveTextContent('Active');
    expect(rows[1]).toHaveTextContent('345');
    expect(rows[2]).toHaveTextContent('Dev Disabled');
    expect(rows[3]).toHaveTextContent('Admin Deleted');
    expect(screen.getByText('1–50 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.calls('GET /api/admin/users').at(-1)!.query.get('offset')).toBe('50'));
    await userEvent.type(screen.getByPlaceholderText('Search by email'), 'al');
    await waitFor(() => expect(Object.fromEntries(api.calls('GET /api/admin/users').at(-1)!.query)).toMatchObject({ q: 'al', offset: '0' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Disabled');
    await waitFor(() => expect(api.calls('GET /api/admin/users').at(-1)!.query.get('status')).toBe('disabled'));
    await userEvent.click(screen.getByRole('link', { name: 'alex@example.test' }));
    expect(where()).toBe('/admin/users/u-2');
  });

  it('says when nobody matches', async () => {
    await renderApp(<UsersPage />, { path: '/admin/users', user: admin, api: { 'GET /api/admin/users': () => ({ items: [], total: 0 }) } });
    expect(await screen.findByText('No users match.')).toBeInTheDocument();
  });
});

describe('User detail', () => {
  const detailApi = (over: Routes = {}): Routes => ({
    'GET /api/admin/users/u-2': () =>
      adminUserDetail({}, [
        { id: 's-1', createdAt: '2026-09-20T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, userAgent: 'Wayfinder Android' },
        { id: 's-2', createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-02T00:00:00.000Z', revokedAt: null, userAgent: null },
        { id: 's-3', createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: '2026-09-03T00:00:00.000Z', userAgent: 'Firefox' },
      ]),
    'GET /api/admin/users/u-2/trips': () => ({ items: [trip()] }),
    ...over,
  });
  const open = (api: Routes = {}, me = admin, id = 'u-2') => renderApp(<UserDetailPage />, { path: `/admin/users/${id}`, pattern: '/admin/users/:id', user: me, api: detailApi(api) });

  it('shows the account, their trips and sessions, and draws a chosen trip', async () => {
    const { map } = await open({ 'GET /api/admin/users/u-2/trips/t-1': () => tripDetail() });
    expect(await screen.findByRole('heading', { name: 'alex@example.test' })).toBeInTheDocument();
    expect(screen.getByText('Roads travelled').nextSibling).toHaveTextContent('345');
    expect(screen.getByText('Default mode').nextSibling).toHaveTextContent('Walk');
    const sessions = screen.getByRole('heading', { name: 'Sessions' }).closest('section')!;
    expect(within(sessions).getAllByRole('row').map((r) => r.textContent)).toEqual([expect.any(String), expect.stringContaining('Active'), expect.stringContaining('Expired'), expect.stringContaining('Ended')]);
    await userEvent.click(await screen.findByRole('button', { name: /Drive · 18 km · 3 new/ }));
    await waitFor(() => expect(map.fitTo).toHaveBeenCalled());
    expect(map.setMarkers).toHaveBeenLastCalledWith([expect.objectContaining({ kind: 'start' }), expect.objectContaining({ kind: 'end' })]);
  });

  it('changes a role only after typing their email', async () => {
    const { api } = await open({ 'PATCH /api/admin/users/u-2': () => ({ ok: true }) });
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Role' }), 'dev');
    const dialog = screen.getByRole('dialog', { name: 'Change role to dev?' });
    expect(dialog).toHaveTextContent('can’t change anything');
    await userEvent.type(within(dialog).getByLabelText(/to confirm/), 'alex@example.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change role' }));
    expect(await screen.findByText('Role changed. Their sessions were signed out.')).toBeInTheDocument();
    expect(api.calls('PATCH /api/admin/users/u-2')[0]!.body).toEqual({ role: 'dev', confirm: 'alex@example.test' });
  });

  it('disables, signs out everywhere, rebuilds coverage and makes a reset link', async () => {
    const { api } = await open({
      'PATCH /api/admin/users/u-2': () => ({ ok: true }),
      'POST /api/admin/users/u-2/revoke-sessions': () => ({ ok: true }),
      'POST /api/admin/users/u-2/coverage/rebuild': () => ({ ok: true }),
      'POST /api/admin/users/u-2/reset-password-link': () => ({ url: 'https://maps.example.test/reset-password?token=t0k3n', expiresAt: '2026-09-28T00:00:00.000Z' }),
    });
    await userEvent.click(await screen.findByRole('button', { name: /Disable/ }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Disable this account?' })).getByRole('button', { name: 'Disable' }));
    expect(await screen.findByText('Account disabled and signed out.')).toBeInTheDocument();
    expect(api.calls('PATCH /api/admin/users/u-2')[0]!.body).toEqual({ disabled: true });
    await userEvent.click(screen.getByRole('button', { name: /Sign out everywhere/ }));
    expect(await screen.findByText('All sessions signed out.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Rebuild coverage/ }));
    expect(await screen.findByText('Coverage rebuild queued.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Password reset link/ }));
    expect(await screen.findByText('https://maps.example.test/reset-password?token=t0k3n')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(clipboard.writeText).toHaveBeenCalledWith('https://maps.example.test/reset-password?token=t0k3n');
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
  });

  it('enables a disabled account', async () => {
    const { api } = await open({
      'GET /api/admin/users/u-2': () => adminUserDetail({ disabledAt: '2026-09-02T00:00:00.000Z' }),
      'PATCH /api/admin/users/u-2': () => ({ ok: true }),
    });
    await userEvent.click(await screen.findByRole('button', { name: /Enable/ }));
    expect(await screen.findByText('Account enabled.')).toBeInTheDocument();
    expect(api.calls('PATCH /api/admin/users/u-2')[0]!.body).toEqual({ disabled: false });
  });

  it('deletes an account after typing the email, and shows a refusal', async () => {
    const { api } = await open({ 'DELETE /api/admin/users/u-2': () => apiError(409, 'last_admin', 'Can’t delete the last admin') });
    await userEvent.click(await screen.findByRole('button', { name: /Delete account/ }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this account?' });
    await userEvent.type(within(dialog).getByLabelText(/to confirm/), 'alex@example.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByText('Can’t delete the last admin')).toBeInTheDocument();
    expect(api.calls('DELETE /api/admin/users/u-2')[0]!.body).toEqual({ confirm: 'alex@example.test' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deletes one of their trips after typing DELETE', async () => {
    const { api } = await open({ 'DELETE /api/admin/users/u-2/trips/t-1': () => ({ ok: true }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete trip' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this trip?' });
    await userEvent.type(within(dialog).getByLabelText(/to confirm/), 'DELETE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Trip deleted. Restorable for 7 days.')).toBeInTheDocument();
    expect(api.calls('DELETE /api/admin/users/u-2/trips/t-1')[0]!.body).toEqual({ confirm: 'DELETE' });
  });

  it('offers only restore for a deleted account', async () => {
    const { api } = await open({
      'GET /api/admin/users/u-2': () => adminUserDetail({ deletedAt: '2026-09-25T00:00:00.000Z' }),
      'POST /api/admin/users/u-2/restore': () => ({ ok: true }),
    });
    await userEvent.click(await screen.findByRole('button', { name: /Restore account/ }));
    expect(await screen.findByText('Account restored.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disable/ })).not.toBeInTheDocument();
    expect(api.calls('POST /api/admin/users/u-2/restore')).toHaveLength(1);
  });

  it('won’t let an admin change their own role or status', async () => {
    await renderApp(<UserDetailPage />, {
      path: '/admin/users/u-admin',
      pattern: '/admin/users/:id',
      user: admin,
      api: { 'GET /api/admin/users/u-admin': () => adminUserDetail({ id: 'u-admin', email: 'admin@example.test', role: 'admin' }), 'GET /api/admin/users/u-admin/trips': () => ({ items: [] }) },
    });
    expect(await screen.findByRole('combobox', { name: 'Role' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Disable/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete account/ })).toBeDisabled();
    expect(screen.getByText('You can’t change your own role or status here.')).toBeInTheDocument();
    expect(screen.getByText('No trips.')).toBeInTheDocument();
  });

  it('is read-only for devs', async () => {
    await open({}, dev);
    await screen.findByRole('heading', { name: 'alex@example.test' });
    expect(screen.queryByRole('combobox', { name: 'Role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete trip' })).not.toBeInTheDocument();
  });

  it('shows a missing user', async () => {
    await open({ 'GET /api/admin/users/u-2': () => apiError(404, 'not_found', 'User not found') });
    expect(await screen.findByRole('alert')).toHaveTextContent('User not found');
  });
});

describe('Invites', () => {
  const invitesApi = (over: Routes = {}): Routes => ({
    'GET /api/admin/invites': () => ({ items: [invite(), invite({ code: 'USED-0000-0000', status: 'used', usedByEmail: 'alex@example.test', usedAt: '2026-09-02T00:00:00.000Z', expiresAt: null, note: null, createdBy: null })] }),
    ...over,
  });

  it('creates codes with an expiry, role and note, and copies them', async () => {
    const { api } = await renderApp(<InvitesPage />, { path: '/admin/invites', user: admin, api: invitesApi({ 'POST /api/admin/invites': () => ({ codes: ['NEW1-NEW1-NEW1', 'NEW2-NEW2-NEW2'] }) }) });
    await userEvent.clear(screen.getByLabelText('How many'));
    await userEvent.type(screen.getByLabelText('How many'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Expires'), 'Never');
    await userEvent.selectOptions(screen.getByLabelText('Account role'), 'Dev');
    expect(screen.getByText('Whoever uses these codes gets read-only dashboard access.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Note (optional)'), '  for Jo  ');
    await userEvent.click(screen.getByRole('button', { name: /Create/ }));
    const created = await screen.findByText('New codes:');
    expect(created.parentElement).toHaveTextContent('NEW1-NEW1-NEW1');
    expect(api.calls('POST /api/admin/invites')[0]!.body).toEqual({ count: 2, expiresInDays: null, note: 'for Jo', roleOnSignup: 'dev' });
    await userEvent.click(within(created.parentElement!).getAllByRole('button', { name: /Link/ })[0]!);
    expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/register?code=NEW1-NEW1-NEW1`);
    expect(await screen.findByText('Sign-up link copied.')).toBeInTheDocument();
  });

  it('lets the count be cleared and retyped; an empty count sends one', async () => {
    const { api } = await renderApp(<InvitesPage />, { path: '/admin/invites', user: admin, api: invitesApi({ 'POST /api/admin/invites': () => ({ codes: ['X'] }) }) });
    const count = screen.getByLabelText('How many');
    await userEvent.clear(count);
    expect(count).toHaveValue(null);
    await userEvent.type(count, '5');
    await userEvent.click(screen.getByRole('button', { name: /Create/ }));
    await screen.findByText('New codes:');
    await userEvent.clear(count);
    await userEvent.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => expect(api.calls('POST /api/admin/invites').map((r) => (r.body as { count: number }).count)).toEqual([5, 1]));
  });

  it('lists codes, filters by status and revokes unused ones', async () => {
    const { api } = await renderApp(<InvitesPage />, { path: '/admin/invites', user: admin, api: invitesApi({ 'POST /api/admin/invites/ABCD-EFGH-JKLM/revoke': () => ({ ok: true }) }) });
    const used = await screen.findByRole('row', { name: /USED-0000-0000/ });
    expect(used).toHaveTextContent('alex@example.test');
    expect(used).toHaveTextContent('Never');
    expect(within(used).queryByRole('button')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke ABCD-EFGH-JKLM' }));
    await waitFor(() => expect(api.calls('POST /api/admin/invites/ABCD-EFGH-JKLM/revoke')).toHaveLength(1));
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'Unused');
    await waitFor(() => expect(api.calls('GET /api/admin/invites').at(-1)!.query.get('status')).toBe('unused'));
  });

  it('lets devs copy links but not create or revoke', async () => {
    await renderApp(<InvitesPage />, { path: '/admin/invites', user: dev, api: invitesApi() });
    await screen.findByRole('row', { name: /ABCD-EFGH-JKLM/ });
    expect(screen.queryByRole('heading', { name: 'Create codes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy sign-up link for ABCD-EFGH-JKLM' }));
    expect(clipboard.writeText).toHaveBeenCalled();
  });

  it('shows a failed create', async () => {
    await renderApp(<InvitesPage />, { path: '/admin/invites', user: admin, api: invitesApi({ 'POST /api/admin/invites': () => apiError(400, 'validation', 'Too many codes') }) });
    await userEvent.click(screen.getByRole('button', { name: /Create/ }));
    expect(await screen.findByText('Too many codes')).toBeInTheDocument();
  });
});

describe('Audit log', () => {
  it('names actions, actors and targets', async () => {
    await renderApp(<AuditPage />, {
      path: '/admin/audit',
      user: admin,
      api: {
        'GET /api/admin/audit': () => ({
          items: [
            auditEntry(),
            auditEntry({ id: 'a-2', actorId: null, actorEmail: null, action: 'user.create_admin', targetId: null, details: { email: 'x' } }),
            auditEntry({ id: 'a-3', actorEmail: null, actorId: 'abcdef1234567890', action: 'custom.thing', targetType: 'invite', targetId: 'CODE' }),
          ],
        }),
      },
    });
    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('admin@example.testViewed tripsUser u-2-aaaa');
    expect(rows[2]).toHaveTextContent('System / CLICreated admin (CLI)–{"email":"x"}');
    expect(rows[3]).toHaveTextContent('abcdef12custom.thingCODE');
    await userEvent.click(within(rows[1]!).getByRole('link'));
    expect(where()).toBe('/admin/users/u-2-aaaaaaaa');
  });

  it('filters by kind', async () => {
    const { api } = await renderApp(<AuditPage />, { path: '/admin/audit', user: admin, api: { 'GET /api/admin/audit': () => ({ items: [] }) } });
    expect(await screen.findByText('Nothing logged yet.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Filter by action'), 'Invites');
    await waitFor(() => expect(api.calls('GET /api/admin/audit').at(-1)!.query.get('action')).toBe('invite.'));
  });
});

describe('Recently deleted', () => {
  it('restores accounts and trips', async () => {
    const { api } = await renderApp(<DeletedPage />, {
      path: '/admin/deleted',
      user: admin,
      api: { 'GET /api/admin/deleted': () => deletedItems(), 'POST /api/admin/users/u-3/restore': () => ({ ok: true }), 'POST /api/admin/trips/t-9/restore': () => ({ ok: true }) },
    });
    const [userRestore, tripRestore] = await screen.findAllByRole('button', { name: /Restore/ });
    await userEvent.click(userRestore!);
    expect(await screen.findByText('Account restored.')).toBeInTheDocument();
    await userEvent.click(tripRestore!);
    expect(await screen.findByText('Trip restored. Coverage is rebuilding.')).toBeInTheDocument();
    expect(api.calls('POST /api/admin/users/u-3/restore')).toHaveLength(1);
    expect(api.calls('POST /api/admin/trips/t-9/restore')).toHaveLength(1);
  });

  it('is read-only for devs and says when nothing is deleted', async () => {
    await renderApp(<DeletedPage />, { path: '/admin/deleted', user: dev, api: { 'GET /api/admin/deleted': () => deletedItems({ users: [], trips: [] }) } });
    expect(await screen.findByText('No deleted accounts.')).toBeInTheDocument();
    expect(screen.getByText('No deleted trips.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();
  });
});

describe('App settings', () => {
  const settingsApi = (over: Routes = {}): Routes => ({ 'GET /api/admin/app-settings': () => ({ appName: 'Wayfinder', voice: 'plain', feedbackEnabled: false }), ...over });

  it('renames the app and changes its voice, with a live preview', async () => {
    const { api } = await renderApp(<AppSettingsPage />, { path: '/admin/settings', user: admin, api: settingsApi({ 'PATCH /api/admin/app-settings': () => ({ ok: true }) }) });
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /Playful explorer/ }));
    expect(screen.getByText('Where to, explorer?')).toBeInTheDocument();
    const name = screen.getByLabelText(/App name/);
    await userEvent.clear(name);
    expect(save).toBeDisabled();
    await userEvent.type(name, 'Roamer');
    await userEvent.click(save);
    expect(await screen.findByText('Saved. Everyone sees the change within a minute.')).toBeInTheDocument();
    expect(api.calls('PATCH /api/admin/app-settings')[0]!.body).toEqual({ appName: 'Roamer', voice: 'playful' });
  });

  it('switches feedback on, and back if saving fails', async () => {
    let enabled = false;
    let fail = false;
    const { api } = await renderApp(<AppSettingsPage />, {
      path: '/admin/settings',
      user: admin,
      api: {
        'GET /api/admin/app-settings': () => ({ appName: 'Wayfinder', voice: 'plain', feedbackEnabled: enabled }),
        'PATCH /api/admin/app-settings': (req) => {
          if (fail) return apiError(500, 'internal', 'Database unavailable');
          enabled = (req.body as { feedbackEnabled: boolean }).feedbackEnabled;
          return { ok: true };
        },
      },
    });
    await userEvent.click(await screen.findByRole('switch'));
    expect(await screen.findByText(/Feedback is on/)).toBeInTheDocument();
    expect(api.calls('PATCH /api/admin/app-settings')[0]!.body).toEqual({ feedbackEnabled: true });
    await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
    fail = true;
    await userEvent.click(screen.getByRole('switch'));
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('is read-only for devs', async () => {
    await renderApp(<AppSettingsPage />, { path: '/admin/settings', user: dev, api: settingsApi() });
    expect(await screen.findByText('Only admins can change these.')).toBeInTheDocument();
    expect(screen.getByLabelText(/App name/)).toBeDisabled();
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});

describe('Feedback reports', () => {
  it('lists reports and filters them', async () => {
    const { api } = await renderApp(<FeedbackPage />, {
      path: '/admin/feedback',
      user: admin,
      config: { feedbackEnabled: true },
      api: {
        'GET /api/admin/feedback': (req) =>
          req.query.get('q') === 'zzz'
            ? { items: [], newCount: 0 }
            : { items: [feedbackItem({ hasScreenshot: true }), feedbackItem({ id: 'f-2', type: 'idea', status: 'done', user: null, message: 'x'.repeat(200) })], newCount: 1 },
      },
    });
    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('BugExplore routes do fifty U-turns');
    expect(within(rows[1]!).getByLabelText('Has a screenshot')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('Deleted account');
    expect(rows[2]).toHaveTextContent(`${'x'.repeat(110)}…`);
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Done');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'Idea');
    await waitFor(() => expect(Object.fromEntries(api.calls('GET /api/admin/feedback').at(-1)!.query)).toEqual({ status: 'done', type: 'idea' }));
    await userEvent.type(screen.getByPlaceholderText('Search messages and emails'), 'zzz');
    expect(await screen.findByText('No reports match.')).toBeInTheDocument();
  });

  it('says when feedback is switched off', async () => {
    await renderApp(<FeedbackPage />, { path: '/admin/feedback', user: admin, api: { 'GET /api/admin/feedback': () => ({ items: [], newCount: 0 }) } });
    expect(await screen.findByText('No feedback yet.')).toBeInTheDocument();
    expect(screen.getByText(/Feedback is switched off/)).toBeInTheDocument();
  });

  const detailApi = (over: Routes = {}): Routes => ({
    'GET /api/admin/feedback/f-1': () => feedbackItem({ hasScreenshot: true, context: { screen: '/directions', platform: 'web', appVersion: '1.2.3', device: 'Firefox', mapView: { center: [153.02, -27.47], zoom: 12 } } }),
    'GET /api/admin/feedback/f-1/screenshot': () => new Response(new Blob(['png'], { type: 'image/png' })),
    ...over,
  });
  const openDetail = (api: Routes = {}, me = admin) =>
    renderApp(<FeedbackDetailPage />, { path: '/admin/feedback/f-1', pattern: '/admin/feedback/:id', user: me, api: detailApi(api), routes: [{ path: '/admin/feedback', element: <p>list</p> }] });

  it('shows a report with its screenshot and context', async () => {
    await openDetail();
    expect(await screen.findByRole('heading', { name: 'Bug report' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Screenshot sent with the report' })).toBeInTheDocument();
    expect(screen.getByText('Platform').nextSibling).toHaveTextContent('Web 1.2.3');
    expect(screen.getByText('Map view').nextSibling).toHaveTextContent('-27.4700, 153.0200 · zoom 12');
    expect(screen.getByRole('link', { name: 'alex@example.test' })).toHaveAttribute('href', '/admin/users/u-2');
  });

  it('triages: status and notes', async () => {
    const { api } = await openDetail({ 'PATCH /api/admin/feedback/f-1': (req) => feedbackItem({ ...(req.body as object), hasScreenshot: true }) });
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'Won’t fix');
    await waitFor(() => expect(api.calls('PATCH /api/admin/feedback/f-1')[0]!.body).toEqual({ status: 'wont_fix' }));
    const notes = screen.getByLabelText(/Notes/);
    const saveNotes = screen.getByRole('button', { name: 'Save notes' });
    expect(saveNotes).toBeDisabled();
    await userEvent.type(notes, 'Needs live traffic, which is an outside service.');
    await userEvent.click(saveNotes);
    await waitFor(() => expect(api.calls('PATCH /api/admin/feedback/f-1').at(-1)!.body).toEqual({ adminNotes: 'Needs live traffic, which is an outside service.' }));
    expect((await screen.findAllByText('Saved')).length).toBeGreaterThan(0);
  });

  it('deletes a report after typing DELETE', async () => {
    const { api } = await openDetail({ 'DELETE /api/admin/feedback/f-1': () => undefined });
    await userEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    await waitFor(() => expect(where()).toBe('/admin/feedback'));
    expect(api.calls('DELETE /api/admin/feedback/f-1')[0]!.body).toEqual({ confirm: 'DELETE' });
  });

  it('is read-only for devs, and a report without a map view says so', async () => {
    await openDetail({ 'GET /api/admin/feedback/f-1': () => feedbackItem() }, dev);
    expect(await screen.findByText('Only admins can change reports.')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.getByText('Map view').nextSibling).toHaveTextContent('Not shared');
    expect(screen.getByText('Platform').nextSibling).toHaveTextContent('Android 0.1.0');
  });
});
