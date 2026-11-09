import { ExploreRouteResponseSchema, type Mode, type Route, RoundTripResponseSchema, type SavedPlace, SavedPlaceListSchema } from '@wayfinder/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { ArrowUpDown, Briefcase, Car, ExternalLink, Footprints, Home, Repeat, Star } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { formatDuration } from '../../src/lib/format';
import { googleMapsUrl } from '../../src/lib/googleMaps';
import { setRouteToNavigate, takeTripToPlan } from '../../src/lib/plannedStore';
import { splitStyles, useLayout } from '../../src/lib/layout';
import { useSession } from '../../src/lib/session';
import { space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { type ChosenPlace, PlaceSearch } from '../../src/ui/PlaceSearch';
import { RouteCard } from '../../src/ui/RouteCard';
import { canSavePlace, SavePlace } from '../../src/ui/SavePlace';
import { Body, Button, Empty, Heading, Loading, MIN_TARGET, Notice, Press, Segmented, Small } from '../../src/ui/kit';
import { useApproxLocation } from '../../src/lib/useApproxLocation';

type Tab = 'directions' | 'loop';

/** Map padding when fitting routes: room for the start and end labels at the sides. */
export const FIT_PADDING = { top: 70, bottom: 60, left: 90, right: 90 };
/** The round trip length last chosen, kept while the app runs. */
let lastLoopMinutes = 60;

/** How long the extra-time stepper waits for taps to stop before asking for routes. */
const EXPLORE_WAIT_MS = 400;

export default function Plan() {
  const here = useApproxLocation();
  const t = useTheme();
  const { user } = useSession();
  const { copy } = useAppConfig();
  const map = useRef<MapCanvasHandle>(null);
  const split = splitStyles(useLayout().sideBySide, '38%');
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

  const start = (r: Route) => {
    setRouteToNavigate(r);
    router.push('/navigate');
  };

  const markers = [
    ...(from ? [{ id: 'from', lngLat: from.location, kind: 'start' as const, label: from.name }] : []),
    ...(to && tab === 'directions' ? [{ id: 'to', lngLat: to.location, kind: 'end' as const, label: to.name }] : []),
  ];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={split.container}>
      <MapCanvas ref={map} style={split.map} routes={routes ?? []} selectedRouteId={selected} onRoutePress={setSelected} markers={markers} />
      <ScrollView style={[split.panel, { backgroundColor: t.surface }]} contentContainerStyle={{ padding: space[4], gap: space[3], ...split.content }} keyboardShouldPersistTaps="handled">
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
            <PlaceSearch label="Starting point" placeholder="Choose starting point" tone="start" value={from} onChange={setFrom} allowCurrentLocation near={to?.location ?? here} />
            {tab === 'directions' ? (
              <PlaceSearch label="Destination" placeholder={copy.searchPlaceholder} tone="end" value={to} onChange={setTo} near={from?.location ?? here} />
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
        {tab === 'directions' && to && canSavePlace(to) ? <SavePlace key={`${to.location[0]},${to.location[1]}`} place={to} /> : null}
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
                routes.slice(1).map((r, i) => (
                  <RouteCard key={r.id} route={r} title={`Explore ${i + 1}`} selected={selected === r.id} onSelect={() => setSelected(r.id)} onStart={() => start(r)} />
                ))
              ) : (
                <Small>{fastestNew >= 90 ? copy.allNewAlready : `No explore routes fit within ${budget} extra minutes.`}</Small>
              )}
            </>
            ) : null
          ) : routes.length ? (
            routes.map((r, i) => <RouteCard key={r.id} route={r} title={`Loop ${i + 1}`} selected={selected === r.id} onSelect={() => setSelected(r.id)} onStart={() => start(r)} />)
          ) : (
            <Small>{copy.noRoundTrips}</Small>
          )
        ) : null}
        {!loading && !routes && tab === 'directions' ? <Empty icon={Car} text="Choose where you’re going to compare the fastest route with ways you haven’t been." /> : null}
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

function Stepper({ label, onMinus, onPlus }: { label: string; onMinus(): void; onPlus(): void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <Button label="−" kind="secondary" compact onPress={onMinus} style={{ minWidth: 48 }} />
      <Small color={t.text}>{label}</Small>
      <Button label="+" kind="secondary" compact onPress={onPlus} style={{ minWidth: 48 }} />
    </View>
  );
}
