import type { Mode, Route } from '@wayfinder/shared/schemas';
import type { ChosenPlace } from '../ui/PlaceSearch';

/** The route handed from a planning screen to the navigation screen. */
let current: Route | null = null;
export const setRouteToNavigate = (r: Route) => {
  current = r;
};
export const takeRouteToNavigate = () => current;

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
