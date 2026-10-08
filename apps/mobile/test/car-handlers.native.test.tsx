/// <reference types="jest" />
import * as Location from 'expo-location';
import { formatDistanceShort } from '@wayfinder/nav';
import { carHandlers, carReportMessage, resetCarHandlers } from '../src/car/handlers';
import { getServerUrl } from '../src/lib/server';
import { fake, place, resetFakes, route } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('../src/lib/server', () => ({ getServerUrl: jest.fn(async () => 'https://maps.example.test') }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { longitude: 153.02, latitude: -27.47 } })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { longitude: 153.03, latitude: -27.48 } })),
}));
const mockNavigation = { start: jest.fn(), stop: jest.fn(), setMuted: jest.fn(), getSnapshot: jest.fn(() => ({ route: null, active: true, error: null as string | null })) };
// Read lazily: the handlers import this before the const above is initialised.
jest.mock('../src/car/simulation', () => ({ ...jest.requireActual('../src/car/simulation'), startTestDrive: jest.fn() }));
import { DEMO_DESTINATION_NAME, DEMO_ORIGIN, startTestDrive } from '../src/car/simulation';
jest.mock('../src/nav/navigationService', () => ({ get navigation() { return mockNavigation; } }));

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

describe('search', () => {
  it('searches near the phone and gives one line per place', async () => {
    fake.api.on({ 'GET api/search': () => ({ results: [place({ id: 'p1', name: 'Mt Coot-tha Lookout', context: 'Mount Coot-tha QLD', distanceM: 6200 })] }) });
    const res = await carHandlers.search!({ q: 'coot' });
    expect(fake.api.callsTo('GET api/search')[0]!.query).toMatchObject({ q: 'coot', lon: 153.02, lat: -27.47, limit: 6 });
    expect(res).toEqual({ places: [{ id: 'p1', name: 'Mt Coot-tha Lookout', detail: 'Mount Coot-tha QLD · 6.2 km away', location: expect.any(Array), distanceM: 6200 }] });
  });

  it('refuses an empty search', async () => {
    await expect(carHandlers.search!({ q: '  ' })).rejects.toThrow();
  });
});

describe('discover', () => {
  it('finds places a drive away, saying how unexplored the area is', async () => {
    fake.api.on({ 'GET api/discover': () => ({ items: [{ id: 'd1', name: 'Mt Coot-tha Lookout', category: 'viewpoint', location: [152.957, -27.4846], distanceM: 6200, areaUnexploredPct: 62, score: 1 }] }) });
    const res = (await carHandlers.discover!({})) as { places: Array<{ detail: string }> };
    expect(fake.api.callsTo('GET api/discover')[0]!.query).toMatchObject({ mode: 'car', maxMinutes: 30, limit: 6 });
    expect(res.places[0]!.detail).toBe('Lookout · 6.2 km away · 62% unexplored area');
  });

  it('explains when it can’t tell where you are', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    // Shown in the car: sending the driver to the phone says to wait until it's safe (VI-1).
    await expect(carHandlers.discover!({})).rejects.toThrow(/Can’t tell where you are. When it’s safe, check that location is on/);
  });
});

describe('plan and start', () => {
  const fastest = route({ id: 'r-fast', kind: 'fastest', durationS: 1500, extraDurationS: 0, novelty: { totalKm: 18, newKm: 1.2, noveltyPct: 7 } });
  const explore = route({ id: 'r-exp', kind: 'explore', durationS: 1920, extraDurationS: 420, novelty: { totalKm: 22, newKm: 9.4, noveltyPct: 43 } });

  it('offers the fastest route and ways you haven’t been, by car from where you are', async () => {
    // No recent fix, so the phone is asked where it is right now.
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValueOnce(null as never);
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest, explore: [explore] }) });
    const res = (await carHandlers.plan!({ to: [152.957, -27.4846] })) as { options: Array<{ routeId: string; title: string; detail: string }>; note: string | null };
    expect(fake.api.callsTo('POST api/routes/explore')[0]!.body).toEqual({ from: [153.03, -27.48], to: [152.957, -27.4846], mode: 'car' });
    expect(res.options.map((o) => [o.routeId, o.title])).toEqual([['r-fast', 'Fastest'], ['r-exp', 'Explore 1']]);
    expect(res.options[1]!.detail).toMatch(/^32 min \(7 min longer\) · /);
    expect(res.note).toBeNull();
  });

  it('says why there are no other ways', async () => {
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest: { ...fastest, novelty: { totalKm: 18, newKm: 17, noveltyPct: 95 } }, explore: [] }) });
    const res = (await carHandlers.plan!({ to: [152.957, -27.4846] })) as { note: string };
    expect(res.note).toMatch(/already explores somewhere new/);
  });

  it('starts navigating a route it offered, named for the car', async () => {
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest, explore: [explore] }) });
    await carHandlers.plan!({ to: [152.957, -27.4846] });
    await carHandlers.start!({ routeId: 'r-exp', destinationName: 'Mt Coot-tha Lookout' });
    expect(mockNavigation.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-exp' }), { destinationName: 'Mt Coot-tha Lookout' });
  });

  it('says why, rather than leaving the car on “Starting…”, when navigation can’t follow the route', async () => {
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest, explore: [] }) });
    await carHandlers.plan!({ to: [152.957, -27.4846] });
    mockNavigation.getSnapshot.mockReturnValueOnce({ route: null, active: false, error: 'This route can’t be followed. Plan it again, then start the new one.' });
    await expect(carHandlers.start!({ routeId: 'r-fast', destinationName: 'x' })).rejects.toThrow('This route can’t be followed. Plan it again, then start the new one.');
    mockNavigation.getSnapshot.mockReturnValueOnce({ route: null, active: false, error: null });
    await expect(carHandlers.start!({ routeId: 'r-fast', destinationName: 'x' })).rejects.toThrow(/Couldn’t start that route/);
  });

  it('won’t start a route it doesn’t have', async () => {
    await expect(carHandlers.start!({ routeId: 'nope', destinationName: 'x' })).rejects.toThrow(/Plan it again/);
  });
});

describe('planned routes', () => {
  it('lists driving routes sent from the web, ready to start', async () => {
    fake.api.on({
      'GET api/planned-routes': () => ({
        items: [
          { id: 'pl1', name: 'Sunday drive', createdAt: '2026-09-01T00:00:00Z', route: route({ id: 'r-sun', mode: 'car' }) },
          { id: 'pl2', name: 'Bushwalk', createdAt: '2026-09-01T00:00:00Z', route: route({ id: 'r-walk', mode: 'foot' }) },
        ],
      }),
    });
    const res = (await carHandlers.planned!({})) as { items: Array<{ name: string; option: { routeId: string } }> };
    expect(res.items.map((i) => [i.name, i.option.routeId])).toEqual([['Sunday drive', 'r-sun']]);
    await carHandlers.start!({ routeId: 'r-sun', destinationName: 'Sunday drive' });
    expect(mockNavigation.start).toHaveBeenCalled();
  });
});

describe('during a trip', () => {
  it('gives the line of the route being followed, even after a reroute', async () => {
    mockNavigation.getSnapshot.mockReturnValueOnce({ route: route({ id: 'r-new', geometry: [[1, 2], [3, 4]] }) } as never);
    expect(await carHandlers.routeLine!({ routeId: 'r-new' })).toEqual({ geometry: [[1, 2], [3, 4]] });
  });

  it('ends and mutes', async () => {
    await carHandlers.stop!({});
    await carHandlers.mute!({ muted: true });
    expect(mockNavigation.stop).toHaveBeenCalled();
    expect(mockNavigation.setMuted).toHaveBeenCalledWith(true);
  });
});

describe('test drive (auto drive)', () => {
  it('follows the trip already running, under its own name', async () => {
    const current = route({ id: 'r-now' });
    mockNavigation.getSnapshot.mockReturnValueOnce({ route: current, active: true, error: null, destinationName: 'Mt Coot-tha Lookout' } as never);
    expect(await carHandlers.simulate!({})).toEqual({});
    expect(startTestDrive).toHaveBeenCalledWith(mockNavigation, current, 'Mt Coot-tha Lookout');
  });

  it('with no trip, drives the built-in route from where the phone is', async () => {
    await carHandlers.simulate!({});
    const [, demo, name] = jest.mocked(startTestDrive).mock.calls[0]!;
    expect(demo.id).toBe('test-drive');
    expect(demo.geometry[0]).toEqual([153.02, -27.47]); // the phone's last known fix, [lon, lat]
    expect(name).toBe(DEMO_DESTINATION_NAME);
  });

  it('with no trip and no position, starts from central Brisbane', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await carHandlers.simulate!({});
    expect(jest.mocked(startTestDrive).mock.calls[0]![1].geometry[0]).toEqual(DEMO_ORIGIN);
  });

  it('never calls the server', async () => {
    await carHandlers.simulate!({});
    expect(fake.api.calls).toHaveLength(0);
  });
});

describe('the edges', () => {
  const explored = route({ id: 'r-x', durationS: 600, extraDurationS: 0, novelty: { totalKm: 5, newKm: 0, noveltyPct: 0 } });

  it('searches without a position, and describes a place by its type when it has no address', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    fake.api.on({ 'GET api/search': () => ({ results: [place({ id: 'p2', context: undefined, typeLabel: 'Cafe', distanceM: undefined })] }) });
    const res = (await carHandlers.search!({ q: 'cafe' })) as { places: Array<{ detail: string; distanceM: number | null }> };
    expect(fake.api.callsTo('GET api/search')[0]!.query).toMatchObject({ q: 'cafe', lon: undefined, lat: undefined });
    expect(res.places[0]).toMatchObject({ detail: 'Cafe', distanceM: null });
  });

  it('leaves out how unexplored a place is unless it is mostly unexplored', async () => {
    fake.api.on({ 'GET api/discover': () => ({ items: [{ id: 'd2', name: 'Cove', category: 'beach', location: [153, -27], distanceM: 900, areaUnexploredPct: 20, score: 1 }] }) });
    const res = (await carHandlers.discover!({})) as { places: Array<{ detail: string }> };
    expect(res.places[0]!.detail).toBe('Beach · 900 m away');
  });

  it('won’t plan without knowing where you are', async () => {
    jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    await expect(carHandlers.plan!({ to: [152.957, -27.4846] })).rejects.toThrow(/Can’t tell where you are/);
  });

  it('shows the distance when a route has nothing new, and says when no other way fits', async () => {
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest: explored, explore: [] }) });
    const res = (await carHandlers.plan!({ to: [152.957, -27.4846] })) as { options: Array<{ detail: string }>; note: string };
    expect(res.options[0]!.detail).toBe(`10 min · ${formatDistanceShort(explored.distanceM)}`);
    expect(res.note).toBe('No other ways fit within your extra time.');
  });

  it('gives the line of a route it offered, and refuses one it never had', async () => {
    fake.api.on({ 'POST api/routes/explore': () => ({ fastest: explored, explore: [] }) });
    await carHandlers.plan!({ to: [152.957, -27.4846] });
    expect(await carHandlers.routeLine!({ routeId: 'r-x' })).toEqual({ geometry: explored.geometry });
    mockNavigation.getSnapshot.mockReturnValueOnce({ route: route({ id: 'other' }) } as never);
    await expect(carHandlers.routeLine!({ routeId: 'gone' })).rejects.toThrow(/no longer available/);
  });

  it('forgets the oldest routes after thirty', async () => {
    for (let i = 0; i < 31; i++) {
      fake.api.on({ 'POST api/routes/explore': () => ({ fastest: route({ id: `r${i}` }), explore: [] }) });
      await carHandlers.plan!({ to: [152.957, -27.4846] });
    }
    await expect(carHandlers.start!({ routeId: 'r0', destinationName: 'x' })).rejects.toThrow(/Plan it again/);
    await carHandlers.start!({ routeId: 'r30', destinationName: 'x' });
    expect(mockNavigation.start).toHaveBeenCalledTimes(1);
  });
});

describe('report', () => {
  const navigating = () => ({
    active: true,
    route: route({ kind: 'explore' }),
    destinationName: 'Raby Bay',
    rerouting: false,
    error: null,
    muted: false,
    position: [153.27, -27.52],
    headingDeg: 87.6,
    speedMps: 16.7,
    travelled: [],
    state: {
      status: 'navigating',
      speedLimitKmh: 60,
      distanceToNextManeuverM: 240,
      currentInstruction: null,
      nextInstruction: { sign: 6, text: 'At roundabout, take exit 2 onto Shore Street', streetName: 'Shore Street', distanceM: 300, durationS: 30, interval: [0, 1] },
    },
  });

  it('files a bug report with what the car was showing, where and how fast', async () => {
    fake.api.on({ 'POST api/feedback': () => ({ id: 'f1' }) });
    mockNavigation.getSnapshot.mockReturnValueOnce(navigating() as never);
    expect(await carHandlers.report!({})).toEqual({});
    const body = fake.api.callsTo('POST api/feedback')[0]!.body as { type: string; message: string; context: Record<string, unknown> };
    expect(body.type).toBe('bug');
    expect(body.context).toMatchObject({ screen: 'Android Auto: driving', platform: 'android', mapView: { center: [153.27, -27.52], zoom: 17 } });
    expect(body.message).toContain('explore route to Raby Bay, on the route.');
    expect(body.message).toContain(`Showing: "At roundabout, take exit 2 onto Shore Street" in ${formatDistanceShort(240)} (Shore Street).`);
    expect(body.message).toContain('Speed limit shown: 60 km/h. Speed: 60 km/h.');
    expect(body.message).toContain('Heading: 88°.');
  });

  it('works with no trip running, placed where the phone is', async () => {
    fake.api.on({ 'POST api/feedback': () => ({ id: 'f1' }) });
    mockNavigation.getSnapshot.mockReturnValueOnce({ active: false, route: null, error: null, position: null } as never);
    await carHandlers.report!({});
    const body = fake.api.callsTo('POST api/feedback')[0]!.body as { message: string; context: Record<string, unknown> };
    expect(body.message).toContain('No trip running.');
    expect(body.context).toMatchObject({ screen: 'Android Auto', mapView: { center: [153.02, -27.47] } });
  });

  it('passes on the server’s refusal (feedback switched off) for the car to show', async () => {
    fake.api.on({ 'POST api/feedback': () => { throw new Error('Feedback is switched off.'); } });
    mockNavigation.getSnapshot.mockReturnValueOnce({ active: false, route: null, error: null, position: [153, -27] } as never);
    await expect(carHandlers.report!({})).rejects.toThrow('Feedback is switched off.');
  });
});

describe('carReportMessage', () => {
  it('says what was shown before the first position and while finding a new route', () => {
    const msg = carReportMessage({ active: true, route: route({ kind: 'fastest' }), destinationName: null, state: null, rerouting: true, error: 'Still finding where you are.', muted: false, position: null, headingDeg: null, speedMps: null, travelled: [] }, new Date('2026-10-06T09:04:22Z'));
    expect(msg).toContain('6 Oct 2026, 7:04:22 pm');
    expect(msg).toContain('Trip: fastest route, waiting for the first position, finding a new route.');
    expect(msg).toContain('Speed limit shown: none. Speed: unknown.');
    expect(msg).toContain('Message shown: Still finding where you are.');
  });
});
