import type { Route } from '@wayfinder/shared/schemas';

/** The route handed from a planning screen to the navigation screen. */
let current: Route | null = null;
export const setRouteToNavigate = (r: Route) => {
  current = r;
};
export const takeRouteToNavigate = () => current;
