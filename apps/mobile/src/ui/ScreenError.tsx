import type { ErrorBoundaryProps } from 'expo-router';
import { Text, View } from 'react-native';
import { space, useTheme } from '../lib/theme';
import { Body, Button, Title } from './kit';

/**
 * Shown in place of a screen that failed to render, instead of the app closing. The root layout
 * exports it as Expo Router's ErrorBoundary; it sits outside the app's providers (they may be
 * what failed), so it uses nothing but the theme.
 */
export function ScreenError({ error, retry }: ErrorBoundaryProps) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center', padding: space[5], gap: space[4] }}>
      <Title>Something went wrong</Title>
      <Body muted>That screen hit a problem. Try again, and if it keeps happening, send feedback from Settings saying what you were doing.</Body>
      <Text style={{ color: t.text3, fontSize: 12 }} selectable>
        {error.message}
      </Text>
      <Button label="Try again" onPress={() => void retry()} />
    </View>
  );
}
