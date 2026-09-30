/// <reference types="jest" />
import * as Location from 'expo-location';
import { carHandlers, resetCarHandlers } from '../src/car/handlers';
import { getServerUrl } from '../src/lib/server';
import { fake, resetFakes } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/lib/server', () => ({ getServerUrl: jest.fn(async () => 'https://maps.example.test') }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { longitude: 153.02, latitude: -27.47 } })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { longitude: 153.03, latitude: -27.48 } })),
}));
const mockNavigation = { start: jest.fn(), stop: jest.fn(), setMuted: jest.fn(), getSnapshot: jest.fn(() => ({ route: null })) };
jest.mock('../src/nav/navigationService', () => ({ navigation: mockNavigation }));

beforeEach(() => {
  resetFakes();
  resetCarHandlers();
  fake.api.on({ 'GET api/config': () => ({ ...fake.config, voice: 'plain' }) });
});

describe('status', () => {
  it('is signed in, with the server’s map styles and where the phone is', async () => {
    expect(await carHandlers.status!({})).toEqual({
      account: 'signedIn',
      styleUrl: { light: 'https://maps.example.test/map/style.json?theme=light', dark: 'https://maps.example.test/map/style.json?theme=dark' },
      searchHint: 'Search places and addresses',
      here: [153.02, -27.47],
    });
  });

  it('is offline when a sign-in is saved but the server can’t be reached', async () => {
    fake.api.signedIn = false;
    expect(await carHandlers.status!({})).toMatchObject({ account: 'offline' });
  });

  it('is signed out when nobody has signed in on this phone', async () => {
    fake.api.signedIn = false;
    fake.api.savedSession = false;
    expect(await carHandlers.status!({})).toMatchObject({ account: 'signedOut' });
  });

  it('has no position without location permission, and plain words when the server is unreachable', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    fake.api.on({ 'GET api/config': () => { throw new Error('offline'); } });
    expect(await carHandlers.status!({})).toMatchObject({ here: null, searchHint: 'Search places and addresses' });
  });

  it('has no position when permission is granted but there is no last known fix', async () => {
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValueOnce(null as never);
    expect(await carHandlers.status!({})).toMatchObject({ here: null });
  });

  it('has no map style when the phone’s server address isn’t usable', async () => {
    jest.mocked(getServerUrl).mockResolvedValueOnce('');
    expect(await carHandlers.status!({})).toMatchObject({ styleUrl: null });
  });

  it('asks the server for its words once, then reuses them', async () => {
    await carHandlers.status!({});
    await carHandlers.status!({});
    expect(fake.api.callsTo('GET api/config')).toHaveLength(1);
  });
});
