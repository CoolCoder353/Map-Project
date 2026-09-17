import type { Route } from '@wayfinder/shared/schemas';
import { Navigation, Sparkles, Zap } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { useAppConfig } from '../lib/appConfig';
import { formatDistanceShort, formatDuration } from '../lib/format';
import { space, useTheme } from '../lib/theme';
import { Button, Card, NewBadge } from './kit';

export function RouteCard({ route, title, selected, onSelect, onStart }: { route: Route; title: string; selected: boolean; onSelect(): void; onStart(): void }) {
  const t = useTheme();
  const { copy } = useAppConfig();
  const fastest = route.kind === 'fastest';
  const Icon = fastest ? Zap : Sparkles;
  return (
    <Card selected={selected} tone={fastest ? 'accent' : 'explore'} onPress={onSelect}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: fastest ? t.accentSoft : t.exploreSoft }}>
          <Icon size={18} color={fastest ? t.accent : t.explore} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
            <Text style={{ color: t.text2, fontSize: 13 }}>{formatDistanceShort(route.distanceM)}</Text>
            {route.novelty.newKm > 0.05 ? <NewBadge text={copy.newKm(route.novelty.newKm)} /> : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 18, fontVariant: ['tabular-nums'] }}>{formatDuration(route.durationS)}</Text>
          {!fastest && route.extraDurationS > 30 ? <Text style={{ color: t.text2, fontSize: 12 }}>+{formatDuration(route.extraDurationS)}</Text> : null}
        </View>
      </View>
      {selected ? <Button label="Start" icon={Navigation} onPress={onStart} compact style={{ marginTop: space[3], alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}
