import type { ExploreRouteResponse, Mode, Route, RoundTripResponse } from '@wayfinder/shared/schemas';
import { router } from 'expo-router';
import { Car, Footprints, Repeat } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { formatDuration } from '../../src/lib/format';
import { setRouteToNavigate } from '../../src/lib/plannedStore';
import { useSession } from '../../src/lib/session';
import { space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { type ChosenPlace, PlaceSearch } from '../../src/ui/PlaceSearch';
import { RouteCard } from '../../src/ui/RouteCard';
import { Body, Button, Empty, Heading, Loading, Notice, Segmented, Small } from '../../src/ui/kit';
import { useApproxLocation } from '../../src/lib/useApproxLocation';

type Tab = 'directions' | 'loop';

export default function Plan() {
  const here = useApproxLocation();
  const t = useTheme();
  const { user } = useSession();
  const { copy } = useAppConfig();
  const map = useRef<MapCanvasHandle>(null);
  const [tab, setTab] = useState<Tab>('directions');
  const [mode, setMode] = useState<Mode>(user?.settings.defaultMode ?? 'car');
  const [from, setFrom] = useState<ChosenPlace | null>(null);
  // Start where you are, once a position is known and the field is still empty.
  useEffect(() => {
    if (here && !from) setFrom({ name: 'Your location', description: '', location: here });
  }, [here, from]);
  const [to, setTo] = useState<ChosenPlace | null>(null);
  const [budget, setBudget] = useState(user?.settings.exploreBudgetMin ?? 15);
  const [loopMinutes, setLoopMinutes] = useState(60);
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fastestNew, setFastestNew] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'directions' || !from || !to) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .request<ExploreRouteResponse>('api/routes/explore', { method: 'POST', body: { from: from.location, to: to.location, mode, budgetMin: budget } })
      .then((res) => {
        if (cancelled) return;
        const all = [res.fastest, ...res.explore];
        setRoutes(all);
        setSelected(res.fastest.id);
        setFastestNew(res.fastest.novelty.noveltyPct);
        map.current?.fitTo(all.flatMap((r) => r.geometry), { top: 60, bottom: 60, left: 40, right: 40 });
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tab, from, to, mode, budget]);

  const makeLoops = async () => {
    if (!from) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.request<RoundTripResponse>('api/routes/roundtrip', { method: 'POST', body: { start: from.location, mode, targetMin: loopMinutes } });
      setRoutes(res.routes);
      setSelected(res.routes[0]?.id ?? null);
      if (res.routes.length) map.current?.fitTo(res.routes.flatMap((r) => r.geometry));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
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
      <MapCanvas ref={map} style={{ height: '38%' }} routes={routes ?? []} selectedRouteId={selected} onRoutePress={setSelected} markers={markers} />
      <ScrollView style={{ flex: 1, backgroundColor: t.surface }} contentContainerStyle={{ padding: space[4], gap: space[3] }} keyboardShouldPersistTaps="handled">
        <Segmented<Tab>
          label="Planning mode"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setRoutes(null);
          }}
          options={[
            { value: 'directions', label: 'Directions' },
            { value: 'loop', label: 'Round trip', icon: Repeat },
          ]}
        />
        <PlaceSearch label="Starting point" placeholder="Choose starting point" tone="start" value={from} onChange={setFrom} allowCurrentLocation near={to?.location ?? here} />
        {tab === 'directions' ? (
          <PlaceSearch label="Destination" placeholder={copy.searchPlaceholder} tone="end" value={to} onChange={setTo} near={from?.location ?? here} />
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], flexWrap: 'wrap' }}>
          <Segmented<Mode> label="Travel mode" value={mode} onChange={setMode} options={[{ value: 'car', label: 'Drive', icon: Car }, { value: 'foot', label: 'Walk', icon: Footprints }]} />
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
          ) : routes.length ? (
            routes.map((r, i) => <RouteCard key={r.id} route={r} title={`Loop ${i + 1}`} selected={selected === r.id} onSelect={() => setSelected(r.id)} onStart={() => start(r)} />)
          ) : (
            <Small>{copy.noRoundTrips}</Small>
          )
        ) : null}
        {!loading && !routes && tab === 'directions' ? <Empty icon={Car} text="Choose where you’re going to compare the fastest route with ways you haven’t been." /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stepper({ label, onMinus, onPlus }: { label: string; onMinus(): void; onPlus(): void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <Button label="−" kind="secondary" compact onPress={onMinus} style={{ minWidth: 40 }} />
      <Small color={t.text}>{label}</Small>
      <Button label="+" kind="secondary" compact onPress={onPlus} style={{ minWidth: 40 }} />
    </View>
  );
}
