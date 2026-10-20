import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Cake, Camera, ChevronRight, PartyPopper } from 'lucide-react-native';
import {
  MILESTONES,
  ageInDays,
  formatAgeLong,
  formatLength,
  formatPercentile,
  formatWeight,
  growthAgeMonths,
  growthPercentile,
  milestoneLabel,
  nextAgeMilestone,
  type Child,
  type GrowthMeasure,
  type LogEntry,
  type LogType,
} from '@kindred-log/shared';
import ChildAvatar from '../../../components/ChildAvatar';
import PhotoMenu from '../../../components/PhotoMenu';
import { Button, Card, Row } from '../../../components/ui';
import { fetchLogs } from '../../../store/queries';
import { childSummary, useChildStore } from '../../../store/useChildStore';
import { useActiveChild } from '../../../store/useActiveChild';
import { useLogStore } from '../../../store/useLogStore';
import { useSettingsStore } from '../../../store/useSettingsStore';

const PROFILE_TYPES: LogType[] = ['growth', 'milestone'];
const fmtDate = (ms: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(ms).toLocaleDateString([], opts);
const isoToMs = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** A child's own page: photo, age, growth and milestones at a glance, and their settings. */
export default function ChildProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const child = useChildStore((s) => s.children.find((c) => c.id === id));
  if (!child) return <Stack.Screen options={{ title: 'Child' }} />;
  return <Profile child={child} />;
}

function Profile({ child }: { child: Child }) {
  const units = useSettingsStore((s) => s.units);
  const isActive = useActiveChild()?.id === child.id;
  const revision = useLogStore((s) => s.revision);
  const [menu, setMenu] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<{ total: number; firstAt: number | null } | null>(null);
  const now = Date.now();

  // Read straight from the database: this child may not be the active one.
  useEffect(() => {
    let alive = true;
    Promise.all([fetchLogs(child.id, { types: PROFILE_TYPES }), childSummary(child.id)]).then(([rows, s]) => {
      if (!alive) return;
      setLogs(rows);
      setSummary(s);
    });
    return () => {
      alive = false;
    };
  }, [child.id, revision]);

  const latest = useMemo(() => {
    const pick = (measure: GrowthMeasure) => {
      for (let i = logs.length - 1; i >= 0; i--) {
        const p = logs[i].payload;
        if (p.type !== 'growth') continue;
        const value = measure === 'weightKg' ? p.weightG && p.weightG / 1000 : measure === 'lengthCm' ? p.heightCm : p.headCm;
        if (value) {
          const pct = growthPercentile(measure, child.sex, growthAgeMonths(child, logs[i].startedAt), value);
          return { value, at: logs[i].startedAt, pct };
        }
      }
      return null;
    };
    return { weight: pick('weightKg'), length: pick('lengthCm'), head: pick('headCm') };
  }, [logs, child]);

  const milestones = useMemo(() => {
    const done = logs.filter((l) => l.payload.type === 'milestone').reverse();
    const checklist = new Set(done.flatMap((l) => (l.payload.type === 'milestone' && l.payload.key ? [l.payload.key] : [])));
    return { recent: done.slice(0, 3), checklist: checklist.size };
  }, [logs]);

  const next = nextAgeMilestone(child.birthDate, now);
  const celebrate = next.days === 0 ? `${next.label} old today!` : next.days <= (next.label.includes('year') ? 30 : 7) ? `Turns ${next.label} in ${next.days} day${next.days === 1 ? '' : 's'}` : null;

  const openGrowth = async () => {
    if (!isActive) await useSettingsStore.getState().set('activeChildId', child.id);
    router.push('/growth');
  };

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Stack.Screen
        options={{
          title: child.name,
          headerRight: () => (
            <Pressable onPress={() => router.push(`/child/${child.id}/edit`)} hitSlop={10}>
              <Text className="text-violet-300 text-base">Edit</Text>
            </Pressable>
          ),
        }}
      />

      <View className="items-center rounded-3xl bg-violet-500/10 border border-violet-500/30 px-4 pt-6 pb-5">
        <Pressable onPress={() => setMenu(true)}>
          <ChildAvatar child={child} size={120} ring={isActive} />
          <View className="absolute bottom-1 right-1 w-9 h-9 rounded-full bg-slate-900 border border-slate-700 items-center justify-center">
            <Camera color="#c4b5fd" size={16} />
          </View>
        </Pressable>
        <Text className="text-white text-2xl font-bold mt-3">{child.name}</Text>
        <Text className="text-violet-200 mt-1">{formatAgeLong(child.birthDate, now)}</Text>
        <Text className="text-slate-400 text-xs mt-1">
          Born {fmtDate(isoToMs(child.birthDate))}
        </Text>
        {celebrate ? (
          <View className="flex-row items-center mt-3 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/40">
            {next.days === 0 ? <PartyPopper color="#fcd34d" size={14} /> : <Cake color="#fcd34d" size={14} />}
            <Text className="text-amber-200 text-xs font-medium ml-1.5">{celebrate}</Text>
          </View>
        ) : null}
        {!isActive ? (
          <View className="self-stretch">
            <Button label={`Switch to ${child.name}`} onPress={() => useSettingsStore.getState().set('activeChildId', child.id)} />
          </View>
        ) : null}
      </View>
      <PhotoMenu
        visible={menu}
        hasPhoto={child.photoUri !== null}
        onClose={() => setMenu(false)}
        onChange={(photoUri) => useChildStore.getState().updateChild(child.id, { photoUri })}
      />

      <View className="flex-row gap-2 mt-4">
        <Stat label="Days old" value={Math.max(0, ageInDays(child.birthDate, now)).toLocaleString()} />
        <Stat label="Entries" value={summary ? summary.total.toLocaleString() : '–'} />
        <Stat label="Tracking since" value={summary?.firstAt ? fmtDate(summary.firstAt, { month: 'short', year: 'numeric' }) : '–'} />
      </View>

      <SectionTitle>Growth</SectionTitle>
      <Pressable onPress={openGrowth} className="flex-row bg-slate-900 border border-slate-800 rounded-2xl p-3 gap-2">
        <GrowthTile label="Weight" m={latest.weight} format={(v) => formatWeight(v * 1000, units)} />
        <GrowthTile label="Length" m={latest.length} format={(v) => formatLength(v, units)} />
        <GrowthTile label="Head" m={latest.head} format={(v) => formatLength(v, units)} />
        <View className="justify-center">
          <ChevronRight color="#475569" size={16} />
        </View>
      </Pressable>
      {!child.sex || child.sex === 'other' ? (
        <Text className="text-slate-500 text-xs mt-2 ml-1">Set girl or boy under Edit to see WHO percentiles.</Text>
      ) : null}

      <SectionTitle>Milestones</SectionTitle>
      <View className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-white font-semibold">{milestones.checklist} of {MILESTONES.length} checklist milestones</Text>
        </View>
        <View className="h-2 rounded-full bg-slate-800 mt-2 overflow-hidden">
          <View className="h-2 rounded-full bg-orange-300" style={{ width: `${(milestones.checklist / MILESTONES.length) * 100}%` }} />
        </View>
        {milestones.recent.length ? (
          milestones.recent.map((l) => (
            <Pressable key={l.id} onPress={() => router.push(`/entry/${l.id}`)} className="flex-row items-center mt-3">
              <View className="w-1.5 h-1.5 rounded-full bg-orange-300 mr-2" />
              <Text className="flex-1 text-slate-200 text-sm" numberOfLines={1}>
                {l.payload.type === 'milestone' ? (l.payload.custom ?? (l.payload.key ? milestoneLabel(l.payload.key) : 'Milestone')) : ''}
              </Text>
              <Text className="text-slate-500 text-xs">{fmtDate(l.startedAt)}</Text>
            </Pressable>
          ))
        ) : (
          <Text className="text-slate-500 text-sm mt-3">Log milestones from Home → More → Milestone.</Text>
        )}
      </View>

      <SectionTitle>Settings</SectionTitle>
      <Card>
        <Row label="Edit details" onPress={() => router.push(`/child/${child.id}/edit`)} right={<ChevronRight color="#475569" size={16} />} />
      </Card>
    </ScrollView>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text className="text-xs font-semibold text-slate-400 uppercase mt-6 mb-2 ml-1">{children}</Text>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3">
      <Text className="text-slate-400 text-[11px]">{label}</Text>
      <Text className="text-white text-base font-semibold mt-0.5" numberOfLines={1}>{value}</Text>
    </View>
  );
}

function GrowthTile({
  label,
  m,
  format,
}: {
  label: string;
  m: { value: number; at: number; pct: number | null } | null;
  format: (v: number) => string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-slate-400 text-[11px]">{label}</Text>
      {m ? (
        <>
          <Text className="text-white text-sm font-semibold mt-0.5" numberOfLines={1}>{format(m.value)}</Text>
          <Text className="text-slate-500 text-[10px]" numberOfLines={1}>
            {m.pct !== null ? `${formatPercentile(m.pct)} · ` : ''}{fmtDate(m.at, { month: 'short', year: '2-digit' })}
          </Text>
        </>
      ) : (
        <Text className="text-slate-600 text-sm mt-0.5">–</Text>
      )}
    </View>
  );
}
