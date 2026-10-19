import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import {
  activeSleep,
  describeDiaper,
  describeFeed,
  lastOfType,
  lastWakeAt,
} from '@kindred-log/shared';
import { Droplets, Moon, Sun, Timer } from 'lucide-react-native';
import { useLogStore } from '../store/useLogStore';
import { formatDuration, formatRelative, useNow } from '../store/timeHelpers';
import ChildSwitcher from './ChildSwitcher';

function Card({
  icon,
  title,
  children,
  wide,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <View
      className={`${wide ? 'w-full' : 'flex-1 min-w-36'} bg-slate-800/60 rounded-xl p-3 border border-slate-700/50`}
    >
      <View className="flex-row items-center mb-1">
        {icon}
        <Text className="text-slate-400 text-xs ml-1 font-medium">{title}</Text>
      </View>
      {children}
    </View>
  );
}

export default function StatusHeader() {
  const logs = useLogStore((s) => s.logs);
  const now = useNow();

  const summary = useMemo(() => {
    // Completed feeds only; a running breastfeed shows in the timers bar instead.
    const feed = logs.find((l) => l.logType === 'feed' && l.endedAt !== null);
    const diaper = lastOfType(logs, 'diaper');
    return {
      feed: feed?.payload.type === 'feed' ? { at: feed.startedAt, detail: describeFeed(feed.payload) } : null,
      diaper: diaper ? { at: diaper.startedAt, detail: describeDiaper(diaper.payload) } : null,
      sleepStart: activeSleep(logs)?.startedAt ?? null,
      wakeAt: lastWakeAt(logs),
    };
  }, [logs]);

  return (
    <View className="mx-4 mt-2 mb-1">
      <ChildSwitcher />

      <View className="flex-row flex-wrap gap-3">
        <Card icon={<Droplets color="#67e8f9" size={16} />} title="Last Feed">
          {summary.feed ? (
            <>
              <Text className="text-sm font-semibold text-white">{formatRelative(now - summary.feed.at)}</Text>
              <Text className="text-xs text-slate-400 mt-0.5">{summary.feed.detail}</Text>
            </>
          ) : (
            <Text className="text-sm text-slate-500">No feeds yet</Text>
          )}
        </Card>

        <Card icon={<Droplets color="#fbbf24" size={16} />} title="Last Diaper">
          {summary.diaper ? (
            <>
              <Text className="text-sm font-semibold text-white">{formatRelative(now - summary.diaper.at)}</Text>
              <Text className="text-xs text-slate-400 mt-0.5">{summary.diaper.detail}</Text>
            </>
          ) : (
            <Text className="text-sm text-slate-500">No diapers yet</Text>
          )}
        </Card>

        <Card
          wide
          icon={summary.sleepStart !== null ? <Moon color="#a78bfa" size={16} /> : <Sun color="#fcd34d" size={16} />}
          title={summary.sleepStart !== null ? 'Sleeping' : 'Wake Window'}
        >
          {summary.sleepStart !== null ? (
            <View className="flex-row items-center">
              <Timer color="#a78bfa" size={14} />
              <Text className="text-sm font-semibold text-violet-300 ml-1.5">
                {formatDuration(now - summary.sleepStart)}
              </Text>
            </View>
          ) : summary.wakeAt !== null ? (
            <Text className="text-sm text-amber-200/80 font-medium">
              Awake for {formatDuration(now - summary.wakeAt)}
            </Text>
          ) : (
            <Text className="text-sm text-slate-500">No sleep tracked</Text>
          )}
        </Card>
      </View>
    </View>
  );
}
