/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../app/(tabs)/settings';
import { user } from './mocks';

const mockRequest = jest.fn();
const mockRequestTrackingPermission = jest.fn();
let mockCurrent = user(false);
const mockSetUser = jest.fn((u) => (mockCurrent = u));

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/api', () => ({ api: { request: (...a: unknown[]) => mockRequest(...a) }, errorMessage: (e: Error) => e.message }));
jest.mock('../src/lib/session', () => ({ useSession: () => ({ user: mockCurrent, setUser: mockSetUser, signOut: jest.fn() }) }));
jest.mock('../src/lib/server', () => ({ getServerUrl: async () => 'https://maps.example.com' }));
jest.mock('../src/tracking/background', () => ({
  trackingPermission: async () => 'undetermined',
  requestTrackingPermission: () => mockRequestTrackingPermission(),
}));
jest.mock('../src/tracking/sqliteStore', () => ({ sqliteQueueStore: { count: async () => 0 } }));
const mockSync = jest.fn();
jest.mock('../src/tracking/sync', () => ({ syncQueue: () => mockSync() }));
const mockSetContacts = jest.fn();
jest.mock('../src/lib/contacts', () => ({
  contactsSearchEnabled: async () => false,
  setContactsSearchEnabled: (on: boolean) => mockSetContacts(on),
}));
let mockFeedbackEnabled = false;
jest.mock('../src/lib/appConfig', () => ({
  useAppConfig: () => ({ config: { appName: 'Wayfinder', voice: 'plain', feedbackEnabled: mockFeedbackEnabled, osmDataDate: null } }),
}));

function renderSettings() {
  // gcTime Infinity: no clean-up timers left running after the test (see fakes.tsx).
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFeedbackEnabled = false;
  mockCurrent = user(false);
  mockRequest.mockImplementation(async (path: string, init?: { body?: object }) => {
    if (path === 'api/planned-routes') return { items: [] };
    if (path === 'api/me/settings') return { ...mockCurrent, settings: { ...mockCurrent.settings, ...init?.body } };
    throw new Error(`unexpected ${path}`);
  });
});

const settingsCalls = () => mockRequest.mock.calls.filter(([p]) => p === 'api/me/settings');

it('shows background tracking off for a new account', async () => {
  await renderSettings();
  expect(await screen.findByText('Everything is uploaded')).toBeOnTheScreen();
  expect(screen.getByLabelText('Background tracking')).toHaveProp('value', false);
});

it('does not turn tracking on when “Allow all the time” is refused', async () => {
  mockRequestTrackingPermission.mockResolvedValue('denied');
  await renderSettings();
  await fireEvent(await screen.findByLabelText('Background tracking'), 'valueChange', true);
  expect(await screen.findByText(/needs location access set to “Allow all the time”/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Open app settings' })).toBeOnTheScreen();
  expect(settingsCalls()).toEqual([]);
});

it('turns tracking on once permission is granted', async () => {
  mockRequestTrackingPermission.mockResolvedValue('granted');
  await renderSettings();
  await fireEvent(await screen.findByLabelText('Background tracking'), 'valueChange', true);
  await waitFor(() => expect(settingsCalls()).toHaveLength(1));
  expect(settingsCalls()[0]![1]).toMatchObject({ method: 'PATCH', body: { trackingEnabled: true } });
  await waitFor(() => expect(mockSetUser).toHaveBeenCalled());
  expect(mockCurrent.settings.trackingEnabled).toBe(true);
});

it('turns tracking off without asking for permission', async () => {
  mockCurrent = user(true);
  await renderSettings();
  await fireEvent(await screen.findByLabelText('Background tracking'), 'valueChange', false);
  await waitFor(() => expect(settingsCalls()).toHaveLength(1));
  expect(settingsCalls()[0]![1]).toMatchObject({ body: { trackingEnabled: false } });
  expect(mockRequestTrackingPermission).not.toHaveBeenCalled();
});

it('lists planned routes sent from the website, or says there are none', async () => {
  await renderSettings();
  expect(await screen.findByText('Nothing planned yet.')).toBeOnTheScreen();
});

it('hides Send feedback while feedback is switched off', async () => {
  await renderSettings();
  await screen.findByText('Everything is uploaded');
  expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull();
});

it('offers Send feedback once an admin has switched it on', async () => {
  mockFeedbackEnabled = true;
  await renderSettings();
  expect(await screen.findByRole('button', { name: 'Send feedback' })).toBeOnTheScreen();
});

it('leaves contacts search off when the phone refuses permission', async () => {
  mockSetContacts.mockResolvedValue(false); // permission refused
  await renderSettings();
  const toggle = await screen.findByLabelText('Search my contacts');
  expect(toggle).toHaveProp('value', false);
  await fireEvent(toggle, 'valueChange', true);
  expect(mockSetContacts).toHaveBeenCalledWith(true);
  expect(await screen.findByText(/Contacts permission was refused/)).toBeOnTheScreen();
  expect(screen.getByLabelText('Search my contacts')).toHaveProp('value', false);
}, 20_000); // the whole file's queries are still settling by the time this one runs

it('says why an upload failed, without pointing at the phone’s settings', async () => {
  mockSync.mockRejectedValueOnce(new Error('database is locked'));
  await renderSettings();
  await fireEvent.press(await screen.findByRole('button', { name: 'Sync now' }));
  expect(await screen.findByText('Couldn’t upload. database is locked')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Open app settings' })).toBeNull();
  mockSync.mockResolvedValueOnce({ uploaded: 0, dropped: 2, error: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Sync now' }));
  expect(await screen.findByText('2 points the server couldn’t accept were discarded.')).toBeOnTheScreen();
});

it('keeps a planned route listed, and says so, when removing it fails', async () => {
  const planned = { id: 'p1', name: 'Coast loop', route: { distanceM: 5000, durationS: 600, geometry: [[153, -27], [153.1, -27.1]] } };
  mockRequest.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === 'api/planned-routes') return { items: [planned] };
    if (path === 'api/planned-routes/p1' && init?.method === 'DELETE') throw new Error('Try again shortly.');
    throw new Error(`unexpected ${path}`);
  });
  await renderSettings();
  await fireEvent.press(await screen.findByRole('button', { name: 'Remove' }));
  expect(await screen.findByText('Couldn’t remove that route. Try again shortly.')).toBeOnTheScreen();
  expect(screen.getByText('Coast loop')).toBeOnTheScreen();
});

it('won’t start a planned route with nothing to follow', async () => {
  const planned = { id: 'p2', name: 'Broken', route: { distanceM: 0, durationS: 0, geometry: [[153, -27]] } };
  mockRequest.mockImplementation(async (path: string) => (path === 'api/planned-routes' ? { items: [planned] } : undefined));
  await renderSettings();
  await fireEvent.press(await screen.findByRole('button', { name: 'Start' }));
  expect(await screen.findByText(/can’t be followed/)).toBeOnTheScreen();
});
