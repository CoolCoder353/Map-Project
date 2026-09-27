/// <reference types="jest" />
import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import { Text } from 'react-native';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { apiUrl: 'https://built-in.example.test/' } } } }));
jest.mock('expo-contacts', () => ({
  Fields: { Addresses: 'addresses', Name: 'name' },
  requestPermissionsAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  getContactsAsync: jest.fn(),
}));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(), getLastKnownPositionAsync: jest.fn() }));
const mockReconcile = jest.fn(async (_on: boolean, _name: string) => undefined);
jest.mock('../src/tracking/background', () => ({ reconcileTracking: (on: boolean, name: string) => mockReconcile(on, name) }));
// The session's API client: refresh() restores `mockSaved`, logout() signs out.
let mockSaved: unknown = null;
const mockListeners = new Set<(a: unknown) => void>();
jest.mock('../src/lib/api', () => ({
  onSession: (fn: (a: unknown) => void) => {
    mockListeners.add(fn);
    return () => mockListeners.delete(fn);
  },
  api: {
    refresh: async () => {
      mockListeners.forEach((l) => l(mockSaved));
      return mockSaved;
    },
    logout: async () => mockListeners.forEach((l) => l(null)),
  },
}));
jest.mock('../src/lib/appConfig', () => ({ useAppConfig: () => ({ config: { appName: 'Roamer' } }) }));

import { SessionProvider, useSession } from '../src/lib/session';
import { contactsSearchEnabled, findContacts, setContactsSearchEnabled } from '../src/lib/contacts';
import { lastMapView, rememberMapView } from '../src/lib/mapView';
import { setRouteToNavigate, takeRouteToNavigate } from '../src/lib/plannedStore';
import { getServerUrl, setServerUrl } from '../src/lib/server';
import { useApproxLocation } from '../src/lib/useApproxLocation';

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('server address', () => {
  it('uses the address baked into the build until one is chosen, without trailing slashes', async () => {
    expect(await getServerUrl()).toBe('https://built-in.example.test');
    await setServerUrl('  https://maps.example.test//  ');
    expect(await getServerUrl()).toBe('https://maps.example.test');
  });
});

describe('contacts search', () => {
  const contact = (name: string, addresses: object[]) => ({ id: name, name, addresses });

  it('is off until switched on, and switching on asks for permission', async () => {
    expect(await contactsSearchEnabled()).toBe(false);
    jest.mocked(Contacts.requestPermissionsAsync).mockResolvedValue({ granted: false } as never);
    expect(await setContactsSearchEnabled(true)).toBe(false);
    expect(await contactsSearchEnabled()).toBe(false);
    jest.mocked(Contacts.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    expect(await setContactsSearchEnabled(true)).toBe(true);
    expect(await contactsSearchEnabled()).toBe(true);
    expect(await setContactsSearchEnabled(false)).toBe(false);
    expect(await contactsSearchEnabled()).toBe(false);
  });

  it('reads nothing while off or without permission', async () => {
    expect(await findContacts('mum')).toEqual([]);
    mockStore.set('wf.contactsSearch', 'on');
    jest.mocked(Contacts.getPermissionsAsync).mockResolvedValue({ granted: false } as never);
    expect(await findContacts('mum')).toEqual([]);
    expect(Contacts.getContactsAsync).not.toHaveBeenCalled();
    expect(await findContacts('m')).toEqual([]);
  });

  it('finds contacts with an address, one address each, up to the limit', async () => {
    mockStore.set('wf.contactsSearch', 'on');
    jest.mocked(Contacts.getPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Contacts.getContactsAsync).mockResolvedValue({
      data: [
        contact('Mum', [{ street: '12 Queen St ', city: 'Brisbane', region: 'QLD', postalCode: '4000', label: 'home' }, { street: 'Work' }]),
        contact('Mumbles', []),
        contact('Mumford', [{ street: '', city: '' }]),
        contact('Mummy', [{ city: 'Cairns' }]),
        contact('Mumsy', [{ city: 'Toowoomba' }]),
      ],
    } as never);
    const found = await findContacts(' Mum ', 2);
    expect(found).toEqual([
      { id: 'Mum:0', name: 'Mum', address: '12 Queen St, Brisbane, QLD, 4000', label: 'home' },
      { id: 'Mummy:1', name: 'Mummy', address: 'Cairns', label: null },
    ]);
    expect(jest.mocked(Contacts.getContactsAsync).mock.calls[0]![0]).toMatchObject({ name: 'mum' });
  });

  it('treats a failure to read contacts as no matches', async () => {
    mockStore.set('wf.contactsSearch', 'on');
    jest.mocked(Contacts.getPermissionsAsync).mockRejectedValue(new Error('no'));
    expect(await findContacts('mum')).toEqual([]);
  });
});

describe('small shared state', () => {
  it('remembers the last map view, rounded, for feedback', () => {
    expect(lastMapView()).toBeNull();
    rememberMapView([153.0, -27.6, 153.2, -27.4], 11.2345);
    expect(lastMapView()).toEqual({ center: [153.1, -27.5], zoom: 11.23 });
  });

  it('hands a route from planning to navigation', () => {
    expect(takeRouteToNavigate()).toBeNull();
    setRouteToNavigate({ id: 'r' } as never);
    expect(takeRouteToNavigate()).toEqual({ id: 'r' });
  });
});

describe('approximate location', () => {
  it('uses the last known position when permission is already granted, and never asks', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue({ coords: { longitude: 153, latitude: -27.5 } } as never);
    const { result } = await renderHook(() => useApproxLocation());
    await waitFor(() => expect(result.current).toEqual([153, -27.5]));
  });

  it('stays unknown without permission or a position', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ granted: false } as never);
    const denied = await renderHook(() => useApproxLocation());
    await act(async () => undefined);
    expect(denied.result.current).toBeUndefined();
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
    jest.mocked(Location.getForegroundPermissionsAsync).mockRejectedValue(new Error('x'));
    const failed = await renderHook(() => useApproxLocation());
    await act(async () => undefined);
    expect(failed.result.current).toBeUndefined();
  });
});

describe('session', () => {
  const auth = { accessToken: 'a', user: { id: 'u1', email: 'sam@example.test', role: 'user', createdAt: '', settings: { trackingEnabled: true, defaultMode: 'car', exploreBudgetMin: 15 } } };
  let signOut: () => Promise<void> = async () => undefined;
  function Probe() {
    const s = useSession();
    signOut = s.signOut;
    return <Text>{`${s.status}:${s.user?.email ?? '-'}`}</Text>;
  }
  const show = () =>
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

  it('restores a saved session, starts tracking to match the account, and stops it on sign-out', async () => {
    mockSaved = auth;
    await show();
    expect(await screen.findByText('authenticated:sam@example.test')).toBeOnTheScreen();
    await waitFor(() => expect(mockReconcile).toHaveBeenCalledWith(true, 'Roamer'));
    await act(async () => signOut());
    expect(mockReconcile).toHaveBeenLastCalledWith(false, 'Roamer');
    expect(await screen.findByText('anonymous:-')).toBeOnTheScreen();
  });

  it('is signed out when there is no saved session', async () => {
    mockSaved = null;
    await show();
    expect(await screen.findByText('anonymous:-')).toBeOnTheScreen();
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});
