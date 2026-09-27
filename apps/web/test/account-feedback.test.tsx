import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AccountMenu } from '../src/components/AccountMenu';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { useToast } from '../src/lib/toast';
import { apiError } from './fakeApi';
import { user } from './fixtures';
import { renderApp, where } from './harness';

describe('Account menu', () => {
  it('shows who is signed in and links to settings; staff also get the dashboard', async () => {
    await renderApp(<AccountMenu />, { path: '/directions', user: user({ role: 'dev' }) });
    await userEvent.click(screen.getByRole('button', { name: 'Account: sam@example.test' }));
    expect(screen.getByRole('menu')).toHaveTextContent('sam@example.test');
    expect(screen.queryByRole('menuitem', { name: /Send feedback/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Admin dashboard' }));
    expect(where()).toBe('/admin');
  });

  it('hides the dashboard from plain users and closes on Escape', async () => {
    await renderApp(<AccountMenu />, { path: '/directions' });
    await userEvent.click(screen.getByRole('button', { name: /Account:/ }));
    expect(screen.queryByRole('menuitem', { name: 'Admin dashboard' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('signs out', async () => {
    const { api } = await renderApp(<AccountMenu />, { path: '/directions', api: { 'POST /api/auth/logout': () => undefined } });
    await userEvent.click(screen.getByRole('button', { name: /Account:/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(api.calls('POST /api/auth/logout')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Account:/ })).not.toBeInTheDocument());
  });
});

describe('Feedback', () => {
  const openFeedback = async (api = {}) => {
    const r = await renderApp(<AccountMenu />, { path: '/trips/t-1?from=1,2,Home', pattern: '/trips/:id', config: { feedbackEnabled: true }, api });
    await userEvent.click(screen.getByRole('button', { name: /Account:/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Send feedback/ }));
    await screen.findByRole('dialog', { name: 'Send feedback' });
    return r;
  };

  it('sends a bug report with the screen, platform and version but not the query string', async () => {
    const { api } = await openFeedback({ 'POST /api/feedback': () => ({ id: 'f-1' }) });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('What went wrong?'), 'The route did fifty U-turns');
    await userEvent.click(send);
    expect(await screen.findByText('Thanks — your feedback was sent.')).toBeInTheDocument();
    const body = api.calls('POST /api/feedback')[0]!.body as { type: string; message: string; context: Record<string, unknown>; screenshot?: unknown };
    expect(body).toMatchObject({ type: 'bug', message: 'The route did fifty U-turns', context: { screen: '/trips/t-1', platform: 'web', appVersion: '0.0.0-test' } });
    expect(body.context.mapView).toBeUndefined();
    expect(body.screenshot).toBeUndefined();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('includes the map view only when asked, and labels by kind', async () => {
    const { api, map } = await openFeedback({ 'POST /api/feedback': () => ({ id: 'f-1' }) });
    await userEvent.click(screen.getByRole('radio', { name: 'Idea' }));
    expect(screen.getByLabelText('What would you like?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }));
    await userEvent.type(screen.getByLabelText('Your message'), 'Love it');
    await userEvent.click(screen.getByRole('checkbox', { name: /Include what the map is showing/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Thanks — your feedback was sent.');
    expect(map.view).toHaveBeenCalled();
    expect(api.calls('POST /api/feedback')[0]!.body).toMatchObject({ type: 'other', context: { mapView: { center: [153.02, -27.47], zoom: 12 } } });
  });

  it('keeps the form open with the error when sending fails, and can be cancelled', async () => {
    await openFeedback({ 'POST /api/feedback': () => apiError(403, 'feedback_disabled', 'Feedback is turned off') });
    await userEvent.type(screen.getByLabelText('What went wrong?'), 'Broken');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Feedback is turned off')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects a file that isn’t an image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad'); }));
    await openFeedback();
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    });
    expect(await screen.findByText('That file isn’t an image we can read.')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('confirms, cancels with Escape, and waits while busy', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<ConfirmDialog open title="Disable Sam?" body={<p>They’ll be signed out.</p>} confirmLabel="Disable" onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(onConfirm).toHaveBeenCalledWith('');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalled();
    rerender(<ConfirmDialog open busy error="Server said no" title="Disable Sam?" body={null} confirmLabel="Disable" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Disable' })).toBeDisabled();
    expect(screen.getByText('Server said no')).toBeInTheDocument();
    rerender(<ConfirmDialog open={false} title="Disable Sam?" body={null} confirmLabel="Disable" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Toasts', () => {
  function Toaster() {
    const toast = useToast();
    return (
      <>
        <button type="button" onClick={() => toast('Plain')}>plain</button>
        <button type="button" onClick={() => toast('With undo', { label: 'Undo', onClick: undo })}>action</button>
      </>
    );
  }
  const undo = vi.fn();

  it('shows at most three, runs actions, and clears after five seconds', async () => {
    await renderApp(<Toaster />, { path: '/' });
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'plain' }));
      fireEvent.click(screen.getByRole('button', { name: 'action' }));
      expect(screen.getAllByText('Plain')).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(undo).toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(5001));
      expect(screen.queryByText('Plain')).not.toBeInTheDocument();
      expect(screen.queryByText('With undo')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
