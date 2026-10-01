import { CoverageStatsSchema } from '@wayfinder/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { formatNumber } from '../../src/lib/format';
import { useSession } from '../../src/lib/session';
import { space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { Body, Loading, NewBadge, Notice, Small } from '../../src/ui/kit';

export default function Coverage() {
  const t = useTheme();
  const { user } = useSession();
  const { copy } = useAppConfig();
  const stats = useQuery({ queryKey: ['coverage-stats'], queryFn: () => api.request('api/coverage/stats', { schema: CoverageStatsSchema }) });
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const pending = useRef<AbortController | null>(null);
  const map = useRef<MapCanvasHandle>(null);
  const view = useRef<{ b: [number, number, number, number]; zoom: number } | null>(null);
  const [pulled, setPulled] = useState(false);

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
      .then(setGeo)
      .catch(() => undefined);
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
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <MapCanvas ref={map} style={{ height: '48%' }} coverage={geo} onRegionChange={onRegion} />
      <ScrollView
        testID="coverage-details"
        style={{ flex: 1, backgroundColor: t.surface }}
        contentContainerStyle={{ padding: space[4], gap: space[3] }}
        refreshControl={<RefreshControl refreshing={pulled} onRefresh={() => void pullToRefresh()} />}
      >
        <Body muted>{copy.coverageIntro}</Body>
        {!user?.settings.trackingEnabled ? <Notice>{copy.trackingOffHint}</Notice> : null}
        {stats.isLoading ? <Loading /> : null}
        {stats.error ? <Notice tone="error">{errorMessage(stats.error)}</Notice> : null}
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
    </SafeAreaView>
  );
}
