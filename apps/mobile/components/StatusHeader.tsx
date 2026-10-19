import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { useLogStore } from '../store/useLogStore';
import { formatDuration, formatRelative } from '../store/timeHelpers';
import type { LogEntry } from '@kindred/shared';
import { Baby, Droplets, Moon, Sun, Timer } from 'lucide-react-native';

/**
 * Lightweight double-stopwatch that keeps a single RAF loop alive
 * and derives two elapsed durations from stable reference timestamps.
 */
function useLiveElapsed(
  sleepStartMs: number | undefined,
  awakeStartMs: number | undefined,
) {
  const sleepRef = useRef(sleepStartMs);
  const awakeRef = useRef(awakeStartMs);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    sleepRef.current = sleepStartMs;
    awakeRef.current = awakeStartMs;
  }, [sleepStartMs, awakeStartMs]);

  useEffect(() => {
    let rafId: number;
    const loop = () => {
      setTick(Date.now());
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return {
    sleepMs: sleepRef.current !== undefined ? tick - sleepRef.current : 0,
    awakeMs: awakeRef.current !== undefined ? tick - awakeRef.current : 0,
  };
}

type StatusSummary = {
  feed: { relative: string; detail: string } | null;
  diaper: { relative: string; detail: string } | null;
  activeSleepStartMs: number | null;
  lastAwakeStartMs: number | null;
};

function computeSummary(logs: LogEntry[]): StatusSummary {
  const now = Date.now();

  // Last feed (logs are sorted startedAt DESC)
  const lastFeed = logs.find((l) => l.logType === 'feed');
  const feed = lastFeed
    ? {
        relative: formatRelative(now - lastFeed.startedAt),
        detail: lastFeed.payload.type === 'feed'
          ? lastFeed.payload.method === 'bottle'
            ? `${lastFeed.payload.amountMl ?? '\u2014'}ml Bottle`
            : lastFeed.payload.method === 'solids'
              ? 'Solids'
              : lastFeed.payload.method.includes('left')
                ? 'Left Breast'
                : lastFeed.payload.method.includes('right')
                  ? 'Right Breast'
                  : 'Both Breasts'
          : '\u2014',
      }
    : null;

  // Last diaper
  const lastDiaper = logs.find((l) => l.logType === 'diaper');
  const diaper = lastDiaper
    ? {
        relative: formatRelative(now - lastDiaper.startedAt),
        detail: lastDiaper.payload.type === 'diaper'
          ? lastDiaper.payload.condition.charAt(0).toUpperCase()
              + lastDiaper.payload.condition.slice(1)
          : '\u2014',
      }
    : null;

  // Active sleep → live tick source
  const activeSleep = logs.find(
    (l) => l.logType === 'sleep' && l.payload.type === 'sleep' && l.payload.endedAt === null,
  );

  // Most recent ended sleep → wake-window timer source
  const lastEndedSleep = logs.find(
    (l) =>
      l.logType === 'sleep' &&
      l.payload.type === 'sleep' &&
      l.payload.endedAt !== null,
  );
  const lastAwakeStartMs = lastEndedSleep?.payload.type === 'sleep'
    ? lastEndedSleep.payload.endedAt
    : null;

  return {
    feed,
    diaper,
    activeSleepStartMs: activeSleep?.startedAt ?? null,
    lastAwakeStartMs,
  };
}

export default function StatusHeader() {
  const logs = useLogStore((s) => s.logs);
  const summary = useMemo(() => computeSummary(logs), [logs]);

  // Pass only the stable timestamp references — the hook's RAF loop
  // handles live ticking without tearing down on every re-render.
  const { sleepMs, awakeMs } = useLiveElapsed(
    summary.activeSleepStartMs ?? undefined,
    summary.lastAwakeStartMs ?? undefined,
  );

  return (
    <View className="mx-4 mt-2 mb-1">
      {/* Title */}
      <View className="flex-row items-center mb-4">
        <Baby color="#a78bfa" size={22} />
        <Text className="text-xl font-bold text-white ml-2">Kindred Log</Text>
      </View>

      {/* Status Cards */}
      <View className="flex-row flex-wrap gap-3">
        {/* Last Feed */}
        <View className="flex-1 min-w-36 bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
          <View className="flex-row items-center mb-1">
            <Droplets color="#67e8f9" size={16} />
            <Text className="text-slate-400 text-xs ml-1 font-medium">Last Feed</Text>
          </View>
          {summary.feed ? (
            <>
              <Text className="text-sm font-semibold text-white">
                {summary.feed.relative}
              </Text>
              <Text className="text-xs text-slate-400 mt-0.5">
                {summary.feed.detail}
              </Text>
            </>
          ) : (
            <Text className="text-sm text-slate-500">No feeds yet</Text>
          )}
        </View>

        {/* Last Diaper */}
        <View className="flex-1 min-w-36 bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
          <View className="flex-row items-center mb-1">
            <Droplets color="#fbbf24" size={16} />
            <Text className="text-slate-400 text-xs ml-1 font-medium">Last Diaper</Text>
          </View>
          {summary.diaper ? (
            <>
              <Text className="text-sm font-semibold text-white">
                {summary.diaper.relative}
              </Text>
              <Text className="text-xs text-slate-400 mt-0.5">
                {summary.diaper.detail}
              </Text>
            </>
          ) : (
            <Text className="text-sm text-slate-500">No diapers yet</Text>
          )}
        </View>

        {/* Sleep / Wake Window */}
        <View className="w-full bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
          <View className="flex-row items-center mb-1">
            {summary.activeSleepStartMs !== null ? (
              <Moon color="#a78bfa" size={16} />
            ) : (
              <Sun color="#fcd34d" size={16} />
            )}
            <Text className="text-slate-400 text-xs ml-1 font-medium">
              {summary.activeSleepStartMs !== null ? 'Sleeping' : 'Wake Window'}
            </Text>
          </View>
          {summary.activeSleepStartMs !== null ? (
            <View className="flex-row items-center">
              <Timer color="#a78bfa" size={14} />
              <Text className="text-sm font-semibold text-violet-300 ml-1.5">
                {formatDuration(sleepMs)}
              </Text>
            </View>
          ) : summary.lastAwakeStartMs !== null ? (
            <Text className="text-sm text-amber-200/80 font-medium">
              Awake for {formatDuration(awakeMs)}
            </Text>
          ) : (
            <Text className="text-sm text-slate-500">No sleep tracked</Text>
          )}
        </View>
      </View>
    </View>
  );
}
