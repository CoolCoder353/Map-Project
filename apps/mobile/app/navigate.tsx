import { formatDistanceShort, formatDuration } from '@wayfinder/nav';
import { useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ArrowRight, ArrowUp, Flag, RotateCcw, Volume2, VolumeX, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { overLimit, thenAfter } from '../src/car/navModel';
import { formatClock } from '../src/lib/format';
import { goBack } from '../src/lib/goBack';
import { PANEL_WIDTH, useLayout } from '../src/lib/layout';
import { takeRouteToNavigate } from '../src/lib/plannedStore';
import { space, useTheme } from '../src/lib/theme';
import { MapCanvas } from '../src/map/MapCanvas';
import { useTurnByTurn } from '../src/nav/useTurnByTurn';
import { Button, Empty, Notice, Press } from '../src/ui/kit';

const iconFor = (sign: number) => (sign === 4 ? Flag : sign <= -2 ? ArrowLeft : sign >= 2 && sign <= 3 ? ArrowRight : sign === 6 || Math.abs(sign) === 8 ? RotateCcw : ArrowUp);

/** The limit as Australian signs show it: black on white in a red ring, in both themes. */
function SpeedSign({ kmh }: { kmh: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`Speed limit ${kmh} km/h`}
      style={{
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

/** How fast you're going, under the limit sign; red when over it, as in the car. */
function Speed({ kmh, over }: { kmh: number; over: boolean }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Your speed ${kmh} km/h${over ? ', over the limit' : ''}`}
      style={{ minWidth: 60, paddingVertical: 4, paddingHorizontal: space[2], borderRadius: 12, alignItems: 'center', backgroundColor: over ? '#d0021b' : t.surface, elevation: 3 }}
    >
      <Text style={{ color: over ? '#ffffff' : t.text, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{kmh}</Text>
      <Text style={{ color: over ? '#ffffff' : t.text2, fontSize: 11, fontWeight: '600' }}>km/h</Text>
    </View>
  );
}

export default function Navigate() {
  const t = useTheme();
  const { resume } = useLocalSearchParams<{ resume?: string }>();
  // Resuming follows the trip already running (started in the car, say) instead of starting one.
  const initial = useMemo(() => (resume === '1' ? null : takeRouteToNavigate()), [resume]);
  const nav = useTurnByTurn(initial);
  const { sideBySide } = useLayout();
  // The trip ended without this screen (arrived and closed by itself, or ended in the car). Not
  // after End here, which goes back itself.
  const leaving = useRef(false);
  useEffect(() => {
    if (nav.ended && !leaving.current) {
      leaving.current = true;
      goBack();
    }
  }, [nav.ended]);

  if (!initial && !(resume === '1' && nav.route)) {
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
  const then = nav.route && !arrived ? thenAfter(nav.route, s) : null;
  const ThenIcon = iconFor(then?.sign ?? 0);
  // Only while on the route: off it, the road you are on isn't the one the limit is for.
  const limitKmh = s?.status === 'navigating' ? s.speedLimitKmh : null;
  // A speedometer is for driving; walking, it's only something else to look at.
  const speedKmh = nav.route?.mode === 'car' && nav.speedMps != null ? Math.round(nav.speedMps * 3.6) : null;
  const banner = nav.route?.kind === 'fastest' ? t.accent : t.explore;

  // The same views in every window size: the map is never remounted, so a trip keeps running
  // and following you through a rotation or a fold. Narrow: banner, map, bar stacked. Wide: the
  // banner and bar stack in a left panel and the map fills the rest (taken out of the flow).
  const panel = sideBySide ? { width: PANEL_WIDTH } : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={panel}>
      <View style={{ backgroundColor: banner, padding: space[4], flexDirection: 'row', alignItems: 'center', gap: space[4] }} accessibilityLiveRegion="polite">
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
      {then ? (
        // The banner's colour, darkened: part of it, but read second.
        <View accessible accessibilityLabel={`Then ${then.text.charAt(0).toLowerCase()}${then.text.slice(1)}`} style={{ backgroundColor: banner, paddingHorizontal: space[4], paddingBottom: space[3], marginTop: -space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: space[3], borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.22)' }}>
            <Text style={{ color: '#ffffff', fontWeight: '700' }}>Then</Text>
            <ThenIcon size={20} color="#ffffff" />
            <Text style={{ color: '#ffffff', fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{then.text}</Text>
          </View>
        </View>
      ) : null}
      {nav.rerouting ? <Notice tone="warning">Finding a new route…</Notice> : null}
      {s?.status === 'offRoute' && !nav.rerouting ? <Notice tone="warning">Off route</Notice> : null}
      {nav.error ? <Notice tone="error">{nav.error}</Notice> : null}
      </View>
      <View style={sideBySide ? { position: 'absolute', top: 0, bottom: 0, left: PANEL_WIDTH, right: 0 } : { flex: 1 }}>
        {/* Follows you close up. No fitting to the whole route: that zooms out of the drive. */}
        <MapCanvas style={{ flex: 1 }} routes={nav.route ? [nav.route] : []} selectedRouteId={nav.route?.id ?? null} track={nav.travelled.length >= 2 ? nav.travelled : null} followUser />
        {limitKmh != null || speedKmh != null ? (
          <View style={{ position: 'absolute', top: space[3], left: space[3], alignItems: 'center', gap: space[2] }}>
            {limitKmh != null ? <SpeedSign kmh={limitKmh} /> : null}
            {speedKmh != null ? <Speed kmh={speedKmh} over={overLimit(limitKmh, speedKmh)} /> : null}
          </View>
        ) : null}
      </View>
      <View style={[{ flexDirection: 'row', alignItems: 'center', padding: space[4], gap: space[3], backgroundColor: t.surface }, panel, sideBySide && { marginTop: 'auto' }]}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2], flexWrap: 'wrap' }}>
            <Text style={{ color: t.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{s ? formatDuration(s.remainingDurationS) : '–'}</Text>
            {s && !arrived ? <Text style={{ color: t.text2, fontSize: 15, fontVariant: ['tabular-nums'] }}>{`Arrive ${formatClock(Date.now() + s.remainingDurationS * 1000)}`}</Text> : null}
          </View>
          <Text style={{ color: t.text2 }}>{s ? `${formatDistanceShort(s.remainingDistanceM)} to go` : ''}</Text>
        </View>
        <Press accessibilityRole="button" accessibilityLabel={nav.muted ? 'Unmute voice' : 'Mute voice'} onPress={() => nav.setMuted(!nav.muted)} style={({ hovered }) => ({ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: hovered ? t.surface3 : 'transparent' })}>
          {nav.muted ? <VolumeX size={24} color={t.text2} /> : <Volume2 size={24} color={t.text} />}
        </Press>
        <Button label={arrived ? 'Done' : 'End'} kind={arrived ? 'primary' : 'secondary'} icon={X} onPress={() => { leaving.current = true; nav.stop(); goBack(); }} compact />
      </View>
    </SafeAreaView>
  );
}
