import { Redirect, router } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../src/lib/session';
import { space, useTheme } from '../src/lib/theme';
import { Body, Button, Loading, Title } from '../src/ui/kit';

export default function Index() {
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'offline') return <Offline />;
  return <Redirect href={status === 'authenticated' ? '/plan' : '/sign-in'} />;
}

/** Signed in on this phone, but the server didn't answer when the app opened. */
function Offline() {
  const t = useTheme();
  const { retry } = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center', padding: space[5], gap: space[4] }}>
      <View style={{ alignItems: 'center', gap: space[3] }}>
        <CloudOff size={32} color={t.text3} />
        <Title>Can’t reach the server</Title>
        <Body muted style={{ textAlign: 'center' }}>You’re still signed in. Check your connection, then try again.</Body>
      </View>
      <Button
        label="Try again"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          await retry().finally(() => setBusy(false));
        }}
      />
      <Button label="Sign in with a different server" kind="ghost" onPress={() => router.push('/sign-in')} />
    </SafeAreaView>
  );
}
