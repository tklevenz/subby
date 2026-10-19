import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

export type Bar = { label: string; values: number[]; dim?: boolean };

/** Rounds a max up to a readable axis value (1, 2, 5 × 10ⁿ). */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Stacked bar chart, one bar per day. `colors[i]` colors `values[i]` (bottom first).
 * `dim` bars (e.g. today, still in progress) are drawn faded.
 */
export default function BarChart({
  bars,
  colors,
  height = 120,
  formatValue = (v) => String(Math.round(v)),
  average,
}: {
  bars: Bar[];
  colors: string[];
  height?: number;
  formatValue?: (v: number) => string;
  /** Dashed reference line. */
  average?: number;
}) {
  const [width, setWidth] = useState(0);
  const max = niceMax(Math.max(...bars.map((b) => b.values.reduce((a, v) => a + v, 0)), average ?? 0));
  const slot = bars.length ? width / bars.length : 0;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const y = (v: number) => height - (v / max) * height;
  // Show at most ~8 labels so they don't collide.
  const labelEvery = Math.ceil(bars.length / 8);

  return (
    <View>
      <View className="flex-row justify-end">
        <Text className="text-slate-500 text-[10px]">{formatValue(max)}</Text>
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Line x1={0} x2={width} y1={0.5} y2={0.5} stroke="#1e293b" />
            <Line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="#1e293b" />
            <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="#334155" />
            {bars.map((b, i) => {
              let acc = 0;
              const x = i * slot + (slot - barW) / 2;
              return b.values.map((v, j) => {
                if (v <= 0) return null;
                const top = y(acc + v);
                const h = y(acc) - top;
                acc += v;
                return (
                  <Rect key={`${i}-${j}`} x={x} y={top} width={barW} height={h} rx={Math.min(3, barW / 2)} fill={colors[j]} opacity={b.dim ? 0.4 : 1} />
                );
              });
            })}
            {average !== undefined && average > 0 ? (
              <Line x1={0} x2={width} y1={y(average)} y2={y(average)} stroke="#e2e8f0" strokeOpacity={0.5} strokeDasharray="4 4" />
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View className="flex-row mt-1">
        {bars.map((b, i) => (
          <Text key={i} className="text-slate-500 text-[10px] text-center" style={{ width: slot }} numberOfLines={1}>
            {i % labelEvery === 0 ? b.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}
