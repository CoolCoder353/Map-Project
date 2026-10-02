import type { DiscoverItem, Mode } from '@wayfinder/shared/schemas';
import { POI_CATEGORIES, type PoiCategory } from '@wayfinder/shared/schemas';
import { Car, Compass, Footprints } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { CATEGORY_LABEL, kindOf } from '../../src/lib/categories';
import { formatDistanceShort } from '../../src/lib/format';
import { splitStyles, useLayout } from '../../src/lib/layout';
import { radius, space, useTheme } from '../../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../../src/map/MapCanvas';
import { type ChosenPlace, PlaceSearch } from '../../src/ui/PlaceSearch';
import { Body, Button, Card, Empty, NewBadge, Notice, Press, Segmented, Small } from '../../src/ui/kit';
import { useApproxLocation } from '../../src/lib/useApproxLocation';

export default function Discover() {
  const here = useApproxLocation();
  const t = useTheme();
  const { copy } = useAppConfig();
  const map = useRef<MapCanvasHandle>(null);
  const split = splitStyles(useLayout().sideBySide, '34%');
  const [origin, setOrigin] = useState<ChosenPlace | null>(null);
  const [mode, setMode] = useState<Mode>('car');
  const [minutes, setMinutes] = useState(30);
  const [cats, setCats] = useState<PoiCategory[]>([]);
  const [items, setItems] = useState<DiscoverItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const chooseOrigin = (p: ChosenPlace | null) => {
    setOrigin(p);
    // Places found from somewhere else no longer fit; a search still on its way is dropped.
    latest.current++;
    setItems(null);
    setBusy(false);
  };

  const search = async () => {
    if (!origin || busy) return;
    const ticket = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const res = await api.request<{ items: DiscoverItem[] }>('api/discover', {
        query: { lon: origin.location[0], lat: origin.location[1], mode, maxMinutes: minutes, categories: cats.join(',') || undefined, limit: 25 },
      });
      if (ticket !== latest.current) return;
      const found = res.items ?? [];
      setItems(found);
      if (found.length) map.current?.fitTo([origin.location, ...found.map((i) => i.location)]);
    } catch (e) {
      if (ticket === latest.current) setError(errorMessage(e));
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={split.container}>
      <MapCanvas ref={map} style={split.map} markers={[...(origin ? [{ id: 'o', lngLat: origin.location, kind: 'start' as const }] : []), ...(items ?? []).map((i) => ({ id: i.id, lngLat: i.location, kind: 'poi' as const }))]} />
      <ScrollView style={[split.panel, { backgroundColor: t.surface }]} contentContainerStyle={{ padding: space[4], gap: space[3], ...split.content }} keyboardShouldPersistTaps="handled">
        <Body muted>{copy.discoverIntro}</Body>
        <PlaceSearch label="Search from" placeholder="Where are you starting?" tone="start" value={origin} onChange={chooseOrigin} allowCurrentLocation near={here} />
        <Segmented<Mode> label="Travel mode" value={mode} onChange={setMode} options={[{ value: 'car', label: 'Drive', icon: Car }, { value: 'foot', label: 'Walk', icon: Footprints }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Button label="−" kind="secondary" compact onPress={() => setMinutes((m) => Math.max(5, m - 5))} />
          <Small color={t.text}>Within {minutes} min</Small>
          <Button label="+" kind="secondary" compact onPress={() => setMinutes((m) => Math.min(180, m + 5))} />
        </View>
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
        <Button label="Find places" icon={Compass} onPress={search} busy={busy} disabled={!origin} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {items && items.length === 0 ? <Empty icon={Compass} text={copy.discoverEmpty} /> : null}
        {items?.map((i) => (
          <Card key={i.id} onPress={() => map.current?.flyTo(i.location, 15)}>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{i.name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center', marginTop: 4 }}>
              <Small>{kindOf(i.category)} · {formatDistanceShort(i.distanceM)} away</Small>
              {i.areaUnexploredPct >= 50 ? <NewBadge text={`${i.areaUnexploredPct}% unexplored area`} /> : null}
            </View>
          </Card>
        ))}
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}
