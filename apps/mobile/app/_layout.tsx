import '../src/tracking/background';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppConfigProvider } from '../src/lib/appConfig';
import { SessionProvider } from '../src/lib/session';
import { useTheme } from '../src/lib/theme';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

function Root() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppConfigProvider>
          <SessionProvider>
            <Root />
          </SessionProvider>
        </AppConfigProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
