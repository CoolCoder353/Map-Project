import { ExploreRouteResponseSchema, type Mode, type Route, RoundTripResponseSchema, type SavedPlace, SavedPlaceListSchema } from '@wayfinder/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { ArrowUpDown, Briefcase, Car, ExternalLink, Footprints, Home, Maximize2, Minimize2, Repeat, Star } from 'lucide-react-native';
import { haversineM } from '@wayfinder/shared/geo';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { exploreTitles, formatDistanceShort, formatDuration } from '../../src/lib/format';
import { googleMapsUrl } from '../../src/lib/googleMaps';
import { setRouteToNavigate, takeTripToPlan } from '../../src/lib/plannedStore';
import { splitStyles, useLayout } from '../../src/lib/layout';
import { useSession } from '../../src/lib/session';
import { space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { type ChosenPlace, PlaceSearch } from '../../src/ui/PlaceSearch';
import { RouteCard } from '../../src/ui/RouteCard';
import { canSavePlace, SavePlace } from '../../src/ui/SavePlace';
import { navigation } from '../../src/nav/navigationService';
import { Body, Button, Empty, Heading, Loading, MIN_TARGET, Notice, Press, Segmented, Small, Stepper } from '../../src/ui/kit';
import { useApproxLocation } from '../../src/lib/useApproxLocation';
import { useTopEdges } from '../../src/ui/NavigatingBanner';

type Tab = 'directions' | 'loop';

/** Map padding when fitting routes: room for the start and end labels at the sides. */
export const FIT_PADDING = { top: 70, bottom: 60, left: 90, right: 90 };
/** The round trip length last chosen, kept while the app runs. */
let lastLoopMinutes = 60;

/** A route that starts further than this from where you are asks before it starts (P83). */
export const FAR_START_M = 500;
/** How much of the screen the map takes, normally and made bigger (P12). */
export const MAP_SHARE = { normal: '38%', big: '65%' } as const;

/** How long the extra-time stepper waits for taps to stop before asking for routes. */
const EXPLORE_WAIT_MS = 400;

export default function Plan() {
  const topEdges = useTopEdges();
  const here = useApproxLocation();
  const t = useTheme();
  const { user } = useSession();
  const { copy } = useAppConfig();
  const map = useRef<MapCanvasHandle>(null);
  const [bigMap, setBigMap] = useState(false);
  // Typing a place: the map steps aside so the keyboard leaves the suggestions in view (P4).
  const [searching, setSearching] = useState(false);
  const { sideBySide } = useLayout();
  const split = splitStyles(sideBySide, searching && !sideBySide ? '0%' : bigMap ? MAP_SHARE.big : MAP_SHARE.normal);
  const panel = useRef<ScrollView>(null);
  // A trip already running: starting one here replaces it, so say so (C14).
  const running = useSyncExternalStore(navigation.subscribe, () => {
    const n = navigation.getSnapshot();
    return n.active ? (n.destinationName ?? 'your destination') : null;
  });
  // A route that starts somewhere else, waiting for "Start anyway" (P83).
  const [farStart, setFarStart] = useState<Route | null>(null);
  const [tab, setTab] = useState<Tab>('directions');
  const [mode, setMode] = useState<Mode>(user?.settings.defaultMode ?? 'car');
  // Round trip keeps its own: a walk planned there doesn't turn Directions into walking.
  const [loopMode, setLoopMode] = useState<Mode>(user?.settings.defaultMode ?? 'car');
  const [from, setFrom] = useState<ChosenPlace | null>(null);
  // Start where you are, once a position is known — but only the first time, so clearing the
  // field doesn't immediately fill it in again.
  const filledStart = useRef(false);
  useEffect(() => {
    if (!here) return;
    // "Your location" is where you are now: it moves with you (useApproxLocation says when you've
    // moved far enough to matter), and routes from it are worked out again.
    if (from?.current && (from.location[0] !== here[0] || from.location[1] !== here[1])) {
      setFrom({ ...from, location: here });
      return;
    }
    if (filledStart.current || from) return;
    filledStart.current = true;
    setFrom({ name: 'Your location', description: '', location: here, current: true });
  }, [here, from]);
  const [to, setTo] = useState<ChosenPlace | null>(null);
  // Saved places are a tap away while no destination is chosen. The list Settings shows, so
  // saving one there or here updates both.
  const saved = useQuery({ queryKey: ['saved-places'], queryFn: () => api.request('api/saved-places', { schema: SavedPlaceListSchema }) });
  const swap = () => {
    filledStart.current = true;
    setFrom(to);
    setTo(from);
  };
  const [budget, setBudget] = useState(user?.settings.exploreBudgetMin ?? 15);
  // A new default chosen in Settings applies here too, without restarting the app.
  const defaultBudget = user?.settings.exploreBudgetMin;
  useEffect(() => {
    if (defaultBudget != null) setBudget(defaultBudget);
  }, [defaultBudget]);
  const [loopMinutes, setLoopMinutesState] = useState(lastLoopMinutes);
  const setLoopMinutes = (f: (m: number) => number) =>
    setLoopMinutesState((m) => {
      lastLoopMinutes = f(m);
      return lastLoopMinutes;
    });
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fastestNew, setFastestNew] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A place chosen in Discover: directions there, from where Discover searched.
  useFocusEffect(
    useCallback(() => {
      const trip = takeTripToPlan();
      if (!trip) return;
      filledStart.current = true;
      setTab('directions');
      setMode(trip.mode);
      if (trip.from) setFrom(trip.from);
      setTo(trip.to);
      // From the top, so the Directions switch and the start aren't left scrolled off (P50).
      panel.current?.scrollTo({ y: 0, animated: false });
    }, []),
  );
  // Every request takes a number; an answer that arrives after a newer request (or after the
  // tab, places or mode changed) is dropped, so a late round trip can't land in Directions.
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    if (tab !== 'directions') {
      // A change of start or mode also retires a round trip still on its way.
      setLoading(false);
      return;
    }
    // Routes for places that are no longer chosen would start navigation somewhere else.
    setRoutes(null);
    setSelected(null);
    if (!from || !to) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // Taps on the extra-time stepper come quickly: ask once they pause, and drop a request a newer
    // one replaces, so the server isn't working out routes nobody will see (as on the web).
    const ctrl = new AbortController();
    const wait = setTimeout(() => {
      api
        .request('api/routes/explore', { method: 'POST', body: { from: from.location, to: to.location, mode, budgetMin: budget }, schema: ExploreRouteResponseSchema, signal: ctrl.signal })
        .then((res) => {
          if (ticket !== latest.current) return;
          const all = [res.fastest, ...res.explore];
          setRoutes(all);
          setSelected(res.fastest.id);
          setFastestNew(res.fastest.novelty.noveltyPct);
          // Room for the start and end labels (about 150 px wide), so neither is cut at the edge.
          map.current?.fitTo(all.flatMap((r) => r.geometry), FIT_PADDING);
        })
        .catch((e) => ticket === latest.current && setError(errorMessage(e)))
        .finally(() => ticket === latest.current && setLoading(false));
    }, EXPLORE_WAIT_MS);
    return () => {
      clearTimeout(wait);
      ctrl.abort();
    };
  }, [tab, from, to, mode, budget]);

  // Loops made for another start or mode no longer match what the form shows.
  useEffect(() => {
    if (tab === 'loop') setRoutes(null);
  }, [tab, from, loopMode]);

  const makeLoops = async () => {
    if (!from || loading) return;
    const ticket = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.request('api/routes/roundtrip', { method: 'POST', body: { start: from.location, mode: loopMode, targetMin: loopMinutes }, schema: RoundTripResponseSchema });
      if (ticket !== latest.current) return;
      setRoutes(res.routes);
      setSelected(res.routes[0]?.id ?? null);
      if (res.routes.length) map.current?.fitTo(res.routes.flatMap((r) => r.geometry), FIT_PADDING);
    } catch (e) {
      if (ticket === latest.current) setError(errorMessage(e));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  };

  const openInGoogleMaps = () => {
    if (!to) return;
    void Linking.openURL(googleMapsUrl(from, to, mode)).catch(() => setError('Couldn’t open Google Maps. Is it or a browser installed?'));
  };

  const go = (r: Route) => {
    setFarStart(null);
    setRouteToNavigate(r, r.kind === 'roundtrip' ? 'Round trip' : (to?.name ?? null));
    router.push('/navigate');
  };
  // Directions follow you from where you are: a route from somewhere else would say "You've
  // arrived" or "Off route" straight away, so ask first.
  const start = (r: Route) => {
    const begins = r.geometry[0];
    if (here && begins && haversineM(here, begins) > FAR_START_M) setFarStart(r);
    else go(r);
  };

  const markers = [
    // "Your location" is the blue dot already: a second marker there read as two of you (P15).
    ...(from && !from.current ? [{ id: 'from', lngLat: from.location, kind: 'start' as const, label: from.name }] : []),
    ...(to && tab === 'directions' ? [{ id: 'to', lngLat: to.location, kind: 'end' as const, label: to.name }] : []),
  ];

  return (
    <SafeAreaView edges={topEdges} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={split.container}>
      <View testID="map-area" style={split.map}>
        <MapCanvas ref={map} style={{ flex: 1 }} routes={routes ?? []} selectedRouteId={selected} onRoutePress={setSelected} markers={markers} />
        <MapSizeButton big={bigMap} onPress={() => setBigMap((b) => !b)} />
      </View>
      <ScrollView ref={panel} style={[split.panel, { backgroundColor: t.surface }]} contentContainerStyle={{ padding: space[4], gap: space[3], ...split.content }} keyboardShouldPersistTaps="handled">
        {running ? <Notice tone="info">{`Directions to ${running} are running. Starting a route here ends them.`}</Notice> : null}
        {farStart && from ? (
          <View style={{ gap: space[2] }}>
            <Notice tone="warning">{`This route starts at ${from.name}, ${formatDistanceShort(haversineM(here!, farStart.geometry[0]!))} from where you are. Directions follow you from here.`}</Notice>
            <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
              <Button label="From here instead" compact onPress={() => {
                setFarStart(null);
                setFrom({ name: 'Your location', description: '', location: here!, current: true });
              }} />
              <Button label="Start anyway" kind="secondary" compact onPress={() => go(farStart)} />
            </View>
          </View>
        ) : null}
        <Segmented<Tab>
          label="Planning mode"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setRoutes(null);
            setError(null);
            setLoading(false);
          }}
          options={[
            { value: 'directions', label: 'Directions' },
            { value: 'loop', label: 'Round trip', icon: Repeat },
          ]}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          <View style={{ flex: 1, gap: space[3] }}>
            <PlaceSearch label="Starting point" placeholder="Choose starting point" tone="start" value={from} onChange={setFrom} allowCurrentLocation near={to?.location ?? here} onFocusChange={setSearching} />
            {tab === 'directions' ? (
              <PlaceSearch label="Destination" placeholder={copy.searchPlaceholder} tone="end" value={to} onChange={setTo} near={from?.location ?? here} onFocusChange={setSearching} />
            ) : null}
          </View>
          {/* Only with both chosen: a field left empty keeps showing what was typed in it. */}
          {tab === 'directions' && from && to ? (
            <Press
              accessibilityRole="button"
              accessibilityLabel="Swap starting point and destination"
              onPress={swap}
              style={({ hovered }) => ({ minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: MIN_TARGET / 2, backgroundColor: hovered ? t.surface3 : 'transparent' })}
            >
              <ArrowUpDown size={20} color={t.text2} />
            </Press>
          ) : null}
        </View>
        {tab === 'directions' && !to && saved.data?.items.length ? <SavedShortcuts places={saved.data.items} onChoose={setTo} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], flexWrap: 'wrap' }}>
           <Segmented<Mode> label="Travel mode" value={tab === 'loop' ? loopMode : mode} onChange={tab === 'loop' ? setLoopMode : setMode} options={[{ value: 'car', label: 'Drive', icon: Car }, { value: 'foot', label: 'Walk', icon: Footprints }]} />
          {tab === 'directions' ? (
            <Stepper label={copy.budgetLabel(budget)} onMinus={() => setBudget((b) => Math.max(5, b - 5))} onPlus={() => setBudget((b) => Math.min(60, b + 5))} />
          ) : (
            <Stepper label={`About ${formatDuration(loopMinutes * 60)}`} onMinus={() => setLoopMinutes((m) => Math.max(15, m - 15))} onPlus={() => setLoopMinutes((m) => Math.min(360, m + 15))} />
          )}
        </View>
        {tab === 'loop' ? (
          <>
            <Body muted>{copy.roundTripIntro}</Body>
            <Button label={routes ? 'Make new loops' : 'Make loops'} icon={Repeat} onPress={makeLoops} busy={loading} disabled={!from} />
          </>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading && tab === 'directions' ? <Loading /> : null}
        {!loading && routes ? (
          tab === 'directions' ? (
            routes[0] ? (
            <>
              <RouteCard route={routes[0]!} title="Fastest" selected={selected === routes[0]!.id} onSelect={() => setSelected(routes[0]!.id)} onStart={() => start(routes[0]!)} />
              <Heading>{copy.exploreHeading}</Heading>
              {routes.length > 1 ? (
                routes.slice(1).map((r, i, all) => (
                  <RouteCard key={r.id} route={r} title={exploreTitles(all, routes[0]!)[i]!} selected={selected === r.id} onSelect={() => setSelected(r.id)} onStart={() => start(r)} />
                ))
              ) : (
                <Small>{fastestNew >= 90 ? copy.allNewAlready : `No explore routes fit within ${budget} extra minutes.`}</Small>
              )}
            </>
            ) : null
          ) : routes.length ? (
            routes.map((r, i) => <RouteCard key={r.id} route={r} title={`Loop ${i + 1}`} note={loopNote(r, loopMinutes)} selected={selected === r.id} onSelect={() => setSelected(r.id)} onStart={() => start(r)} />)
          ) : (
            <Small>{copy.noRoundTrips}</Small>
          )
        ) : null}
        {!loading && !routes && tab === 'directions' ? <Empty icon={Car} text="Choose where you’re going to compare the fastest route with ways you haven’t been." /> : null}
        {/* After the routes, so Start is in view without scrolling (P5). */}
        {tab === 'directions' && to && canSavePlace(to) ? <SavePlace key={`${to.location[0]},${to.location[1]}`} place={to} /> : null}
        {tab === 'directions' && to ? <Button label="Open in Google Maps" kind="ghost" icon={ExternalLink} onPress={openInGoogleMaps} style={{ alignSelf: 'flex-start' }} /> : null}
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const SAVED_ICON: Record<string, typeof Home> = { home: Home, work: Briefcase };
/** Home and Work first; the rest as the server sends them, by name. */
const savedRank = (p: SavedPlace) => ({ home: 0, work: 1 })[p.name.toLowerCase()] ?? 2;

/** Saved places as one-tap destinations: the first few. */
function SavedShortcuts({ places, onChoose }: { places: SavedPlace[]; onChoose(p: ChosenPlace): void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
      {[...places].sort((a, b) => savedRank(a) - savedRank(b)).slice(0, 6).map((p) => (
        <Button
          key={p.id}
          label={p.name}
          accessibilityLabel={`Directions to ${p.name}`}
          icon={SAVED_ICON[p.name.toLowerCase()] ?? Star}
          kind="secondary"
          compact
          // Described as search describes a saved place, so it isn't offered for saving again.
          onPress={() => onChoose({ name: p.name, description: ['Saved place', p.description].filter(Boolean).join(' · '), location: p.location })}
        />
      ))}
    </View>
  );
}

/** A loop that runs over the time asked for says by how much, rather than leave it to be noticed (P69). */
export function loopNote(r: Route, targetMinutes: number): string | null {
  const over = Math.round(r.durationS / 60) - targetMinutes;
  return over >= 3 ? `${formatDuration(over * 60)} longer than the ${formatDuration(targetMinutes * 60)} you asked for` : null;
}

/** Makes the map take more of the screen, or less (P12). */
function MapSizeButton({ big, onPress }: { big: boolean; onPress(): void }) {
  const t = useTheme();
  const Icon = big ? Minimize2 : Maximize2;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={big ? 'Smaller map' : 'Bigger map'}
      onPress={onPress}
      style={({ hovered }) => ({ position: 'absolute', right: 12, top: 68, minWidth: MIN_TARGET, minHeight: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? t.surface2 : t.surface, elevation: 3 })}
    >
      <Icon size={22} color={t.text} />
    </Press>
  );
}
