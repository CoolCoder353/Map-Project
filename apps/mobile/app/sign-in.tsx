import { Link, Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../src/lib/api';
import { useAppConfig } from '../src/lib/appConfig';
import { getServerUrl, setServerUrl } from '../src/lib/server';
import { useSession } from '../src/lib/session';
import { space, useTheme } from '../src/lib/theme';
import { Body, Button, Field, Notice, Small, Title } from '../src/ui/kit';

export default function SignIn() {
  const t = useTheme();
  const { status, signIn } = useSession();
  const { config, copy } = useAppConfig();
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => void getServerUrl().then(setServer, () => undefined), []);
  if (status === 'authenticated') return <Redirect href="/plan" />;

  const ready = !!email.trim() && !!password && !!server.trim();
  const submit = async () => {
    // The keyboard's Go key submits too, so the button's disabled state isn't enough.
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      setServer(await setServerUrl(server));
      await signIn(email.trim(), password);
      router.replace('/plan');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4], flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <Title>{copy.signInTitle(config.appName)}</Title>
          <Body muted>{copy.tagline}</Body>
          <Field label="Server" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint="The address your group’s server runs on." />
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={() => void submit()} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Sign in" onPress={submit} busy={busy} disabled={!ready} />
          <View style={{ alignItems: 'center', gap: space[2] }}>
            <Link href="/register" style={{ color: t.accent, fontWeight: '600', padding: space[2] }}>Create an account with an invite code</Link>
            <Small>Forgot your password? Ask an admin for a reset link.</Small>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
