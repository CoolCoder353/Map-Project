import { router } from 'expo-router';
import { Navigation } from 'lucide-react-native';
import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { navigation } from '../nav/navigationService';
import { space, useTheme } from '../lib/theme';
import { MIN_TARGET, Press } from './kit';

/** While a trip runs without the Navigate screen open (started in the car, say): a way back to it. */
export function NavigatingBanner() {
  const t = useTheme();
  const snap = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  if (!snap.active) return null;
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: t.accent }}>
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
