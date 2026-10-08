/**
 * What the Android Auto screens and the JavaScript side say to each other. The Kotlin half is
 * modules/wayfinder-car/android/src/main/java/app/wayfinder/car/bridge/Protocol.kt. Both test
 * suites parse the fixtures in modules/wayfinder-car/android/src/test/resources/fixtures, so a
 * change here that Kotlin doesn't know about fails a test. Coordinates are [lon, lat].
 */
import { LngLatSchema } from '@wayfinder/shared/schemas';
import { z } from 'zod';

export const CarStatusSchema = z.object({
  /** "offline": signed in on the phone, but the server couldn't be reached to confirm it. */
  account: z.enum(['signedIn', 'signedOut', 'offline']),
  styleUrl: z.object({ light: z.string(), dark: z.string() }).nullable(),
  searchHint: z.string(),
  /** The phone's last known position, for the first view of the map. */
  here: LngLatSchema.nullable(),
});

export const CarPlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One line under the name, ready to show. */
  detail: z.string(),
  location: LngLatSchema,
  distanceM: z.number().nullable(),
});
export const CarPlacesSchema = z.object({ places: z.array(CarPlaceSchema) });

export const CarRouteOptionSchema = z.object({
  routeId: z.string(),
  title: z.string(),
  detail: z.string(),
  durationS: z.number(),
  distanceM: z.number(),
  extraDurationS: z.number(),
  geometry: z.array(LngLatSchema),
});
export const CarPlanSchema = z.object({ options: z.array(CarRouteOptionSchema), note: z.string().nullable() });
export const CarPlannedSchema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), option: CarRouteOptionSchema })) });
export const CarRouteLineSchema = z.object({ geometry: z.array(LngLatSchema) });

export const ManeuverTypeSchema = z.enum([
  'straight', 'slightLeft', 'left', 'sharpLeft', 'slightRight', 'right', 'sharpRight',
  'keepLeft', 'keepRight', 'uTurnLeft', 'uTurnRight', 'roundabout', 'roundaboutExit', 'waypoint', 'destination',
]);
export const CarManeuverSchema = z.object({
  type: ManeuverTypeSchema,
  exit: z.number().int().positive().nullable(),
  /** Roundabouts: how far round the exit is, degrees in the direction of travel (see InstructionSchema). */
  exitAngleDeg: z.number().min(1).max(360).nullable(),
});

export const CarNavSchema = z.object({
  routeId: z.string(),
  destinationName: z.string().nullable(),
  status: z.enum(['starting', 'navigating', 'offRoute', 'arrived']),
  rerouting: z.boolean(),
  muted: z.boolean(),
  error: z.string().nullable(),
  maneuver: CarManeuverSchema.nullable(),
  cue: z.string(),
  road: z.string(),
  distanceToManeuverM: z.number().nullable(),
  /** A manoeuvre close after the next one, shown as "then …". */
  next: z.object({ maneuver: CarManeuverSchema, cue: z.string() }).nullable(),
  remainingDistanceM: z.number(),
  remainingDurationS: z.number(),
  arrivalEpochMs: z.number().int(),
  position: LngLatSchema.nullable(),
  headingDeg: z.number().nullable(),
  /** The limit where you are, only while on the route (off it, the road isn't the one it's for). */
  speedLimitKmh: z.number().nullable(),
  /** How fast the phone says you're going, km/h. */
  speedKmh: z.number().nullable(),
});

/** What the car sends with each request. */
export const CarParams = {
  search: z.object({ q: z.string().trim().min(1).max(200) }),
  plan: z.object({ to: LngLatSchema }),
  routeLine: z.object({ routeId: z.string() }),
  start: z.object({ routeId: z.string(), destinationName: z.string().max(200) }),
  mute: z.object({ muted: z.boolean() }),
};

export type CarStatus = z.infer<typeof CarStatusSchema>;
export type CarPlace = z.infer<typeof CarPlaceSchema>;
export type CarRouteOption = z.infer<typeof CarRouteOptionSchema>;
export type ManeuverType = z.infer<typeof ManeuverTypeSchema>;
export type CarManeuver = z.infer<typeof CarManeuverSchema>;
export type CarNav = z.infer<typeof CarNavSchema>;
