import type { LngLat } from '@wayfinder/shared/geo';
import type { TripDetail } from '@wayfinder/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Trash2 } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Alert, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { formatDateTime, formatDistanceShort } from '../../src/lib/format';
import { space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { Body, Button, Loading, NewBadge, Notice, Title } from '../../src/ui/kit';

export default function Trip() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const map = useRef<MapCanvasHandle>(null);
  const trip = useQuery({ queryKey: ['trip', id], queryFn: () => api.request<TripDetail>(`api/trips/${id}`) });
  const line: LngLat[] = trip.data ? (trip.data.points.length > 1 ? trip.data.points.map((p) => [p.lon, p.lat] as LngLat) : trip.data.geometry) : [];
  useEffect(() => {
    if (line.length) map.current?.fitTo(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.data?.id]);
  const del = useMutation({
    mutationFn: () => api.request(`api/trips/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trips'] });
      void qc.invalidateQueries({ queryKey: ['coverage-stats'] });
      router.back();
    },
  });
  const confirm = () =>
    Alert.alert('Delete this trip?', 'Its GPS points are removed and roads only this trip travelled leave your coverage. An admin can restore it for 7 days.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }}>
      <View style={{ padding: space[3] }}>
        <Button label="Trips" kind="ghost" icon={ArrowLeft} compact onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      </View>
      <MapCanvas ref={map} style={{ height: '50%' }} track={line} markers={line[0] ? [{ id: 's', lngLat: line[0], kind: 'start' }, { id: 'e', lngLat: line[line.length - 1]!, kind: 'end' }] : []} showUser={false} />
      <View style={{ padding: space[4], gap: space[3] }}>
        {trip.isLoading ? <Loading /> : null}
        {trip.error ? <Notice tone="error">{errorMessage(trip.error)}</Notice> : null}
        {trip.data ? (
          <>
            <Title>{trip.data.mode === 'car' ? 'Drive' : 'Walk'} · {formatDistanceShort(trip.data.distanceM)}</Title>
            <Body muted>{formatDateTime(trip.data.startedAt)}</Body>
            {trip.data.newRoads > 0 ? <NewBadge text={`${trip.data.newRoads} road${trip.data.newRoads === 1 ? '' : 's'} you’d never travelled before`} /> : null}
            <Button label="Delete trip" kind="danger" icon={Trash2} onPress={confirm} busy={del.isPending} style={{ alignSelf: 'flex-start' }} />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
