import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Text as SvgText } from 'react-native-svg';
import {
  WHO_MAX_MONTHS,
  cmToIn,
  percentileCurves,
  type GrowthMeasure,
  type GrowthPoint,
  type UnitSystem,
  type WhoSex,
} from '@kindred-log/shared';
import { colors } from '../../theme/colors';

const PAD = { left: 34, right: 26, top: 8, bottom: 22 };
const KG_PER_LB = 0.453592;

/** Chart units for a measure: kg/cm, or lb/in when imperial. */
export function toChartUnit(measure: GrowthMeasure, value: number, units: UnitSystem): number {
  if (units === 'metric') return value;
  return measure === 'weightKg' ? value / KG_PER_LB : cmToIn(value);
}

export function chartUnitLabel(measure: GrowthMeasure, units: UnitSystem): string {
  if (measure === 'weightKg') return units === 'metric' ? 'kg' : 'lb';
  return units === 'metric' ? 'cm' : 'in';
}

function ticks(min: number, max: number, target: number): number[] {
  const raw = (max - min) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Measurements over WHO percentile curves (3rd–97th), age in months on the x axis. */
export default function GrowthChart({
  measure,
  sex,
  points,
  units,
  height = 280,
}: {
  measure: GrowthMeasure;
  sex: WhoSex | null;
  points: GrowthPoint[];
  units: UnitSystem;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const lastMonths = points.length ? points[points.length - 1].months : 0;
  const xMax = Math.max(6, Math.min(WHO_MAX_MONTHS, Math.ceil(lastMonths) + 2), Math.ceil(lastMonths));
  // Only negative for a measurement dated before the birth date (a data-entry slip).
  const xMin = Math.min(0, Math.floor(points[0]?.months ?? 0));

  const curves = useMemo(
    () =>
      sex
        ? percentileCurves(measure, sex, 0.25).map((c) => ({
            ...c,
            points: c.points.filter((p) => p.months <= xMax).map((p) => ({ ...p, value: toChartUnit(measure, p.value, units) })),
          }))
        : [],
    [measure, sex, units, xMax],
  );
  const values = [
    ...curves.flatMap((c) => c.points.map((p) => p.value)),
    ...points.map((p) => toChartUnit(measure, p.value, units)),
  ];
  const span = values.length ? Math.max(...values) - Math.min(...values) : 1;
  const yMin = values.length ? Math.min(...values) - span * 0.05 : 0;
  const yMax = values.length ? Math.max(...values) + span * 0.05 : 1;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (m: number) => PAD.left + ((m - xMin) / (xMax - xMin)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const xStep = xMax - xMin <= 6 ? 1 : xMax - xMin <= 12 ? 2 : 3;
  const monthTicks: number[] = [];
  for (let m = Math.ceil(xMin / xStep) * xStep; m <= xMax; m += xStep) monthTicks.push(m);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {ticks(yMin, yMax, 5).map((v) => (
            <G key={`y${v}`}>
              <Line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke={colors.line} />
              <SvgText x={PAD.left - 6} y={y(v) + 3} fontSize={10} fill={colors.inkFaint} textAnchor="end">{String(v)}</SvgText>
            </G>
          ))}
          {monthTicks.map((m) => (
            <G key={`x${m}`}>
              <Line x1={x(m)} x2={x(m)} y1={PAD.top} y2={height - PAD.bottom} stroke={colors.line} />
              <SvgText x={x(m)} y={height - 6} fontSize={10} fill={colors.inkFaint} textAnchor="middle">{String(m)}</SvgText>
            </G>
          ))}
          {curves.map((c) => {
            const d = c.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.months).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
            const last = c.points[c.points.length - 1];
            const median = c.percentile === 50;
            return (
              <G key={c.percentile}>
                <Path d={d} stroke={median ? colors.inkMuted : colors.inkGhost} strokeWidth={median ? 1.5 : 1} strokeDasharray={c.percentile === 3 || c.percentile === 97 ? '4 3' : undefined} fill="none" />
                <SvgText x={x(last.months) + 4} y={y(last.value) + 3} fontSize={9} fill={colors.inkFaint}>{String(c.percentile)}</SvgText>
              </G>
            );
          })}
          {points.length > 1 ? (
            <Polyline
              points={points.map((p) => `${x(p.months)},${y(toChartUnit(measure, p.value, units))}`).join(' ')}
              stroke={colors.violetStrong}
              strokeWidth={2}
              fill="none"
            />
          ) : null}
          {points.map((p) => (
            <Circle key={p.id} cx={x(p.months)} cy={y(toChartUnit(measure, p.value, units))} r={4} fill={colors.violetStrong} stroke={colors.ground} strokeWidth={1.5} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
