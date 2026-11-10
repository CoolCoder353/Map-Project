import * as SecureStore from 'expo-secure-store';
import type { Mode } from '@wayfinder/shared/schemas';
import type { ChosenPlace } from '../ui/PlaceSearch';
import { currentAccountId } from './account';

/**
 * The trip last planned in Directions, kept on the phone so leaving the app (Back on Plan closes
 * it) and coming back finds it still there (U2). Only for a while: a trip planned yesterday isn't
 * the one wanted now.
 */
export interface LastPlan {
  /** Absent when the trip started from where you were: that is wherever you are now. */
  from?: ChosenPlace;
  to: ChosenPlace;
  mode: Mode;
  at: number;
  /** Whose trip it is: another account signed in on the phone never sees it. */
  account: string;
}

export const LAST_PLAN_KEY = 'wayfinder.lastPlan';
const KEY = LAST_PLAN_KEY;
/** How long a planned trip is offered again on coming back. */
export const LAST_PLAN_KEEP_MS = 2 * 60 * 60_000;

const isPlace = (p: unknown): p is ChosenPlace =>
  !!p && typeof (p as ChosenPlace).name === 'string' && Array.isArray((p as ChosenPlace).location) && (p as ChosenPlace).location.length === 2 && (p as ChosenPlace).location.every(Number.isFinite);

export async function saveLastPlan(plan: { from: ChosenPlace | null; to: ChosenPlace | null; mode: Mode }, now = Date.now()): Promise<void> {
  try {
    const account = await currentAccountId();
    if (!plan.to || !account) return await SecureStore.deleteItemAsync(KEY);
    const kept: LastPlan = { to: plan.to, mode: plan.mode, at: now, account, ...(plan.from && !plan.from.current ? { from: plan.from } : {}) };
    await SecureStore.setItemAsync(KEY, JSON.stringify(kept));
  } catch {
    // Not kept: the trip just isn't offered again.
  }
}

/** The trip last planned by the account signed in now, if recently enough to still be wanted. */
export async function loadLastPlan(now = Date.now()): Promise<LastPlan | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastPlan>;
    const account = await currentAccountId();
    if (!account || p.account !== account) return null;
    if (!isPlace(p.to) || (p.mode !== 'car' && p.mode !== 'foot') || typeof p.at !== 'number' || now - p.at > LAST_PLAN_KEEP_MS) return null;
    return { to: p.to, mode: p.mode, at: p.at, account, ...(isPlace(p.from) ? { from: p.from } : {}) };
  } catch {
    return null;
  }
}
