import type { DiscoverItem, ExploreRouteResponse, LngLat, Mode, Route } from '@wayfinder/shared';
import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import type { ChosenPlace } from '../components/SearchField';
import { useAuth } from '../lib/auth';

export type PickTarget = 'from' | 'to' | 'loopStart' | 'discoverOrigin' | null;

interface PlannerValue {
  mode: Mode;
  setMode(m: Mode): void;
  from: ChosenPlace | null;
  setFrom(p: ChosenPlace | null): void;
  to: ChosenPlace | null;
  setTo(p: ChosenPlace | null): void;
  budgetMin: number;
  setBudgetMin(n: number): void;
  routes: ExploreRouteResponse | null;
  setRoutes(r: ExploreRouteResponse | null): void;
  selectedRouteId: string | null;
  setSelectedRouteId(id: string | null): void;
  loopStart: ChosenPlace | null;
  setLoopStart(p: ChosenPlace | null): void;
  loopMinutes: number;
  setLoopMinutes(n: number): void;
  loops: Route[] | null;
  setLoops(r: Route[] | null): void;
  selectedLoopId: string | null;
  setSelectedLoopId(id: string | null): void;
  discoverOrigin: ChosenPlace | null;
  setDiscoverOrigin(p: ChosenPlace | null): void;
  discoverItems: DiscoverItem[] | null;
  setDiscoverItems(items: DiscoverItem[] | null): void;
  pickTarget: PickTarget;
  setPickTarget(t: PickTarget): void;
}

const Ctx = createContext<PlannerValue | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>(user?.settings.defaultMode ?? 'car');
  const [from, setFrom] = useState<ChosenPlace | null>(null);
  const [to, setTo] = useState<ChosenPlace | null>(null);
  const [budgetMin, setBudgetMin] = useState(user?.settings.exploreBudgetMin ?? 15);
  const [routes, setRoutes] = useState<ExploreRouteResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [loopStart, setLoopStart] = useState<ChosenPlace | null>(null);
  const [loopMinutes, setLoopMinutes] = useState(60);
  const [loops, setLoops] = useState<Route[] | null>(null);
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null);
  const [discoverOrigin, setDiscoverOrigin] = useState<ChosenPlace | null>(null);
  const [discoverItems, setDiscoverItems] = useState<DiscoverItem[] | null>(null);
  const [pickTarget, setPickTarget] = useState<PickTarget>(null);
  const value = useMemo(
    () => ({
      mode, setMode, from, setFrom, to, setTo, budgetMin, setBudgetMin, routes, setRoutes, selectedRouteId, setSelectedRouteId,
      loopStart, setLoopStart, loopMinutes, setLoopMinutes, loops, setLoops, selectedLoopId, setSelectedLoopId,
      discoverOrigin, setDiscoverOrigin, discoverItems, setDiscoverItems, pickTarget, setPickTarget,
    }),
    [mode, from, to, budgetMin, routes, selectedRouteId, loopStart, loopMinutes, loops, selectedLoopId, discoverOrigin, discoverItems, pickTarget],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner(): PlannerValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlanner outside PlannerProvider');
  return v;
}

export const placeFromPoint = (p: LngLat, name = 'Dropped pin'): ChosenPlace => ({
  name,
  description: `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`,
  location: p,
});
