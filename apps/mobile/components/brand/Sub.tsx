import React from 'react';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '../../theme/colors';

/** The sub's box in the app icon's 100-unit coordinates (assets/brand/icon.svg). */
export const SUB_VIEWBOX = { x: 4, y: 16, w: 88, h: 64 };

/** The moon submarine from the app icon. Leave the periscope out for loaders that move it on its own. */
export function SubParts({ periscope = true }: { periscope?: boolean }) {
  return (
    <>
      {periscope ? <Periscope /> : null}
      <Rect x={40} y={30} width={20} height={14} rx={5} fill={colors.subYellow} />
      <Path d="M18 48 L8 40 L8 70 L18 62 Z" fill={colors.subAmber} />
      <Rect x={14} y={40} width={74} height={36} rx={18} fill={colors.subYellow} />
      <Circle cx={32} cy={58} r={5} fill={colors.subAmber} />
      <Circle cx={32} cy={58} r={3.2} fill={colors.subGlass} />
      <Circle cx={58} cy={58} r={12.5} fill={colors.subAmber} />
      <Circle cx={58} cy={58} r={9.5} fill={colors.subGlass} />
      <Circle cx={57} cy={58} r={5.6} fill={colors.subMoon} />
      <Circle cx={60} cy={55.6} r={4.7} fill={colors.subGlass} />
    </>
  );
}

export function Periscope() {
  return <Path d="M54 40 V20 H62" fill="none" stroke={colors.subYellow} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />;
}

/** The sub alone, `width` wide. */
export function Sub({ width, periscope = true }: { width: number; periscope?: boolean }) {
  const { x, y, w, h } = SUB_VIEWBOX;
  return (
    <Svg width={width} height={(width * h) / w} viewBox={`${x} ${y} ${w} ${h}`}>
      <SubParts periscope={periscope} />
    </Svg>
  );
}

/** The sub asleep on the sea floor, for empty states. */
export function RestingSub({ width }: { width: number }) {
  return (
    <Svg width={width} height={(width * 90) / 120} viewBox="0 0 120 90">
      <Path d="M0 78 Q30 72 60 78 T120 78 V90 H0 Z" fill={colors.seaFloor} />
      <Path d="M12 78 Q8 66 13 58 Q17 50 13 42" fill="none" stroke={colors.tealStrong} strokeWidth={3} strokeLinecap="round" opacity={0.6} />
      <Path d="M106 78 Q110 68 105 60" fill="none" stroke={colors.tealStrong} strokeWidth={3} strokeLinecap="round" opacity={0.5} />
      <G transform="translate(16 5)">
        <SubParts />
      </G>
      <SvgText x={84} y={20} fill={colors.subBubble} fontSize={11} fontWeight="700" opacity={0.8}>
        z
      </SvgText>
      <SvgText x={93} y={11} fill={colors.subBubble} fontSize={8} fontWeight="700" opacity={0.6}>
        z
      </SvgText>
    </Svg>
  );
}
