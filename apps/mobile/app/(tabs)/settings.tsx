import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { formatAge } from '@kindred-log/shared';
import { useChildStore } from '../../store/useChildStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Card, Row, Segmented } from '../../components/ui';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text className="text-xs font-semibold text-slate-400 uppercase mt-6 mb-2 ml-1">{children}</Text>;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const children = useChildStore((s) => s.children);
  const units = useSettingsStore((s) => s.units);
  const clock = useSettingsStore((s) => s.clock);
  const setSetting = useSettingsStore((s) => s.set);
  const chevron = <ChevronRight color="#475569" size={16} />;

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16, paddingBottom: 32 }}>
      <Text className="text-xl font-bold text-white mt-2">Settings</Text>

      <SectionTitle>Children</SectionTitle>
      <Card>
        {children.map((c) => (
          <Row
            key={c.id}
            label={c.name}
            value={formatAge(c.birthDate, Date.now())}
            onPress={() => router.push(`/child/${c.id}`)}
            right={chevron}
          />
        ))}
        <Row label="Add child" onPress={() => router.push('/child/new')} right={chevron} />
      </Card>

      <SectionTitle>Units</SectionTitle>
      <Segmented
        options={[{ value: 'metric', label: 'Metric (ml, kg, °C)' }, { value: 'imperial', label: 'Imperial (oz, lb, °F)' }]}
        value={units}
        onChange={(v) => setSetting('units', v)}
      />

      <SectionTitle>Clock</SectionTitle>
      <Segmented
        options={[{ value: '24h', label: '24-hour' }, { value: '12h', label: '12-hour' }]}
        value={clock}
        onChange={(v) => setSetting('clock', v)}
      />

      <View className="mt-10 items-center">
        <Text className="text-slate-600 text-xs">Kindred Log · data stays on this device</Text>
      </View>
    </ScrollView>
  );
}
