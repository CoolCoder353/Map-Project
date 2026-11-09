import type { Mode, Route } from '@wayfinder/shared/schemas';
import type { ChosenPlace } from '../ui/PlaceSearch';

/** The route handed from a planning screen to the navigation screen. */
let current: Route | null = null;
let currentName: string | null = null;
/** [destinationName]: where it goes, for "Navigating to …" in the notification and the car (P91). */
export const setRouteToNavigate = (r: Route, destinationName?: string | null) => {
  current = r;
  currentName = destinationName ?? null;
};
export const takeRouteToNavigate = () => current;
export const destinationToNavigate = () => currentName;

/** A trip another screen (Discover) asks Plan to work out; taken once when Plan next shows. */
export interface TripToPlan {
  from: ChosenPlace | null;
  to: ChosenPlace;
  mode: Mode;
}
let toPlan: TripToPlan | null = null;
export const setTripToPlan = (t: TripToPlan) => {
  toPlan = t;
};
export const takeTripToPlan = (): TripToPlan | null => {
  const t = toPlan;
  toPlan = null;
  return t;
};
