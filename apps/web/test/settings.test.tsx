import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/planner/SettingsPanel';
import type { UserSettings } from '@wayfinder/shared';
import { type Routes, apiError } from './fakeApi';
import { route, user } from './fixtures';
import { renderApp } from './harness';

const planned = { id: 'pr-1', name: 'Fastest to Work', route: route(), createdAt: '2026-09-20T00:00:00.000Z' };
const base = (over: Routes = {}): Routes => ({
  'GET /api/planned-routes': () => ({ items: [planned] }),
  'PATCH /api/me/settings': (req) => user({ settings: req.body as Partial<UserSettings> }),
  ...over,
});

describe('Settings', () => {
  it('saves route defaults and tracking', async () => {
    const { api } = await renderApp(<SettingsPanel />, { path: '/settings', api: base() });
    expect(screen.getByRole('region', { name: 'Account' })).toHaveTextContent('sam@example.test');
    await userEvent.click(screen.getByRole('radio', { name: 'Walk' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Walk' })).toHaveAttribute('aria-checked', 'true'));
    const tracking = screen.getByRole('switch');
    expect(tracking).toBeChecked();
    await userEvent.click(tracking);
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
    const budget = screen.getByLabelText(/Extra time for explore routes/);
    fireEvent.change(budget, { target: { value: '30' } });
    fireEvent.keyUp(budget);
    await waitFor(() => expect(screen.getByLabelText('Extra time for explore routes: 30 min')).toBeInTheDocument());
    expect(api.calls('PATCH /api/me/settings').map((r) => r.body)).toEqual([{ defaultMode: 'foot' }, { trackingEnabled: false }, { exploreBudgetMin: 30 }]);
  });

  it('shows a failed save', async () => {
    await renderApp(<SettingsPanel />, { path: '/settings', api: base({ 'PATCH /api/me/settings': () => apiError(400, 'validation', 'Budget must be at most 120') }) });
    await userEvent.click(screen.getByRole('radio', { name: 'Walk' }));
    expect(await screen.findByText('Budget must be at most 120')).toBeInTheDocument();
  });

  it('lists and removes planned routes', async () => {
    let items = [planned];
    const { api } = await renderApp(<SettingsPanel />, {
      path: '/settings',
      api: base({
        'GET /api/planned-routes': () => ({ items }),
        'DELETE /api/planned-routes/pr-1': () => {
          items = [];
          return undefined;
        },
      }),
    });
    expect(await screen.findByText('Fastest to Work')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Fastest to Work' }));
    expect(await screen.findByText('Nothing planned yet.')).toBeInTheDocument();
    expect(api.calls('DELETE /api/planned-routes/pr-1')).toHaveLength(1);
  });

  it('downloads your data', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { api } = await renderApp(<SettingsPanel />, { path: '/settings', api: base({ 'GET /api/me/export': () => new Response('{"trips":[]}') }) });
    await userEvent.click(screen.getByRole('button', { name: /Download my data/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.calls('GET /api/me/export')).toHaveLength(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^wayfinder-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('shows a failed download', async () => {
    await renderApp(<SettingsPanel />, { path: '/settings', api: base({ 'GET /api/me/export': () => apiError(429, 'rate_limited', 'One export a minute') }) });
    await userEvent.click(screen.getByRole('button', { name: /Download my data/ }));
    expect(await screen.findByText('One export a minute')).toBeInTheDocument();
  });

  it('deletes the account only after typing the email, then signs out', async () => {
    const { api } = await renderApp(<SettingsPanel />, {
      path: '/settings',
      api: base({ 'DELETE /api/me': () => undefined, 'POST /api/auth/logout': () => undefined }),
    });
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    const confirm = screen.getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/to confirm/), 'SAM@example.test ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(api.calls('POST /api/auth/logout')).toHaveLength(1));
    expect(api.calls('DELETE /api/me')[0]!.body).toEqual({ confirm: 'SAM@example.test' });
  });

  it('shows why an account delete failed', async () => {
    await renderApp(<SettingsPanel />, { path: '/settings', api: base({ 'DELETE /api/me': () => apiError(400, 'confirm_mismatch', 'Type your email to confirm') }) });
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }));
    await userEvent.type(screen.getByLabelText(/to confirm/), 'sam@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText('Type your email to confirm')).toBeInTheDocument();
  });

  it('signs out', async () => {
    const { api } = await renderApp(<SettingsPanel />, { path: '/settings', api: base({ 'POST /api/auth/logout': () => undefined }) });
    await userEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    await waitFor(() => expect(api.calls('POST /api/auth/logout')).toHaveLength(1));
  });
});
