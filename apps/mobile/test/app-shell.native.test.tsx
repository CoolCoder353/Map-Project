/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { apiUrl: 'https://maps.example.test' } } } }));

// The client captures fetch when the module loads, so route it through a mock set up first.
const mockFetch = jest.fn();
global.fetch = ((...a: unknown[]) => mockFetch(...a)) as typeof fetch;
const { api, onSession } = require('../src/lib/api') as typeof import('../src/lib/api');
const { AppConfigProvider, useAppConfig } = require('../src/lib/appConfig') as typeof import('../src/lib/appConfig');

const user = { id: 'u1', email: 'sam@example.test', role: 'user', createdAt: '', settings: { trackingEnabled: false, defaultMode: 'car', exploreBudgetMin: 15 } };
// React Native's Response polyfill differs from the web's; the client only needs these.
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => mockStore.clear());

describe('the app’s API client', () => {
  it('keeps the refresh token in secure storage, tells listeners, and forgets it on sign-out', async () => {
    mockFetch.mockImplementation(async (url: string) => (url.endsWith('/api/auth/login') ? json({ accessToken: 'a', refreshToken: 'r1', user }) : json({ ok: true })));
    const seen: unknown[] = [];
    const off = onSession((a) => seen.push(a));
    await api.login('sam@example.test', 'pw');
    expect(mockFetch.mock.calls[0]![0]).toBe('https://maps.example.test/api/auth/login');
    expect(mockStore.get('wf.refreshToken')).toBe('r1');
    expect(seen).toEqual([expect.objectContaining({ user })]);
    await api.logout();
    expect(mockStore.has('wf.refreshToken')).toBe(false);
    expect(seen.at(-1)).toBeNull();
    off();
    await api.logout();
    expect(seen).toHaveLength(2);
  });
});

describe('app configuration', () => {
  function Name() {
    const { config, copy } = useAppConfig();
    return <Text>{`${config.appName} · ${copy.tagline}`}</Text>;
  }

  it('uses the server’s name and voice, and plain defaults until it answers', async () => {
    // Hold the server's answer until the defaults have been checked.
    let answer: (v: unknown) => void = () => undefined;
    mockFetch.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    await render(
      <QueryClientProvider client={client}>
        <AppConfigProvider>
          <Name />
        </AppConfigProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Wayfinder · Maps that remember where you’ve been.')).toBeOnTheScreen();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    answer(json({ appName: 'Roamer', voice: 'minimal', feedbackEnabled: true, osmDataDate: null }));
    expect(await screen.findByText('Roamer · Routes ranked by new ground.')).toBeOnTheScreen();
  });
});

describe('when a screen fails', () => {
  it('shows what happened and a way back instead of closing the app', async () => {
    const { ScreenError } = require('../src/ui/ScreenError') as typeof import('../src/ui/ScreenError');
    const retry = jest.fn(async () => undefined);
    await render(<ScreenError error={new Error('Cannot read properties of undefined')} retry={retry} />);
    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
    expect(screen.getByText('Cannot read properties of undefined')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
