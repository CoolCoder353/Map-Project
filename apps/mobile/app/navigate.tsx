import { formatDistanceShort, formatDuration } from '@wayfinder/nav';
import { ArrowLeft, ArrowRight, ArrowUp, Flag, RotateCcw, Volume2, VolumeX, X } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../src/lib/goBack';
import { takeRouteToNavigate } from '../src/lib/plannedStore';
import { space, useTheme } from '../src/lib/theme';
import { MapCanvas } from '../src/map/MapCanvas';
import { useTurnByTurn } from '../src/nav/useTurnByTurn';
import { Button, Empty, Notice } from '../src/ui/kit';

const iconFor = (sign: number) => (sign === 4 ? Flag : sign <= -2 ? ArrowLeft : sign >= 2 && sign <= 3 ? ArrowRight : sign === 6 || Math.abs(sign) === 8 ? RotateCcw : ArrowUp);

/** The limit as Australian signs show it: black on white in a red ring, in both themes. */
function SpeedSign({ kmh }: { kmh: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`Speed limit ${kmh} km/h`}
      style={{
        position: 'absolute',
        top: space[3],
        left: space[3],
        width: 60,
        height: 60,
        borderRadius: 30,
        borderWidth: 6,
        borderColor: '#d0021b',
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 3,
      }}
    >
      <Text style={{ color: '#000000', fontSize: kmh >= 100 ? 19 : 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{kmh}</Text>
    </View>
  );
}

export default function Navigate() {
  const t = useTheme();
  const initial = useMemo(() => takeRouteToNavigate(), []);
  const nav = useTurnByTurn(initial);

  if (!initial) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center', padding: space[5] }}>
        <Empty icon={Flag} text="No route selected." />
        <Button label="Back" onPress={() => goBack()} />
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
      <View style={{ flex: 1 }}>
        {/* Follows you close up. No fitting to the whole route: that zooms out of the drive. */}
        <MapCanvas style={{ flex: 1 }} routes={nav.route ? [nav.route] : []} selectedRouteId={nav.route?.id ?? null} followUser />
        {/* Only while on the route: off it, the road you are on isn't the one the limit is for. */}
        {s?.status === 'navigating' && s.speedLimitKmh != null ? <SpeedSign kmh={s.speedLimitKmh} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: space[4], gap: space[3], backgroundColor: t.surface }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{s ? formatDuration(s.remainingDurationS) : '–'}</Text>
          <Text style={{ color: t.text2 }}>{s ? `${formatDistanceShort(s.remainingDistanceM)} to go` : ''}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={nav.muted ? 'Unmute voice' : 'Mute voice'} onPress={() => nav.setMuted(!nav.muted)} style={{ padding: space[3] }}>
          {nav.muted ? <VolumeX size={24} color={t.text2} /> : <Volume2 size={24} color={t.text} />}
        </Pressable>
        <Button label={arrived ? 'Done' : 'End'} kind={arrived ? 'primary' : 'secondary'} icon={X} onPress={() => { nav.stop(); goBack(); }} compact />
      </View>
    </SafeAreaView>
  );
}
