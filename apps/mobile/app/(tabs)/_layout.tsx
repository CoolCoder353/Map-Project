import { Redirect, Tabs } from 'expo-router';
import { Compass, History, Navigation, Route, Settings } from 'lucide-react-native';
import { useSession } from '../../src/lib/session';
import { useTheme } from '../../src/lib/theme';
import { Loading } from '../../src/ui/kit';

export default function TabsLayout() {
  const t = useTheme();
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'anonymous') return <Redirect href="/sign-in" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.text2,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
      }}
    >
      <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarIcon: ({ color }) => <Navigation size={22} color={color} /> }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: ({ color }) => <Compass size={22} color={color} /> }} />
      <Tabs.Screen name="coverage" options={{ title: 'Coverage', tabBarIcon: ({ color }) => <Route size={22} color={color} /> }} />
      <Tabs.Screen name="trips" options={{ title: 'Trips', tabBarIcon: ({ color }) => <History size={22} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color }) => <Settings size={22} color={color} /> }} />
    </Tabs>
  );
}
