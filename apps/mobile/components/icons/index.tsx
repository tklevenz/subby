import React, { useId } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, Mask, Path, Rect } from 'react-native-svg';
import { colors } from '../../theme/colors';
import { FA_PATHS, type FaName } from './faPaths';

export type IconProps = { color?: ColorValue; size?: number; style?: StyleProp<ViewStyle> };
export type IconComponent = React.ComponentType<IconProps>;

// Solid glyphs look heavier than line icons at the same size; draw them at 88 % of the box.
const SCALE = 0.88;

/** A Font Awesome solid glyph, centered in a size×size square (glyphs have varying widths). */
function FaIcon({ name, color, size = 24, style }: IconProps & { name: FaName }) {
  const { w, h, d } = FA_PATHS[name];
  const box = Math.max(w, h) / SCALE;
  return (
    <Svg width={size} height={size} viewBox={`${(w - box) / 2} ${(h - box) / 2} ${box} ${box}`} style={style}>
      <Path d={d} fill={color ?? colors.ink} />
    </Svg>
  );
}

function make(name: FaName): IconComponent {
  const Icon = (props: IconProps) => <FaIcon name={name} {...props} />;
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

export const AngleDown = make('angle-down');
export const AngleLeft = make('angle-left');
export const AngleRight = make('angle-right');
export const Baby = make('baby');
export const BottleWater = make('bottle-water');
export const CakeCandles = make('cake-candles');
export const CalendarDays = make('calendar-days');
export const Camera = make('camera');
export const ChartLine = make('chart-line');
export const Check = make('check');
export const ChildReaching = make('child-reaching');
export const ClockRotateLeft = make('clock-rotate-left');
export const CloudSun = make('cloud-sun');
export const Droplet = make('droplet');
export const Flag = make('flag');
export const Gear = make('gear');
export const House = make('house');
export const ImageIcon = make('image');
export const Minus = make('minus');
export const Moon = make('moon');
export const Pause = make('pause');
export const PenToSquare = make('pen-to-square');
export const Pills = make('pills');
export const Plus = make('plus');
export const Poop = make('poop');
export const RulerVertical = make('ruler-vertical');
export const Shapes = make('shapes');
export const Stop = make('stop');
export const Sun = make('sun');
export const TemperatureHalf = make('temperature-half');
export const Toilet = make('toilet');
export const TrashCan = make('trash-can');
export const TriangleExclamation = make('triangle-exclamation');
export const Xmark = make('xmark');

/**
 * The diaper icon: a poop with a small droplet layered on its top-right corner. The droplet's
 * ring is masked out of the poop, so it reads on any background. `dropColor` defaults to `color`.
 */
export function PoopDroplet({ color, dropColor, size = 24, style }: IconProps & { dropColor?: ColorValue }) {
  const maskId = `poopdrop${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const poop = FA_PATHS.poop;
  const drop = FA_PATHS.droplet;
  const fill = color ?? colors.ink;
  // In a 24-unit box: the poop fills 20×20 at the bottom left, the droplet is 11 high at the top right.
  const poopScale = 20 / poop.h;
  const dropScale = 11 / drop.h;
  const dropX = 18.5 - (drop.w * dropScale) / 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Defs>
        <Mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <Rect x="0" y="0" width="24" height="24" fill="white" />
          <Circle cx="18.5" cy="6" r="6.2" fill="black" />
        </Mask>
      </Defs>
      <G mask={`url(#${maskId})`}>
        <Path d={poop.d} fill={fill} transform={`translate(0 3) scale(${poopScale})`} />
      </G>
      <Path d={drop.d} fill={dropColor ?? fill} transform={`translate(${dropX} 0.5) scale(${dropScale})`} />
    </Svg>
  );
}
