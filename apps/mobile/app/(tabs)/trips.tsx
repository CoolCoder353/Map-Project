import type { TripSummary } from '@wayfinder/shared/schemas';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Car, Footprints, History } from 'lucide-react-native';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { formatDateTime, formatDistanceShort } from '../../src/lib/format';
import { space, useTheme } from '../../src/lib/theme';
import { Empty, NewBadge, Small, Title } from '../../src/ui/kit';

export default function Trips() {
  const t = useTheme();
  const { copy } = useAppConfig();
  const q = useInfiniteQuery({
    queryKey: ['trips'],
    queryFn: ({ pageParam }) => api.request<{ items: TripSummary[]; nextCursor: string | null }>('api/trips', { query: { limit: 30, cursor: pageParam ?? undefined } }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.nextCursor,
  });
  const trips = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.surface }}>
      <FlatList
        data={trips}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space[4], gap: space[2] }}
        ListHeaderComponent={<Title style={{ marginBottom: space[2] }}>Trips</Title>}
        ListEmptyComponent={q.isLoading ? null : <Empty icon={History} text={copy.tripsEmpty} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
        onEndReached={() => q.hasNextPage && void q.fetchNextPage()}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/trip/${item.id}`)} style={{ flexDirection: 'row', gap: space[3], alignItems: 'center', paddingVertical: space[2] }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface3, alignItems: 'center', justifyContent: 'center' }}>
              {item.mode === 'car' ? <Car size={18} color={t.text2} /> : <Footprints size={18} color={t.text2} />}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>{formatDateTime(item.startedAt)} · {formatDistanceShort(item.distanceM)}</Text>
              <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
                <Small>{item.mode === 'car' ? 'Drive' : 'Walk'}{item.source === 'navigation' ? ', navigated' : ''}</Small>
                {item.newCells > 0 ? <NewBadge text={`${item.newCells} new hexagons`} /> : null}
              </View>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
