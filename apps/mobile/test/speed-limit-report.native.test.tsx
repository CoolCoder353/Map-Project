/// <reference types="jest" />
import { ApiError } from '../src/lib/apiClient';
import { SPEED_LIMIT_REPORTED, SPEED_LIMIT_REPORT_FAILED, SPEED_LIMIT_REPORT_LIMIT, SPEED_LIMIT_REPORT_OFF, sendSpeedLimitReport, speedLimitReport } from '../src/nav/speedLimitReport';
import { fake, resetFakes } from './fakes';

jest.mock('../src/lib/api', () => require('./fakes').apiModule);
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.6.0' }, deviceName: 'Pixel 8' } }));

const state = (over: object = {}) =>
  ({
    status: 'navigating',
    snapped: [153.0251, -27.4698],
    speedLimitKmh: 60,
    speedLimitEstimated: false,
    currentInstruction: { sign: 0, text: 'Continue onto Ann Street', streetName: 'Ann Street' },
    nextInstruction: null,
    ...over,
  }) as never;
const at = new Date('2026-11-03T08:15:00+10:00');

beforeEach(() => resetFakes());

it('reports where the limit was shown, which way, and what it said', () => {
  const body = speedLimitReport({ state: state(), position: [153.0, -27.4], headingDeg: 92 }, at)!;
  expect(body).toMatchObject({
    type: 'speed_limit',
    message: 'Wrong speed limit on Ann Street: showing 60 km/h, reported while driving at 3 Nov 2026, 8:15 am.',
    context: { screen: 'Navigate', platform: 'android', appVersion: '0.6.0', mapView: { center: [153.0251, -27.4698], zoom: 18 } },
    speedLimit: { location: [153.0251, -27.4698], headingDeg: 92, shownKmh: 60, estimated: false },
  });
});

it('says when the limit was an estimate, or there was none, or off the route', () => {
  expect(speedLimitReport({ state: state({ speedLimitEstimated: true }), position: null }, at)!.message).toContain('showing 60 km/h (estimated)');
  const none = speedLimitReport({ state: state({ speedLimitKmh: null, currentInstruction: null }), position: null }, at)!;
  expect(none.message).toBe('Wrong speed limit: showing none, reported while driving at 3 Nov 2026, 8:15 am.');
  expect(none.speedLimit).toEqual({ location: [153.0251, -27.4698], shownKmh: null });
  expect(speedLimitReport({ state: state({ status: 'offRoute', snapped: null }), position: [153.1, -27.5] }, at)!.speedLimit).toEqual({ location: [153.1, -27.5], shownKmh: null });
  expect(speedLimitReport({ state: null, position: null }, at)).toBeNull();
});

it('sends it, and says how it went', async () => {
  fake.api.on({ 'POST api/feedback': async () => ({ id: 'f1' }) });
  expect(await sendSpeedLimitReport({ state: state(), position: null })).toBe(SPEED_LIMIT_REPORTED);
  expect(fake.api.callsTo('POST api/feedback')[0]!.body).toMatchObject({ type: 'speed_limit' });
  fake.api.on({ 'POST api/feedback': async () => { throw new ApiError(429, 'rate_limited', 'Too many'); } });
  expect(await sendSpeedLimitReport({ state: state(), position: null })).toBe(SPEED_LIMIT_REPORT_LIMIT);
  fake.api.on({ 'POST api/feedback': async () => { throw new ApiError(404, 'feedback_disabled', 'Off'); } });
  expect(await sendSpeedLimitReport({ state: state(), position: null })).toBe(SPEED_LIMIT_REPORT_OFF);
  fake.api.on({ 'POST api/feedback': async () => { throw new Error('offline'); } });
  expect(await sendSpeedLimitReport({ state: state(), position: null })).toBe(SPEED_LIMIT_REPORT_FAILED);
  expect(await sendSpeedLimitReport({ state: null, position: null })).toBe(SPEED_LIMIT_REPORT_FAILED);
});
