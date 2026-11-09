import { CoverageStatsSchema } from '@wayfinder/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { formatNumber } from '../../src/lib/format';
import { splitStyles, useLayout } from '../../src/lib/layout';
import { useSession } from '../../src/lib/session';
import { space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { Body, Button, Loading, NewBadge, Notice, Small } from '../../src/ui/kit';
import { useTopEdges } from '../../src/ui/NavigatingBanner';

export default function Coverage() {
  const topEdges = useTopEdges();
  const t = useTheme();
  const { user } = useSession();
  const { copy } = useAppConfig();
  const stats = useQuery({ queryKey: ['coverage-stats'], queryFn: () => api.request('api/coverage/stats', { schema: CoverageStatsSchema }) });
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const pending = useRef<AbortController | null>(null);
  const map = useRef<MapCanvasHandle>(null);
  const [picked, setPicked] = useState<Record<string, unknown> | null>(null);
  const split = splitStyles(useLayout().sideBySide, '48%');
  const view = useRef<{ b: [number, number, number, number]; zoom: number } | null>(null);
  const [pulled, setPulled] = useState(false);
  // The roads in view couldn't be loaded: said, so an empty map isn't taken for having been nowhere.
  const [roadsFailed, setRoadsFailed] = useState(false);

  const onRegion = useCallback((b: [number, number, number, number], zoom: number) => {
    view.current = { b, zoom };
    pending.current?.abort();
    const ctrl = new AbortController();
    pending.current = ctrl;
    const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v)).toFixed(5);
    api
      .request<GeoJSON.FeatureCollection>('api/coverage', {
        query: { bbox: [clamp(b[0], 180), clamp(b[1], 90), clamp(b[2], 180), clamp(b[3], 90)].join(','), zoom: Math.round(zoom * 2) / 2, format: 'geojson' },
        signal: ctrl.signal,
      })
      .then((g) => {
        setGeo(g);
        setRoadsFailed(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setRoadsFailed(true);
      });
  }, []);

  // New trips land while you're elsewhere: coming back to this tab, or pulling down, fetches the
  // numbers and the roads in view again.
  const { refetch } = stats;
  const refresh = useCallback(async () => {
    const roads = view.current;
    if (roads) onRegion(roads.b, roads.zoom);
    await refetch();
  }, [onRegion, refetch]);
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      // The first time, the screen is loading anyway.
      if (focusedBefore.current) void refresh();
      focusedBefore.current = true;
    }, [refresh]),
  );
  const pullToRefresh = async () => {
    setPulled(true);
    await refresh().finally(() => setPulled(false));
  };

  // Open on the roads travelled, once: after that the map is yours to move.
  const framed = useRef(false);
  const bounds = stats.data?.bounds;
  useEffect(() => {
    if (!bounds || framed.current) return;
    framed.current = true;
    map.current?.fitTo([
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ]);
  }, [bounds]);

  const s = stats.data;
  const rows: Array<[string, string]> = s
    ? [
        ['Roads travelled', formatNumber(s.roadsTravelled)],
        ['New this month', formatNumber(s.newRoadsMonth)],
        ['Driven', `${formatNumber(s.byMode.carKm)} km`],
        ['Walked', `${formatNumber(s.byMode.footKm)} km`],
        ['Trips', formatNumber(s.tripCount)],
        ['Distance recorded', `${formatNumber(s.distanceKm)} km`],
      ]
    : [];

  return (
    <SafeAreaView edges={topEdges} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={split.container}>
      <MapCanvas ref={map} style={split.map} coverage={geo} onRegionChange={onRegion} onCoveragePress={setPicked} />
      <ScrollView
        testID="coverage-details"
        style={[split.panel, { backgroundColor: t.surface }]}
        contentContainerStyle={{ padding: space[4], gap: space[3], ...split.content }}
        refreshControl={<RefreshControl refreshing={pulled} onRefresh={() => void pullToRefresh()} />}
      >
        <Body muted>{copy.coverageIntro}</Body>
        {/* What the colours mean: green is new to you, here as everywhere in the app (P96, P99). */}
        <View accessible accessibilityLabel="Map key: green, roads first travelled this week; blue, roads travelled before. Tap a road to see when." style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[3] }}>
          <Key colour={t.exploreLine} text="New this week" />
          <Key colour={t.accent} text="Travelled before" />
          <Small>Tap a road to see when.</Small>
        </View>
        {picked ? <Notice>{roadWhen(picked)}</Notice> : null}
        {!user?.settings.trackingEnabled ? (
          <View style={{ gap: space[2] }}>
            <Notice>{copy.trackingOffHintApp}</Notice>
            <Button label="Open Settings" kind="secondary" compact onPress={() => router.navigate('/settings')} style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : null}
        {stats.isLoading ? <Loading /> : null}
        {stats.error ? <Notice tone="error">{errorMessage(stats.error)}</Notice> : null}
        {roadsFailed ? (
          <View style={{ gap: space[2] }}>
            <Notice tone="error">Couldn’t load the roads you’ve travelled on the map.</Notice>
            <Button label="Try again" kind="secondary" compact onPress={() => void refresh()} style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : null}
        {s && s.roadsTravelled === 0 ? <Body muted>{copy.coverageEmpty}</Body> : null}
        {s && s.roadsTravelled > 0 ? (
          <>
            <Text style={{ color: t.text, fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'] }} accessibilityRole="header">
              {formatNumber(s.roadKm)} <Text style={{ fontSize: 16, color: t.text2, fontWeight: '500' }}>km of road travelled</Text>
            </Text>
            {s.newRoadsWeek > 0 ? <NewBadge text={`+${formatNumber(s.newRoadsWeek)} new roads this week`} /> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {rows.map(([k, v]) => (
                <View key={k} style={{ width: '50%', paddingVertical: space[2], borderTopWidth: 1, borderColor: t.border }}>
                  <Small>{k}</Small>
                  <Text style={{ color: t.text, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{v}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Key({ colour, text }: { colour: string; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
      <View style={{ width: 18, height: 4, borderRadius: 2, backgroundColor: colour }} />
      <Text style={{ color: t.text2, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

const day = (iso: unknown) => (typeof iso === 'string' && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

/** What a tapped road says: when it was first and last travelled, and how (P99). */
export function roadWhen(road: Record<string, unknown>): string {
  const first = day(road.firstAt);
  const last = day(road.lastAt);
  const modes = typeof road.modes === 'number' ? road.modes : 0;
  const how = [modes & 1 ? 'driving' : null, modes & 2 ? 'on foot' : null].filter(Boolean).join(' and ');
  if (!first) return 'You’ve travelled this road.';
  const when = last && last !== first ? `First travelled ${first}, last ${last}` : `Travelled ${first}`;
  return `${when}${how ? `, ${how}` : ''}.`;
}
