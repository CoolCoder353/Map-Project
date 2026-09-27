import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RegisterPage } from '../src/pages/RegisterPage';
import { ResetPasswordPage } from '../src/pages/ResetPasswordPage';
import { SignInPage } from '../src/pages/SignInPage';
import { apiError } from './fakeApi';
import { auth, user } from './fixtures';
import { renderApp, where } from './harness';

describe('Sign in', () => {
  it('signs in and goes to Directions', async () => {
    const { api } = await renderApp(<SignInPage />, { path: '/sign-in', user: null, api: { 'POST /api/auth/login': () => auth() } });
    expect(screen.getByRole('heading', { name: 'Sign in to Wayfinder' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(button);
    await waitFor(() => expect(where()).toBe('/directions'));
    expect(api.calls('POST /api/auth/login')[0]!.body).toEqual({ email: 'sam@example.test', password: 'correct horse' });
  });

  it('shows a wrong password', async () => {
    await renderApp(<SignInPage />, { path: '/sign-in', user: null, api: { 'POST /api/auth/login': () => apiError(401, 'invalid_credentials', 'Wrong email or password.') } });
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(where()).toBe('/sign-in');
  });

  it('uses the app name and voice', async () => {
    await renderApp(<SignInPage />, { path: '/sign-in', user: null, config: { appName: 'Roamer', voice: 'playful' } });
    expect(await screen.findByRole('heading', { name: 'Welcome back to Roamer' })).toBeInTheDocument();
    expect(screen.getByText('Here be dragons, until you go and look.')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Roamer'));
  });
});

describe('Register', () => {
  it('takes the invite code from the link and creates the account', async () => {
    const { api } = await renderApp(<RegisterPage />, { path: '/register?code=abcd-efgh', pattern: '/register', user: null, api: { 'POST /api/auth/register': () => auth(user({ email: 'new@example.test' })) } });
    expect(screen.getByLabelText('Invite code')).toHaveValue('abcd-efgh');
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'long enough pw');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(where()).toBe('/directions'));
    expect(api.calls('POST /api/auth/register')[0]!.body).toEqual({ inviteCode: 'abcd-efgh', email: 'new@example.test', password: 'long enough pw' });
  });

  it('upper-cases a typed code and checks the password length before sending', async () => {
    const { api } = await renderApp(<RegisterPage />, { path: '/register', user: null });
    await userEvent.type(screen.getByLabelText('Invite code'), 'abcd');
    expect(screen.getByLabelText('Invite code')).toHaveValue('ABCD');
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(api.calls('POST /api/auth/register')).toHaveLength(0);
  });

  it('puts server field errors next to the field', async () => {
    await renderApp(<RegisterPage />, {
      path: '/register',
      user: null,
      api: { 'POST /api/auth/register': () => apiError(400, 'validation', 'Check the highlighted fields', [{ path: 'email', message: 'That email is already registered' }]) },
    });
    await userEvent.type(screen.getByLabelText('Invite code'), 'ABCD');
    await userEvent.type(screen.getByLabelText('Email'), 'taken@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'long enough pw');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('That email is already registered')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Check the highlighted fields');
  });

  it('shows a bad invite code', async () => {
    await renderApp(<RegisterPage />, { path: '/register', user: null, api: { 'POST /api/auth/register': () => apiError(400, 'invalid_invite', 'That invite code has expired.') } });
    await userEvent.type(screen.getByLabelText('Invite code'), 'OLD1');
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'long enough pw');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That invite code has expired.');
  });
});

describe('Reset password', () => {
  it('explains a link without a token', async () => {
    await renderApp(<ResetPasswordPage />, { path: '/reset-password', user: null });
    expect(screen.getByRole('heading', { name: 'Reset link missing' })).toBeInTheDocument();
  });

  it('sets a new password from the link', async () => {
    const { api } = await renderApp(<ResetPasswordPage />, { path: '/reset-password?token=tok-1234567890', pattern: '/reset-password', user: null, api: { 'POST /api/auth/reset-password': () => ({ ok: true }) } });
    const save = screen.getByRole('button', { name: 'Save password' });
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('New password'), ' but longer');
    await userEvent.click(save);
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(api.calls('POST /api/auth/reset-password')[0]!.body).toEqual({ token: 'tok-1234567890', password: 'short but longer' });
  });

  it('shows an expired link', async () => {
    await renderApp(<ResetPasswordPage />, { path: '/reset-password?token=tok-1234567890', pattern: '/reset-password', user: null, api: { 'POST /api/auth/reset-password': () => apiError(400, 'invalid_token', 'This reset link has expired.') } });
    await userEvent.type(screen.getByLabelText('New password'), 'a new password');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This reset link has expired.');
  });
});
