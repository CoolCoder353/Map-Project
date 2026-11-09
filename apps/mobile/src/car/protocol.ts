/**
 * What the Android Auto screens and the JavaScript side say to each other. The Kotlin half is
 * modules/wayfinder-car/android/src/main/java/app/wayfinder/car/bridge/Protocol.kt. Both test
 * suites parse the fixtures in modules/wayfinder-car/android/src/test/resources/fixtures, so a
 * change here that Kotlin doesn't know about fails a test. Coordinates are [lon, lat].
 */
import { FeedbackScreenshotSchema, LngLatSchema } from '@wayfinder/shared/schemas';
import { z } from 'zod';

export const CarPlaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One line under the name, ready to show. */
  detail: z.string(),
  location: LngLatSchema,
  distanceM: z.number().nullable(),
  /** One of your saved places, so the car can mark it as one. */
  saved: z.boolean().optional(),
  /** The saved place that is Home, however it was written ("Home 🏠", "My house"). */
  home: z.boolean().optional(),
});

export const CarStatusSchema = z.object({
  /** "offline": signed in on the phone, but the server couldn't be reached to confirm it. */
  account: z.enum(['signedIn', 'signedOut', 'offline']),
  styleUrl: z.object({ light: z.string(), dark: z.string() }).nullable(),
  searchHint: z.string(),
  /** The phone's last known position, for the first view of the map. */
  here: LngLatSchema.nullable(),
  /** Your saved places, Home first then the nearest, for one tap from the car's home screen. */
  saved: z.array(CarPlaceSchema),
});

/** The limit where the car is, with no trip: `kmh` null where none is known. */
export const CarSpeedLimitSchema = z.object({ kmh: z.number().nullable(), estimated: z.boolean(), road: z.string().nullable() });
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
  /**
   * The manoeuvre after the next one however far behind it is, and how far from here, for the car's
   * cluster, which shows the step after this one (Google's NF-4).
   */
  following: z.object({ maneuver: CarManeuverSchema, cue: z.string(), road: z.string(), distanceM: z.number() }).nullable(),
  remainingDistanceM: z.number(),
  remainingDurationS: z.number(),
  arrivalEpochMs: z.number().int(),
  position: LngLatSchema.nullable(),
  headingDeg: z.number().nullable(),
  /** The limit where you are, only while on the route (off it, the road isn't the one it's for). */
  speedLimitKmh: z.number().nullable(),
  /** That limit is the legal default for the road, not a sign in the map data. */
  speedLimitEstimated: z.boolean(),
  /** How fast the phone says you're going, km/h. */
  speedKmh: z.number().nullable(),
  /** Traffic lights ahead with a known timing: red where you'll likely have to stop, else green. */
  lights: z.array(z.object({ at: LngLatSchema, red: z.boolean() })),
});

/** What the car sends with each request. */
export const CarParams = {
  search: z.object({ q: z.string().trim().min(1).max(200) }),
  plan: z.object({ to: LngLatSchema }),
  routeLine: z.object({ routeId: z.string() }),
  start: z.object({ routeId: z.string(), destinationName: z.string().max(200) }),
  mute: z.object({ muted: z.boolean() }),
  /** The car app opened or closed: its requests need JavaScript's timers, with or without a phone screen. */
  carSession: z.object({ active: z.boolean() }),
  /** A picture of the car's map as a base64 JPEG, where it could be taken. */
  report: z.object({ screenshotJpeg: FeedbackScreenshotSchema.shape.data.optional() }),
  /** Where the car is and which way it's going, for the limit on its map with no trip. */
  speedLimit: z.object({
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    headingDeg: z.number().min(0).max(360).nullable().optional(),
  }),
  /** The car's own location (its GNSS), sent by the car app on every fix. */
  location: z.object({
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    accuracyM: z.number().nonnegative().nullable(),
    speedMps: z.number().nullable(),
    headingDeg: z.number().nullable(),
    timeMs: z.number().int(),
  }),
};

export type CarStatus = z.infer<typeof CarStatusSchema>;
export type CarPlace = z.infer<typeof CarPlaceSchema>;
export type CarSpeedLimit = z.infer<typeof CarSpeedLimitSchema>;
export type CarRouteOption = z.infer<typeof CarRouteOptionSchema>;
export type ManeuverType = z.infer<typeof ManeuverTypeSchema>;
export type CarManeuver = z.infer<typeof CarManeuverSchema>;
export type CarNav = z.infer<typeof CarNavSchema>;
