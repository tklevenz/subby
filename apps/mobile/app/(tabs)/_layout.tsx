import { Tabs } from 'expo-router';
import { ChartLine, History, House, Settings } from 'lucide-react-native';
import { colors } from '../../theme/colors';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.violetSoft,
        tabBarInactiveTintColor: colors.inkFaint,
        sceneStyle: { backgroundColor: colors.ground },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: ({ color, size }) => <History color={color} size={size} /> }} />
      <Tabs.Screen name="trends" options={{ title: 'Trends', tabBarIcon: ({ color, size }) => <ChartLine color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }} />
    </Tabs>
  );
}
