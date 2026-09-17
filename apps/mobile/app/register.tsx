import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../src/lib/api';
import { useAppConfig } from '../src/lib/appConfig';
import { getServerUrl, setServerUrl } from '../src/lib/server';
import { useSession } from '../src/lib/session';
import { space, useTheme } from '../src/lib/theme';
import { Body, Button, Field, Notice, Title } from '../src/ui/kit';

export default function Register() {
  const t = useTheme();
  const { register } = useSession();
  const { config, copy } = useAppConfig();
  const [server, setServer] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void getServerUrl().then(setServer), []);

  const submit = async () => {
    if (password.length < 10) return setError('Use at least 10 characters for your password.');
    setBusy(true);
    setError(null);
    try {
      await setServerUrl(server);
      await register(code.trim(), email.trim(), password);
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
          <Title>Join {config.appName}</Title>
          <Body muted>{copy.registerIntro}</Body>
          <Field label="Server" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Field label="Invite code" value={code} onChangeText={(s) => setCode(s.toUpperCase())} autoCapitalize="characters" autoCorrect={false} placeholder="XXXX-XXXX-XXXX" />
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry hint="At least 10 characters." />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Create account" onPress={submit} busy={busy} disabled={!code || !email || !password || !server} />
          <Link href="/sign-in" style={{ color: t.accent, fontWeight: '600', textAlign: 'center', padding: space[2] }}>I already have an account</Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
