import { t } from '@subby/shared/i18n';
import { Tabs } from 'expo-router';
import { ChartLine, ClockRotateLeft, Gear, House } from '../../components/icons';
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
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
      <Tabs.Screen name="history" options={{ title: t('tabs.history'), tabBarIcon: ({ color, size }) => <ClockRotateLeft color={color} size={size} /> }} />
      <Tabs.Screen name="trends" options={{ title: t('tabs.trends'), tabBarIcon: ({ color, size }) => <ChartLine color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarIcon: ({ color, size }) => <Gear color={color} size={size} /> }} />
    </Tabs>
  );
}
