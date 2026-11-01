import type { FeedbackCreate } from '@wayfinder/shared/schemas';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../lib/api';
import { ApiError } from '../lib/apiClient';
import type { NavSnapshot } from './navigationService';

export const SPEED_LIMIT_REPORTED = 'Thanks. We’ll check the limit here.';
export const SPEED_LIMIT_REPORT_FAILED = 'Couldn’t send that. Try again when you have signal.';
export const SPEED_LIMIT_REPORT_LIMIT = 'Too many reports this hour. Try again later.';
export const SPEED_LIMIT_REPORT_OFF = 'Reporting is switched off for now.';

/** Where the trip is and what it shows: the navigation snapshot, or the Navigate screen's view of it. */
type Where = Pick<NavSnapshot, 'state' | 'position'> & { headingDeg?: number | null };

/** The report for a wrong limit where the trip is now, or null before there is a position. */
export function speedLimitReport(s: Where, at: Date = new Date()): FeedbackCreate | null {
  const position = s.state?.snapped ?? s.position;
  if (!position) return null;
  const st = s.state;
  const shownKmh = st?.status === 'navigating' ? st.speedLimitKmh : null;
  const estimated = shownKmh !== null && st?.speedLimitEstimated === true;
  const road = (st?.currentInstruction ?? st?.nextInstruction)?.streetName;
  const when = at.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' });
  return {
    type: 'speed_limit',
    message: `Wrong speed limit${road ? ` on ${road}` : ''}: showing ${shownKmh !== null ? `${shownKmh} km/h${estimated ? ' (estimated)' : ''}` : 'none'}, reported while driving at ${when}.`,
    context: {
      screen: 'Navigate',
      platform: 'android',
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      device: `Android ${String(Platform.Version)}${Constants.deviceName ? ` · ${Constants.deviceName}` : ''}`.slice(0, 400),
      mapView: { center: position, zoom: 18 },
    },
    speedLimit: {
      location: position,
      ...(s.headingDeg != null && s.headingDeg >= 0 && s.headingDeg <= 360 ? { headingDeg: s.headingDeg } : {}),
      shownKmh,
      ...(shownKmh !== null ? { estimated } : {}),
    },
  };
}

/** Send the report; resolves with what to tell the driver. */
export async function sendSpeedLimitReport(s: Where): Promise<string> {
  const body = speedLimitReport(s);
  if (!body) return SPEED_LIMIT_REPORT_FAILED;
  try {
    await api.request('api/feedback', { method: 'POST', body });
    return SPEED_LIMIT_REPORTED;
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return SPEED_LIMIT_REPORT_LIMIT;
    if (e instanceof ApiError && e.code === 'feedback_disabled') return SPEED_LIMIT_REPORT_OFF;
    return SPEED_LIMIT_REPORT_FAILED;
  }
}
