import { type PlannedRoute, PlannedRouteListSchema, PublicUserSchema, type UserSettings } from '@wayfinder/shared/schemas';
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
  // A message, and whether the fix is in the phone's settings for this app.
  const [message, setMessageState] = useState<{ text: string; openSettings: boolean } | null>(null);
  const setMessage = (text: string | null, openSettings = false) => setMessageState(text ? { text, openSettings } : null);
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const planned = useQuery({ queryKey: ['planned-routes'], queryFn: () => api.request('api/planned-routes', { schema: PlannedRouteListSchema }) });

  // Each check stands alone: one failing phone service shouldn't blank the others.
  const refreshStatus = async () => {
    await Promise.all([
      contactsSearchEnabled().then(setContactsOn, () => undefined),
      trackingPermission().then(setPermission, () => undefined),
      sqliteQueueStore.count().then(setQueued, () => undefined),
    ]);
  };
  useEffect(() => {
    void refreshStatus();
    void getServerUrl().then(setServer, () => undefined);
  }, []);

  const save = useMutation({
    mutationFn: (patch: Partial<UserSettings>) => api.request('api/me/settings', { method: 'PATCH', body: patch, schema: PublicUserSchema }),
    onSuccess: (u) => setUser(u),
    onError: (e) => setMessage(`Couldn’t save that setting. ${errorMessage(e)}`),
  });

  const toggleTracking = async (on: boolean) => {
    setMessage(null);
    if (on) {
      let p: Awaited<ReturnType<typeof requestTrackingPermission>>;
      try {
        p = await requestTrackingPermission();
      } catch {
        p = 'denied';
      }
      setPermission(p);
      if (p !== 'granted') {
        setMessage('Background tracking needs location access set to “Allow all the time”. Open app settings to change it.', true);
        return;
      }
    }
    save.mutate({ trackingEnabled: on });
  };

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setMessage(null);
    try {
      const r = (await syncQueue()) as { error?: unknown; dropped?: number } | null;
      setMessage(
        r?.error
          ? errorMessage(r.error)
          : r?.dropped
            ? `${r.dropped} point${r.dropped === 1 ? '' : 's'} the server couldn’t accept were discarded.`
            : null,
      );
      void qc.invalidateQueries({ queryKey: ['trips'] });
    } catch (e) {
      setMessage(`Couldn’t upload. ${errorMessage(e)}`);
    } finally {
      await refreshStatus();
      setSyncing(false);
    }
  };

  const toggleContacts = async (on: boolean) => {
    setMessage(null);
    try {
      const now = await setContactsSearchEnabled(on);
      setContactsOn(now);
      if (on && !now) setMessage('Contacts permission was refused, so contact search stays off.', true);
    } catch (e) {
      setMessage(`Couldn’t change contact search. ${errorMessage(e)}`);
    }
  };

  const removePlanned = async (id: string) => {
    if (removing) return;
    setRemoving(id);
    setMessage(null);
    try {
      await api.request(`api/planned-routes/${id}`, { method: 'DELETE' });
      await planned.refetch();
    } catch (e) {
      setMessage(`Couldn’t remove that route. ${errorMessage(e)}`);
    } finally {
      setRemoving(null);
    }
  };

  const startPlanned = (p: PlannedRoute) => {
    // A route drawn on the website with too few points has nothing to follow.
    if (!p.route?.geometry || p.route.geometry.length < 2) return setMessage('That route can’t be followed. Plan it again on the website.');
    setRouteToNavigate(p.route);
    router.push('/navigate');
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
            disabled={save.isPending}
            onValueChange={(v) => void toggleTracking(v)}
            trackColor={{ true: t.accent, false: t.borderStrong }}
          />
        </View>
        {permission && permission !== 'granted' && user.settings.trackingEnabled ? (
          <Notice tone="warning">Location access isn’t “Allow all the time”, so nothing is being recorded.</Notice>
        ) : null}
        {message ? <Notice tone="warning">{message.text}</Notice> : null}
        {message?.openSettings ? (
          <Button label="Open app settings" kind="secondary" compact onPress={() => void Linking.openSettings().catch(() => undefined)} style={{ alignSelf: 'flex-start' }} />
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <Small style={{ flex: 1 }}>{queued ? `${queued} location points waiting to upload` : 'Everything is uploaded'}</Small>
          <Button
            label="Sync now"
            kind="secondary"
            compact
            icon={RefreshCw}
            busy={syncing}
            onPress={() => void syncNow()}
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
            onValueChange={(on) => void toggleContacts(on)}
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
          {/* Off while saving: each step counts from the saved value, so quick taps would be lost. */}
          <Button label="−" kind="secondary" compact disabled={save.isPending} onPress={() => save.mutate({ exploreBudgetMin: Math.max(5, user.settings.exploreBudgetMin - 5) })} />
          <Body style={{ flexShrink: 1 }}>Explore routes may take up to {user.settings.exploreBudgetMin} min extra</Body>
          <Button label="+" kind="secondary" compact disabled={save.isPending} onPress={() => save.mutate({ exploreBudgetMin: Math.min(60, user.settings.exploreBudgetMin + 5) })} />
        </View>

        <Heading>Planned routes</Heading>
        <Small>Routes sent from the website.</Small>
        {planned.error ? <Notice tone="error">{errorMessage(planned.error)}</Notice> : null}
        {planned.data?.items.length === 0 ? <Body muted>Nothing planned yet.</Body> : null}
        {planned.data?.items.map((p) => (
          <Card key={p.id}>
            <Text style={{ color: t.text, fontWeight: '700' }}>{p.name}</Text>
            <Small>{formatDistanceShort(p.route.distanceM)} · {formatDuration(p.route.durationS)}</Small>
            <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[2] }}>
              <Button label="Start" icon={Navigation} compact onPress={() => startPlanned(p)} />
              <Button label="Remove" kind="ghost" icon={Trash2} compact busy={removing === p.id} disabled={!!removing} onPress={() => void removePlanned(p.id)} />
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

        <Button label="Sign out" kind="secondary" icon={LogOut} onPress={() => void signOut().finally(() => router.replace('/sign-in'))} style={{ marginTop: space[4] }} />
        <Small>Delete your account or download your data from the website’s Settings.</Small>
      </ScrollView>
    </SafeAreaView>
  );
}
