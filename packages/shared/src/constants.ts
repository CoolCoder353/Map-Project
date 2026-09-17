/** Days a soft-deleted user or trip can be restored before it is purged. */
export const SOFT_DELETE_RETENTION_DAYS = 7;

/** Typical travel speeds used for reachability estimates (m/s). */
export const TYPICAL_SPEED_MPS = { car: 50 / 3.6, foot: 4.8 / 3.6 } as const;

export const DEFAULT_EXPLORE_BUDGET_MIN = { car: 15, foot: 10 } as const;

export const MOBILE_CLIENT_HEADER = 'x-client';
