import type { LngLat } from '@wayfinder/shared/geo';
import { type Mode, TripDetailSchema } from '@wayfinder/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Car, Footprints, Trash2 } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { formatDistanceShort, formatTripPace, tripTo, tripWhen } from '../../src/lib/format';
import { goBack } from '../../src/lib/goBack';
import { splitStyles, useLayout } from '../../src/lib/layout';
import { space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { Body, Button, Loading, NewBadge, Notice, Segmented, Small, Title } from '../../src/ui/kit';

export default function Trip() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const map = useRef<MapCanvasHandle>(null);
  const split = splitStyles(useLayout().sideBySide, '50%');
  const trip = useQuery({ queryKey: ['trip', id], queryFn: () => api.request(`api/trips/${id}`, { schema: TripDetailSchema }), enabled: !!id });
  // Where you really went: the GPS as recorded, so a wrong match shows up against it (P32). The new
  // roads it was matched onto are picked out over it.
  const raw: LngLat[] = trip.data ? (trip.data.points.length > 1 ? trip.data.points.map((p) => [p.lon, p.lat] as LngLat) : trip.data.geometry) : [];
  const line = raw.length > 1 ? raw : (trip.data?.matchedGeometry ?? raw);
  // The roads this trip was first on, picked out as new roads are on the coverage map.
  const newRoads: GeoJSON.FeatureCollection | null = trip.data?.newRoadLines?.length
    ? { type: 'FeatureCollection', features: trip.data.newRoadLines.map((l) => ({ type: 'Feature', properties: { recent: true }, geometry: { type: 'LineString', coordinates: l } })) }
    : null;
  useEffect(() => {
    if (line.length) map.current?.fitTo(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.data?.id]);
  const del = useMutation({
    mutationFn: () => api.request(`api/trips/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trips'] });
      void qc.invalidateQueries({ queryKey: ['coverage-stats'] });
      goBack('/trips');
    },
  });
  // Trips are told apart by speed, which a slow drive or a run can fool; the owner knows better.
  const changeMode = useMutation({
    mutationFn: (mode: Mode) => api.request(`api/trips/${id}`, { method: 'PATCH', body: { mode } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trip', id] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
      void qc.invalidateQueries({ queryKey: ['coverage-stats'] });
    },
  });
  const confirm = () =>
    Alert.alert('Delete this trip?', 'Its GPS points are removed and roads only this trip travelled leave your coverage. An admin can restore it for 7 days.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }}>
      <View style={split.container}>
      <View testID="map-area" style={split.map}>
        <MapCanvas ref={map} style={{ flex: 1 }} track={line} coverage={newRoads} markers={line[0] ? [{ id: 's', lngLat: line[0], kind: 'start' }, { id: 'e', lngLat: line[line.length - 1]!, kind: 'end' }] : []} showUser={false} />
        {/* On the map, not in a band of its own above it (P35). */}
        <Button label="Trips" kind="secondary" icon={ArrowLeft} compact onPress={() => goBack('/trips')} style={{ position: 'absolute', top: space[3], left: space[3] }} />
      </View>
      <ScrollView style={split.panel} contentContainerStyle={{ padding: space[4], gap: space[3], ...split.content }}>
        {trip.isLoading ? <Loading /> : null}
        {trip.error ? <Notice tone="error">{errorMessage(trip.error)}</Notice> : null}
        {del.error ? <Notice tone="error">{`Couldn’t delete the trip. ${errorMessage(del.error)}`}</Notice> : null}
        {trip.data ? (
          <>
            <Title>{trip.data.mode === 'car' ? 'Drive' : 'Walk'} · {formatDistanceShort(trip.data.distanceM)}</Title>
            <Body muted>{tripWhen(trip.data, ' – ')}</Body>
            <Body>{formatTripPace(trip.data)}</Body>
            {tripTo(trip.data) ? <Body>{`To ${tripTo(trip.data)}`}</Body> : null}
            {trip.data.newRoads > 0 ? <NewBadge text={`${trip.data.newRoads} road${trip.data.newRoads === 1 ? '' : 's'} you’d never travelled before`} /> : null}
            <Small>{newRoads ? 'The line is where your phone recorded you going; new roads are picked out in green.' : 'The line is where your phone recorded you going.'}</Small>
            <View style={{ gap: space[2], marginTop: space[2] }}>
              <Segmented<Mode>
                label="Recorded as"
                value={changeMode.isPending ? changeMode.variables : trip.data.mode}
                onChange={(m) => m !== trip.data?.mode && !changeMode.isPending && changeMode.mutate(m)}
                options={[{ value: 'car', label: 'Drive', icon: Car }, { value: 'foot', label: 'Walk', icon: Footprints }]}
              />
              <Small>Change this if the trip was recorded as the wrong one.</Small>
              {changeMode.isSuccess ? <Notice>{`Changed to a ${changeMode.variables === 'car' ? 'drive' : 'walk'}. Your coverage will update shortly.`}</Notice> : null}
              {changeMode.error ? <Notice tone="error">{`Couldn’t change the trip. ${errorMessage(changeMode.error)}`}</Notice> : null}
            </View>
            <Button label="Delete trip" kind="danger" icon={Trash2} onPress={confirm} busy={del.isPending} style={{ alignSelf: 'flex-start' }} />
          </>
        ) : null}
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}
