import { t } from '@subby/shared/i18n';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { DIAPER_COLORS, type DiaperColor } from '@subby/shared';
import { COLOR_SWATCH } from '../logTypes';

/** Most common first, as on the diaper sheet. */
const COMMON_FIRST: DiaperColor[] = ['yellow', 'brown', 'green', 'orange', 'black', 'red', 'white', 'gray'];

/**
 * The diaper colors as swatches; tapping the chosen one clears it. `sheet` is the compact grid of the diaper sheet
 * (four to a row, most common first), `editor` the roomier one of the entry forms.
 */
export function DiaperColors({ value, onChange, variant }: { value?: DiaperColor; onChange: (color: DiaperColor | undefined) => void; variant: 'editor' | 'sheet' }) {
  const sheet = variant === 'sheet';
  return (
    <View className={`flex-row flex-wrap ${sheet ? 'gap-2' : 'gap-3'}`}>
      {(sheet ? COMMON_FIRST : DIAPER_COLORS).map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(value === c ? undefined : c)}
          style={sheet ? { width: '23%' } : undefined}
          className={
            sheet
              ? `h-14 rounded-xl items-center justify-center bg-raised border-2 ${value === c ? 'border-violet-strong' : 'border-transparent'}`
              : `items-center rounded-xl p-1.5 border ${value === c ? 'border-violet-strong' : 'border-transparent'}`
          }
        >
          <View style={{ backgroundColor: COLOR_SWATCH[c] }} className={`${sheet ? 'w-5 h-5' : 'w-8 h-8'} rounded-full border border-line-heavy`} />
          <Text className={sheet ? 'text-ink-soft text-[11px] mt-1 capitalize' : 'text-ink-muted text-[10px] mt-1'}>{t(`diaperColor.${c}`)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
