/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SettingsScreen from '../app/(tabs)/settings';
import { user } from './mocks';

const mockRequest = jest.fn();
const mockRequestTrackingPermission = jest.fn();
let mockCurrent = user(false);
const mockSetUser = jest.fn((u) => (mockCurrent = u));

const mockReplace = jest.fn();
const mockOpenURL = jest.fn();
const mockSignOut = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a) } }));
jest.mock('expo-linking', () => ({ openSettings: jest.fn(), openURL: (...a: unknown[]) => mockOpenURL(...a) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/lib/api', () => ({ api: { request: (...a: unknown[]) => mockRequest(...a) }, errorMessage: (e: Error) => e.message }));
jest.mock('../src/lib/session', () => ({ useSession: () => ({ user: mockCurrent, setUser: mockSetUser, signOut: () => mockSignOut() }) }));
jest.mock('../src/lib/server', () => ({ getServerUrl: async () => 'https://maps.example.com' }));
jest.mock('../src/tracking/background', () => ({
  trackingPermission: async () => 'undetermined',
  requestTrackingPermission: (...a: unknown[]) => mockRequestTrackingPermission(...a),
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
  mockOpenURL.mockResolvedValue(true);
  mockSignOut.mockResolvedValue(undefined);
  mockRequest.mockImplementation(async (path: string, init?: { body?: object }) => {
    if (path === 'api/planned-routes') return { items: [] };
    if (path === 'api/saved-places') return { items: [] };
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

// Google Play's prominent disclosure, before Android's prompts (src/tracking/background.ts runs it first).
it('shows the background location disclosure, and leaves tracking off on “Not now”', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons!.find((b) => b.text === 'Not now')!.onPress!());
  mockRequestTrackingPermission.mockImplementation(async (confirm: () => Promise<boolean>) => ((await confirm()) ? 'granted' : 'declined'));
  await renderSettings();
  await fireEvent(await screen.findByLabelText('Background tracking'), 'valueChange', true);
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]![1]).toMatch(/collects location data .* even when the app is closed or not in use/);
  expect(settingsCalls()).toEqual([]);
  expect(screen.queryByText(/Allow all the time/)).toBeNull();
  alert.mockRestore();
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
    if (path === 'api/saved-places') return { items: [] };
    if (path === 'api/planned-routes/p1' && init?.method === 'DELETE') throw new Error('Try again shortly.');
    throw new Error(`unexpected ${path}`);
  });
  await renderSettings();
  await fireEvent.press(await screen.findByRole('button', { name: 'Remove' }));
  expect(await screen.findByText('Couldn’t remove that route. Try again shortly.')).toBeOnTheScreen();
  expect(screen.getByText('Coast loop')).toBeOnTheScreen();
});

it('lists saved places and removes one; says so when that fails', async () => {
  let places = [
    { id: 's1', name: 'Home', description: '27 Whitby Place, Thornlands', location: [153.26, -27.56], createdAt: '2026-10-08T00:00:00Z' },
    { id: 's2', name: 'Work', description: '', location: [153.03, -27.47], createdAt: '2026-10-08T00:00:00Z' },
  ];
  let fail = false;
  mockRequest.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === 'api/planned-routes') return { items: [] };
    if (path === 'api/saved-places') return { items: places };
    if (path === 'api/saved-places/s2' && init?.method === 'DELETE') {
      if (fail) throw new Error('Try again shortly.');
      places = places.filter((p) => p.id !== 's2');
      return { ok: true };
    }
    throw new Error(`unexpected ${path}`);
  });
  await renderSettings();
  expect(await screen.findByText('Home')).toBeOnTheScreen();
  expect(screen.getByText('27 Whitby Place, Thornlands')).toBeOnTheScreen();
  fail = true;
  await fireEvent.press(screen.getAllByRole('button', { name: 'Remove' })[1]!);
  expect(await screen.findByText('Couldn’t remove that place. Try again shortly.')).toBeOnTheScreen();
  fail = false;
  await fireEvent.press(screen.getAllByRole('button', { name: 'Remove' })[1]!);
  await waitFor(() => expect(screen.queryByText('Work')).toBeNull());
  expect(screen.getByText('Home')).toBeOnTheScreen();
});

it('won’t start a planned route with nothing to follow', async () => {
  const planned = { id: 'p2', name: 'Broken', route: { distanceM: 0, durationS: 0, geometry: [[153, -27]] } };
  mockRequest.mockImplementation(async (path: string) => (path === 'api/planned-routes' ? { items: [planned] } : undefined));
  await renderSettings();
  await fireEvent.press(await screen.findByRole('button', { name: 'Start' }));
  expect(await screen.findByText(/can’t be followed/)).toBeOnTheScreen();
});

describe('privacy policy', () => {
  it('opens the policy on the server in the browser', async () => {
    await renderSettings();
    const button = await screen.findByRole('button', { name: 'Privacy policy' });
    await waitFor(() => expect(button).toBeEnabled());
    await fireEvent.press(button);
    expect(mockOpenURL).toHaveBeenCalledWith('https://maps.example.com/privacy');
  });

  it('says so when no browser opens it', async () => {
    mockOpenURL.mockRejectedValue(new Error('no browser'));
    await renderSettings();
    const button = await screen.findByRole('button', { name: 'Privacy policy' });
    await waitFor(() => expect(button).toBeEnabled());
    await fireEvent.press(button);
    expect(await screen.findByText(/Couldn’t open the privacy policy/)).toBeOnTheScreen();
  });
});

describe('delete account', () => {
  const deleteCalls = () => mockRequest.mock.calls.filter(([p, init]) => p === 'api/me' && init?.method === 'DELETE');
  const startDelete = async () => {
    await renderSettings();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete account' }));
  };

  it('asks first, explains the 7 days, and Cancel changes nothing', async () => {
    await startDelete();
    expect(screen.getByText(/restored for 7 days/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen();
    expect(deleteCalls()).toEqual([]);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('only deletes once the email is typed back', async () => {
    await startDelete();
    const confirm = screen.getByRole('button', { name: 'Delete my account' });
    expect(confirm).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Type your email to confirm'), 'someone@else.com');
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
    expect(deleteCalls()).toEqual([]);
  });

  it('deletes, then signs out and returns to sign-in', async () => {
    mockRequest.mockImplementation(async (path: string) => (path === 'api/planned-routes' || path === 'api/saved-places' ? { items: [] } : {}));
    await startDelete();
    await fireEvent.changeText(screen.getByLabelText('Type your email to confirm'), ' Sam@example.com ');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-in'));
    expect(deleteCalls()[0]![1]).toMatchObject({ method: 'DELETE', body: { confirm: 'Sam@example.com' } });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('stays signed in and shows the reason when the server refuses', async () => {
    mockRequest.mockImplementation(async (path: string) => {
      if (path === 'api/planned-routes') return { items: [] };
      throw new Error('Server is busy');
    });
    await startDelete();
    await fireEvent.changeText(screen.getByLabelText('Type your email to confirm'), 'sam@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText(/Couldn’t delete your account. Server is busy/)).toBeOnTheScreen();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
