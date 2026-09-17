import { formatDistanceShort, formatDuration } from '@wayfinder/nav';
import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, ArrowUp, Flag, RotateCcw, Volume2, VolumeX, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { takeRouteToNavigate } from '../src/lib/plannedStore';
import { space, useTheme } from '../src/lib/theme';
import { MapCanvas, type MapCanvasHandle } from '../src/map/MapCanvas';
import { useTurnByTurn } from '../src/nav/useTurnByTurn';
import { Button, Empty, Notice } from '../src/ui/kit';

const iconFor = (sign: number) => (sign === 4 ? Flag : sign <= -2 ? ArrowLeft : sign >= 2 && sign <= 3 ? ArrowRight : sign === 6 || Math.abs(sign) === 8 ? RotateCcw : ArrowUp);

export default function Navigate() {
  const t = useTheme();
  const initial = useMemo(() => takeRouteToNavigate(), []);
  const nav = useTurnByTurn(initial);
  const map = useRef<MapCanvasHandle>(null);

  useEffect(() => {
    if (nav.route) map.current?.fitTo(nav.route.geometry);
  }, [nav.route]);

  if (!initial) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center', padding: space[5] }}>
        <Empty icon={Flag} text="No route selected." />
        <Button label="Back" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const s = nav.state;
  const next = s?.nextInstruction ?? s?.currentInstruction;
  const Icon = iconFor(next?.sign ?? 0);
  const arrived = s?.status === 'arrived';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ backgroundColor: nav.route?.kind === 'fastest' ? t.accent : t.explore, padding: space[4], flexDirection: 'row', alignItems: 'center', gap: space[4] }} accessibilityLiveRegion="polite">
        <Icon size={40} color="#ffffff" />
        <View style={{ flex: 1 }}>
          {s?.distanceToNextManeuverM != null && !arrived ? (
            <Text style={{ color: '#ffffff', fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatDistanceShort(s.distanceToNextManeuverM)}</Text>
          ) : null}
          <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '600' }} numberOfLines={2}>
            {arrived ? 'You’ve arrived' : next?.text ?? 'Getting your location…'}
          </Text>
        </View>
      </View>
      {nav.rerouting ? <Notice tone="warning">Finding a new route…</Notice> : null}
      {s?.status === 'offRoute' && !nav.rerouting ? <Notice tone="warning">Off route</Notice> : null}
      {nav.error ? <Notice tone="error">{nav.error}</Notice> : null}
      <MapCanvas ref={map} style={{ flex: 1 }} routes={nav.route ? [nav.route] : []} selectedRouteId={nav.route?.id ?? null} followUser />
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: space[4], gap: space[3], backgroundColor: t.surface }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{s ? formatDuration(s.remainingDurationS) : '–'}</Text>
          <Text style={{ color: t.text2 }}>{s ? `${formatDistanceShort(s.remainingDistanceM)} to go` : ''}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={nav.muted ? 'Unmute voice' : 'Mute voice'} onPress={() => nav.setMuted(!nav.muted)} style={{ padding: space[3] }}>
          {nav.muted ? <VolumeX size={24} color={t.text2} /> : <Volume2 size={24} color={t.text} />}
        </Pressable>
        <Button label={arrived ? 'Done' : 'End'} kind={arrived ? 'primary' : 'secondary'} icon={X} onPress={() => { nav.stop(); router.back(); }} compact />
      </View>
    </SafeAreaView>
  );
}
