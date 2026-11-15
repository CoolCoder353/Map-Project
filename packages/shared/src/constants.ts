/** Days a soft-deleted user or trip can be restored before it is purged. */
export const SOFT_DELETE_RETENTION_DAYS = 7;

/** Typical travel speeds used for reachability estimates (m/s). */
export const TYPICAL_SPEED_MPS = { car: 50 / 3.6, foot: 4.8 / 3.6 } as const;

export const DEFAULT_EXPLORE_BUDGET_MIN = { car: 15, foot: 10 } as const;

export const MOBILE_CLIENT_HEADER = 'x-client';

/**
 * Credit for Queensland's surveyed speed limit signs (CC BY 4.0), which fill in limits the map
 * doesn't have. Shown with the map's own attribution, wherever the map is.
 */
export const SPEED_SIGNS_ATTRIBUTION = 'Some speed limits © State of Queensland (Transport and Main Roads), CC BY 4.0';
/** The credit Geoscape asks for where G-NAF's addresses are used (search), in its own words. */
export const GNAF_ATTRIBUTION =
  'Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement';
