import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLogStore } from '../store/useLogStore';
import StatusHeader from '../components/StatusHeader';
import LogTimeline from '../components/LogTimeline';
import QuickActionDock from '../components/QuickActionDock';
import FeedModal from '../components/FeedModal';

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const logs = useLogStore((s) => s.logs);
  const activeChildId = useLogStore((s) => s.activeChildId);
  const isLoading = useLogStore((s) => s.isLoading);
  const loadLogs = useLogStore((s) => s.loadLogs);
  const updateLog = useLogStore((s) => s.updateLog);

  const [feedModalOpen, setFeedModalOpen] = useState(false);

  // Derive active sleep from store
  const activeSleep = useMemo(
    () =>
      logs.find(
        (l) => l.logType === 'sleep' && l.payload.type === 'sleep' && l.payload.endedAt === null,
      ),
    [logs],
  );

  // Load logs on mount & whenever the child changes
  useEffect(() => {
    loadLogs(activeChildId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChildId]);

  const handleEndSleep = useCallback(
    async (id: string) => {
      await updateLog(id, { endedAt: Date.now() });
    },
    [updateLog],
  );

  if (isLoading && logs.length === 0) {
    return (
      <View className="flex-1 bg-slate-950 justify-center items-center" style={{ paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="#a78bfa" />
        <Text className="text-slate-400 mt-3">Loading logs…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950" style={{ paddingTop: insets.top }}>
      <View className="flex-1">
        <StatusHeader />
        <LogTimeline />
      </View>

      <QuickActionDock
        onFeedPress={() => setFeedModalOpen(true)}
        activeSleepId={activeSleep?.id}
        onEndSleep={handleEndSleep}
      />

      <FeedModal
        visible={feedModalOpen}
        onClose={() => setFeedModalOpen(false)}
      />
    </View>
  );
}
