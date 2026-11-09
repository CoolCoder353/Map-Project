import type { DiscoverItem, Mode } from '@wayfinder/shared/schemas';
import { POI_CATEGORIES, type PoiCategory } from '@wayfinder/shared/schemas';
import { router } from 'expo-router';
import { Car, ChevronRight, Compass, Footprints } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { CATEGORY_LABEL, kindOf } from '../../src/lib/categories';
import { rememberDiscoverChoices } from '../../src/lib/discoverChoices';
import { formatDistanceShort } from '../../src/lib/format';
import { setTripToPlan } from '../../src/lib/plannedStore';
import { splitStyles, useLayout } from '../../src/lib/layout';
import { useSession } from '../../src/lib/session';
import { radius, space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { type ChosenPlace, PlaceSearch } from '../../src/ui/PlaceSearch';
import { Body, Button, Card, Empty, NewBadge, Notice, Press, Segmented, Small, Stepper } from '../../src/ui/kit';
import { useApproxLocation } from '../../src/lib/useApproxLocation';
import { useTopEdges } from '../../src/ui/NavigatingBanner';

/** How long after the last change of a filter to search again: a few taps on + make one request. */
export const REFILTER_PAUSE_MS = 500;
export const DISCOVER_FIT = { top: 80, bottom: 50, left: 60, right: 70 };

/** A place's line: what it is, how long to get there (P43) and how far. */
export function discoverDetail(i: DiscoverItem, mode: Mode): string {
  const time = i.withinMinutes ? `within ${i.withinMinutes} min ${mode === 'car' ? 'by car' : 'on foot'}` : null;
  return [kindOf(i.category), time, `${formatDistanceShort(i.distanceM)} away`].filter(Boolean).join(' · ');
}

export default function Discover() {
  const topEdges = useTopEdges();
  const here = useApproxLocation();
  const t = useTheme();
  const { user } = useSession();
  const { copy } = useAppConfig();
  const map = useRef<MapCanvasHandle>(null);
  const panel = useRef<ScrollView>(null);
  // Typing a place: the map steps aside so the keyboard leaves the suggestions in view (P4).
  const [searching, setSearching] = useState(false);
  const { sideBySide } = useLayout();
  const split = splitStyles(sideBySide, searching && !sideBySide ? '0%' : '34%');
  const [origin, setOrigin] = useState<ChosenPlace | null>(null);
  // Start where you are, once a position is known, as Plan does; only the first time, so
  // clearing the field doesn't fill it in again.
  const filledStart = useRef(false);
  useEffect(() => {
    if (!here) return;
    // "Your location" moves with you until a search runs from it (then the results stay put).
    if (origin?.current && !searched.current && (origin.location[0] !== here[0] || origin.location[1] !== here[1])) {
      setOrigin({ ...origin, location: here });
      return;
    }
    if (filledStart.current || origin) return;
    filledStart.current = true;
    setOrigin({ name: 'Your location', description: '', location: here, current: true });
  }, [here, origin]);
  const [mode, setMode] = useState<Mode>(user?.settings.defaultMode ?? 'car');
  const [minutes, setMinutes] = useState(30);
  const [cats, setCats] = useState<PoiCategory[]>([]);
  const [items, setItems] = useState<DiscoverItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  /** Where each card is in the list, to scroll to it from its pin. */
  const cardAt = useRef(new Map<string, number>());
  /** A search has run from this start, so a change of filter searches again. */
  const searched = useRef(false);
  /** The search waiting for the filter taps to stop. */
  const refilter = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chooseOrigin = (p: ChosenPlace | null) => {
    filledStart.current = true;
    setOrigin(p);
    // Places found from somewhere else no longer fit; a search still on its way, or waiting to
    // start, is dropped.
    latest.current++;
    if (refilter.current) clearTimeout(refilter.current);
    searched.current = false;
    setItems(null);
    setBusy(false);
  };

  // Places found for other filters don't fit either: they go at once, and the search runs again
  // for the new ones after a pause.
  const filters = `${mode} ${minutes} ${cats.join(',')}`;
  // The car's Discover uses the same time and kinds of place.
  useEffect(() => rememberDiscoverChoices({ minutes, categories: cats }), [minutes, cats]);
  const shown = useRef(filters);
  useEffect(() => {
    if (shown.current === filters || !searched.current) {
      shown.current = filters;
      return;
    }
    shown.current = filters;
    latest.current++;
    setItems(null);
    setBusy(true);
    const timer = setTimeout(() => void search(true), REFILTER_PAUSE_MS);
    refilter.current = timer;
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a change of filter; `search` reads them as they are now.
  }, [filters]);

  // Places found, nothing found, or the search failed: on a phone it is all below the filters, out
  // of sight, so bring it into view (a sliver of the first card looked like nothing happened).
  useEffect(() => {
    if (error || items) panel.current?.scrollToEnd({ animated: true });
  }, [items, error]);

  /** A place found is somewhere to go: Plan works out the trip there, from the same start. */
  const planTrip = (i: DiscoverItem) => {
    setTripToPlan({ from: origin, to: { name: i.name, description: kindOf(i.category), location: i.location }, mode });
    router.navigate('/plan');
  };

  /** `again`: the filters changed; runs even though the button already shows it's busy. */
  const search = async (again = false) => {
    if (!origin || (busy && !again)) return;
    const ticket = ++latest.current;
    searched.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.request<{ items: DiscoverItem[] }>('api/discover', {
        query: { lon: origin.location[0], lat: origin.location[1], mode, maxMinutes: minutes, categories: cats.join(',') || undefined, limit: 25 },
      });
      if (ticket !== latest.current) return;
      const found = res.items ?? [];
      setItems(found);
      // Room round the edges, so pins and the start aren't under the map's own labels and buttons (P48).
      if (found.length) map.current?.fitTo([origin.location, ...found.map((i) => i.location)], DISCOVER_FIT);
    } catch (e) {
      if (ticket === latest.current) setError(errorMessage(e));
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={topEdges} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={split.container}>
      <MapCanvas
        ref={map}
        style={split.map}
        // Numbered as their cards are, and a tap on one goes to its card (P47).
        markers={[...(origin && !origin.current ? [{ id: 'o', lngLat: origin.location, kind: 'start' as const }] : []), ...(items ?? []).map((i, n) => ({ id: i.id, lngLat: i.location, kind: 'poi' as const, label: String(n + 1) }))]}
        onMarkerPress={(id) => {
          const y = cardAt.current.get(id);
          if (y != null) panel.current?.scrollTo({ y, animated: true });
        }}
      />
      <ScrollView ref={panel} style={[split.panel, { backgroundColor: t.surface }]} contentContainerStyle={{ padding: space[4], gap: space[3], ...split.content }} keyboardShouldPersistTaps="handled">
        <Body muted>{copy.discoverIntro}</Body>
        <PlaceSearch label="Search from" placeholder="Where are you starting?" tone="start" value={origin} onChange={chooseOrigin} allowCurrentLocation near={here} onFocusChange={setSearching} />
        <Segmented<Mode> label="Travel mode" value={mode} onChange={setMode} options={[{ value: 'car', label: 'Drive', icon: Car }, { value: 'foot', label: 'Walk', icon: Footprints }]} />
        <Stepper label={`Within ${minutes} min`} onMinus={() => setMinutes((m) => Math.max(5, m - 5))} onPlus={() => setMinutes((m) => Math.min(180, m + 5))} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }} accessibilityRole="none" accessibilityLabel="Categories">
          {POI_CATEGORIES.map((c) => {
            const on = cats.includes(c);
            return (
              <Press
                key={c}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setCats((cs) => (on ? cs.filter((x) => x !== c) : [...cs, c]))}
                style={({ hovered }) => ({ paddingHorizontal: space[3], minHeight: 48, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? 'transparent' : t.borderStrong, backgroundColor: on ? t.accentSoft : hovered ? t.surface2 : t.surface })}
              >
                <Text style={{ color: on ? t.accent : t.text2, fontWeight: '600' }}>{CATEGORY_LABEL[c]}</Text>
              </Press>
            );
          })}
        </View>
        <Button label="Find places" icon={Compass} onPress={() => void search()} busy={busy} disabled={!origin} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {items && items.length === 0 ? <Empty icon={Compass} text={copy.discoverEmpty} /> : null}
        {items?.map((i, n) => (
          <View key={i.id} onLayout={(e) => void cardAt.current.set(i.id, e.nativeEvent.layout.y)}>
          <Card onPress={() => planTrip(i)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: t.exploreSoft }}>
                <Text style={{ color: t.explore, fontWeight: '700' }}>{n + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{i.name}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center', marginTop: 4 }}>
                  <Small>{discoverDetail(i, mode)}</Small>
                  {i.areaUnexploredPct >= 50 ? <NewBadge text={i.areaUnexploredPct >= 95 ? 'Roads around it are new to you' : `${i.areaUnexploredPct}% of roads around it new to you`} /> : null}
                </View>
              </View>
              <Small color={t.accent}>Directions</Small>
              <ChevronRight size={18} color={t.accent} />
            </View>
          </Card>
          </View>
        ))}
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}
