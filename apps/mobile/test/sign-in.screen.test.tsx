/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SignIn from '../app/sign-in';

const mockSignIn = jest.fn();
const mockReplace = jest.fn();
const mockSetServerUrl = jest.fn(async (_url: string) => undefined);

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: string }) => require('react').createElement(require('react-native').Text, null, children),
  Redirect: () => null,
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/session', () => ({ useSession: () => ({ status: 'anonymous', signIn: mockSignIn }) }));
jest.mock('../src/lib/server', () => ({ getServerUrl: async () => 'https://maps.example.com', setServerUrl: (u: string) => mockSetServerUrl(u) }));
jest.mock('../src/lib/api', () => ({ errorMessage: (e: Error) => e.message }));

beforeEach(() => jest.clearAllMocks());

async function fill(email: string, password: string) {
  await render(<SignIn />);
  await screen.findByDisplayValue('https://maps.example.com');
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
}

it('keeps Sign in disabled until email and password are filled', async () => {
  await render(<SignIn />);
  await screen.findByDisplayValue('https://maps.example.com');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Email'), 'sam@example.com');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

it('signs in with a trimmed email, saves the server and opens the planner', async () => {
  mockSignIn.mockResolvedValue(undefined);
  await fill('  sam@example.com ', 'correct horse');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/plan'));
  expect(mockSetServerUrl).toHaveBeenCalledWith('https://maps.example.com');
  expect(mockSignIn).toHaveBeenCalledWith('sam@example.com', 'correct horse');
});

it('shows the server’s message when sign-in fails and stays put', async () => {
  mockSignIn.mockRejectedValue(new Error('Wrong email or password.'));
  await fill('sam@example.com', 'nope');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Wrong email or password.')).toBeOnTheScreen();
  expect(mockReplace).not.toHaveBeenCalled();
});
