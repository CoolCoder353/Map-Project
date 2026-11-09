import { formatDistanceShort, formatDuration } from '@wayfinder/nav';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Navigation, X } from 'lucide-react-native';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { type EndedTrip, navigation, NOTHING_RECORDED_M } from '../nav/navigationService';
import { space, useTheme } from '../lib/theme';
import { MIN_TARGET, Press } from './kit';

/** How long the summary of a trip that ended stays up, unless closed first. */
export const ENDED_SHOWN_MS = 5 * 60_000;

/** A trip is running, or one just ended and its summary shows: the screens below leave the top to the banner. */
export function useBannerShowing(now: () => number = Date.now): boolean {
  return useSyncExternalStore(navigation.subscribe, () => {
    const s = navigation.getSnapshot();
    return s.active || (s.ended !== null && now() - s.ended.at < ENDED_SHOWN_MS);
  });
}

/** What a trip that ended says about itself: where to, how far and how long, or that nothing was kept. */
export function endedSummary(e: EndedTrip): string {
  const where = e.destinationName ? ` to ${e.destinationName}` : '';
  const how = e.arrived ? `Arrived${where}` : `Trip${where} ended`;
  // Too short to show on Trips: say so, rather than leave it missing with no word why (P97).
  if (e.distanceM < NOTHING_RECORDED_M) return `${how}. You hadn’t moved, so nothing was added to Trips.`;
  return `${how}: ${formatDistanceShort(e.distanceM)} in ${formatDuration(e.durationS)}. It’s in Trips once it has uploaded.`;
}

/**
 * Over the tabs: while a trip runs without the Navigate screen open, a way back to it. Once one
 * ends, what it came to (P23), with Resume, for a trip ended by mistake or arrived at too early
 * (P63). Its own status bar is light on the banner's blue (P25), and the screens below leave the
 * top inset to it (P24, [useBannerShowing]).
 */
export function NavigatingBanner() {
  const t = useTheme();
  const snap = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  const showing = useBannerShowing();
  // The summary goes by itself after a while.
  const [, tick] = useState(0);
  useEffect(() => {
    if (snap.active || !snap.ended) return;
    const id = setTimeout(() => tick((n) => n + 1), Math.max(0, snap.ended.at + ENDED_SHOWN_MS - Date.now()));
    return () => clearTimeout(id);
  }, [snap.active, snap.ended]);
  if (!showing) return null;
  if (snap.active) {
    return (
      <SafeAreaView edges={['top']} style={{ backgroundColor: t.accent }}>
        <StatusBar style="light" />
        <Press
          accessibilityRole="button"
          accessibilityLabel="Back to directions"
          onPress={() => router.push('/navigate?resume=1')}
          style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: MIN_TARGET, opacity: hovered ? 0.9 : 1 })}
        >
          <Navigation size={20} color="#ffffff" />
          <Text style={{ color: '#ffffff', fontWeight: '700', flex: 1 }} numberOfLines={1}>
            {snap.destinationName ? `Navigating to ${snap.destinationName}` : 'Navigating'}
          </Text>
          <Text style={{ color: '#ffffff', fontWeight: '600' }}>Back to directions</Text>
        </Press>
      </SafeAreaView>
    );
  }
  const ended = snap.ended!;
  const resume = () => {
    navigation.start(ended.route, { destinationName: ended.destinationName ?? undefined, askForNotifications: true });
    router.push('/navigate?resume=1');
  };
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: t.surface2 }}>
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[4], paddingVertical: space[2], minHeight: MIN_TARGET }}>
        <Text style={{ color: t.text, flex: 1 }}>{endedSummary(ended)}</Text>
        <Press accessibilityRole="button" accessibilityLabel={`Resume directions${ended.destinationName ? ` to ${ended.destinationName}` : ''}`} onPress={resume} style={{ minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: space[2] }}>
          <Text style={{ color: t.accent, fontWeight: '700' }}>Resume</Text>
        </Press>
        <Press accessibilityRole="button" accessibilityLabel="Close" onPress={navigation.dismissEnded} style={{ minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}>
          <X size={20} color={t.text2} />
        </Press>
      </View>
    </SafeAreaView>
  );
}

/** The safe-area edges a tab screen keeps: none at the top while the banner is there (it has the status bar's inset already). */
export function useTopEdges(): Edge[] {
  return useBannerShowing() ? [] : ['top'];
}
