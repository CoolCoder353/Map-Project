import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DeleteAccountPage } from '../src/pages/DeleteAccountPage';
import { PrivacyPage } from '../src/pages/PrivacyPage';
import { SignInPage } from '../src/pages/SignInPage';
import { renderApp, where } from './harness';

describe('Privacy policy', () => {
  it('is readable without signing in, in plain words, using the app name', async () => {
    await renderApp(<PrivacyPage />, { path: '/privacy', user: null, config: { appName: 'PathFinder' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument();
    expect(screen.getByText(/PathFinder is a maps app/)).toBeInTheDocument();
    for (const h of ['What we keep', 'Your contacts', 'Who else sees it', 'Your choices']) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument();
    }
    expect(screen.getByText(/Your contacts are never uploaded as a list/)).toBeInTheDocument();
    expect(screen.getByText(/no analytics or tracking tools/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'privacy@paulsjones.com' })).toHaveAttribute('href', 'mailto:privacy@paulsjones.com');
  });

  it('links to the deletion page', async () => {
    await renderApp(<PrivacyPage />, {
      path: '/privacy',
      user: null,
      routes: [{ path: '/delete-account', element: <p>deletion</p> }],
    });
    await userEvent.click(screen.getByRole('link', { name: 'how to delete your account' }));
    expect(where()).toBe('/delete-account');
  });
});

describe('Delete account page', () => {
  it('gives the steps for the website and the app, without signing in', async () => {
    await renderApp(<DeleteAccountPage />, { path: '/delete-account', user: null });
    expect(screen.getByRole('heading', { level: 1, name: 'Delete your account' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'On the website' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'In the Android app' })).toBeInTheDocument();
    expect(screen.getAllByText('Delete account').length).toBeGreaterThan(0);
    expect(screen.getByText(/kept for 7 days/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy');
  });

  it('sends the person to Settings, where sign-in is asked for if needed', async () => {
    await renderApp(<DeleteAccountPage />, { path: '/delete-account', routes: [{ path: '/settings', element: <p>settings</p> }] });
    await userEvent.click(screen.getByRole('link', { name: 'Sign in and open Settings' }));
    expect(where()).toBe('/settings');
  });
});

describe('Sign-in footer', () => {
  it('links to the privacy policy', async () => {
    await renderApp(<SignInPage />, { path: '/sign-in', user: null });
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
  });
});
