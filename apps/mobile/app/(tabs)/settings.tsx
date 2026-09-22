import type { PlannedRoute, PublicUser, UserSettings } from '@wayfinder/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Car, Footprints, LogOut, MessageSquarePlus, Navigation, RefreshCw, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../../src/lib/api';
import { useAppConfig } from '../../src/lib/appConfig';
import { formatDistanceShort, formatDuration } from '../../src/lib/format';
import { setRouteToNavigate } from '../../src/lib/plannedStore';
import { getServerUrl } from '../../src/lib/server';
import { useSession } from '../../src/lib/session';
import { space, useTheme } from '../../src/lib/theme';
import { contactsSearchEnabled, setContactsSearchEnabled } from '../../src/lib/contacts';
import { requestTrackingPermission, trackingPermission } from '../../src/tracking/background';
import { sqliteQueueStore } from '../../src/tracking/sqliteStore';
import { syncQueue } from '../../src/tracking/sync';
import { Body, Button, Card, Heading, Notice, Segmented, Small, Title } from '../../src/ui/kit';

export default function SettingsScreen() {
  const t = useTheme();
  const { user, setUser, signOut } = useSession();
  const { config } = useAppConfig();
  const qc = useQueryClient();
  const [permission, setPermission] = useState<string>('');
  const [contactsOn, setContactsOn] = useState(false);
  const [queued, setQueued] = useState(0);
  const [server, setServer] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const planned = useQuery({ queryKey: ['planned-routes'], queryFn: () => api.request<{ items: PlannedRoute[] }>('api/planned-routes') });

  const refreshStatus = async () => {
    setContactsOn(await contactsSearchEnabled());
    setPermission(await trackingPermission());
    setQueued(await sqliteQueueStore.count());
  };
  useEffect(() => {
    void refreshStatus();
    void getServerUrl().then(setServer);
  }, []);

  const save = useMutation({
    mutationFn: (patch: Partial<UserSettings>) => api.request<PublicUser>('api/me/settings', { method: 'PATCH', body: patch }),
    onSuccess: (u) => setUser(u),
    onError: (e) => setMessage(errorMessage(e)),
  });

  const toggleTracking = async (on: boolean) => {
    setMessage(null);
    if (on) {
      const p = await requestTrackingPermission();
      setPermission(p);
      if (p !== 'granted') {
        setMessage('Background tracking needs location access set to “Allow all the time”. Open app settings to change it.');
        return;
      }
    }
    save.mutate({ trackingEnabled: on });
  };

  if (!user) return null;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.surface }}>
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3] }}>
        <Title>Settings</Title>
        <Small>{user.email} · {config.appName} at {server}</Small>

        <Heading>Location history</Heading>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Background tracking</Text>
            <Small>Records where you go, even when you’re not navigating. Shows a notification while on.</Small>
          </View>
          <Switch
            accessibilityLabel="Background tracking"
            value={user.settings.trackingEnabled}
            onValueChange={(v) => void toggleTracking(v)}
            trackColor={{ true: t.accent, false: t.borderStrong }}
          />
        </View>
        {permission && permission !== 'granted' && user.settings.trackingEnabled ? (
          <Notice tone="warning">Location access isn’t “Allow all the time”, so nothing is being recorded.</Notice>
        ) : null}
        {message ? <Notice tone="warning">{message}</Notice> : null}
        {message ? <Button label="Open app settings" kind="secondary" compact onPress={() => void Linking.openSettings()} style={{ alignSelf: 'flex-start' }} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <Small style={{ flex: 1 }}>{queued ? `${queued} location points waiting to upload` : 'Everything is uploaded'}</Small>
          <Button
            label="Sync now"
            kind="secondary"
            compact
            icon={RefreshCw}
            onPress={async () => {
              const r = (await syncQueue()) as { error?: unknown } | null;
              setMessage(r?.error ? errorMessage(r.error) : null);
              await refreshStatus();
              void qc.invalidateQueries({ queryKey: ['trips'] });
            }}
          />
        </View>

        <Heading>Search</Heading>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Search my contacts</Text>
            <Small>Type a contact’s name to use their saved address. Contacts stay on your phone; only the address you pick is looked up.</Small>
          </View>
          <Switch
            accessibilityLabel="Search my contacts"
            value={contactsOn}
            onValueChange={async (on) => {
              const now = await setContactsSearchEnabled(on);
              setContactsOn(now);
              if (on && !now) setMessage('Contacts permission was refused, so contact search stays off.');
            }}
            trackColor={{ true: t.accent, false: t.borderStrong }}
          />
        </View>

        <Heading>Route defaults</Heading>
        <Segmented
          label="Default travel mode"
          value={user.settings.defaultMode}
          onChange={(m) => save.mutate({ defaultMode: m })}
          options={[{ value: 'car', label: 'Drive', icon: Car }, { value: 'foot', label: 'Walk', icon: Footprints }]}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Button label="−" kind="secondary" compact onPress={() => save.mutate({ exploreBudgetMin: Math.max(5, user.settings.exploreBudgetMin - 5) })} />
          <Body>Explore routes may take up to {user.settings.exploreBudgetMin} min extra</Body>
          <Button label="+" kind="secondary" compact onPress={() => save.mutate({ exploreBudgetMin: Math.min(60, user.settings.exploreBudgetMin + 5) })} />
        </View>

        <Heading>Planned routes</Heading>
        <Small>Routes sent from the website.</Small>
        {planned.data?.items.length === 0 ? <Body muted>Nothing planned yet.</Body> : null}
        {planned.data?.items.map((p) => (
          <Card key={p.id}>
            <Text style={{ color: t.text, fontWeight: '700' }}>{p.name}</Text>
            <Small>{formatDistanceShort(p.route.distanceM)} · {formatDuration(p.route.durationS)}</Small>
            <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[2] }}>
              <Button label="Start" icon={Navigation} compact onPress={() => { setRouteToNavigate(p.route); router.push('/navigate'); }} />
              <Button label="Remove" kind="ghost" icon={Trash2} compact onPress={async () => { await api.request(`api/planned-routes/${p.id}`, { method: 'DELETE' }); void planned.refetch(); }} />
            </View>
          </Card>
        ))}

        {config.feedbackEnabled ? (
          <>
            <Heading>Feedback</Heading>
            <Small>Found a bug or have an idea? Tell the people who run {config.appName}.</Small>
            <Button label="Send feedback" kind="secondary" icon={MessageSquarePlus} onPress={() => router.push('/feedback')} style={{ alignSelf: 'flex-start' }} />
          </>
        ) : null}

        <Button label="Sign out" kind="secondary" icon={LogOut} onPress={() => void signOut().then(() => router.replace('/sign-in'))} style={{ marginTop: space[4] }} />
        <Small>Delete your account or download your data from the website’s Settings.</Small>
      </ScrollView>
    </SafeAreaView>
  );
}
