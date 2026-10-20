import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { Child } from '@kindred-log/shared';
import { colors, type ColorName } from '../theme/colors';

// Six fill/initial pairs (avatar1Bg/avatar1Ink …); picked per child so siblings differ.
const SLOTS = 6;

/** Fill and initial colors for a child without a photo. */
export function avatarColors(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = (h % SLOTS) + 1;
  return { bg: colors[`avatar${n}Bg` as ColorName], fg: colors[`avatar${n}Ink` as ColorName] };
}

/** Round child photo, or their initial on a per-child color. */
export default function ChildAvatar({
  child,
  size = 40,
  ring = false,
}: {
  child: Pick<Child, 'id' | 'name' | 'photoUri'>;
  size?: number;
  /** Accent ring, e.g. for the active child. */
  ring?: boolean;
}) {
  // Fall back to the initial if the file has gone missing.
  const [failed, setFailed] = useState<string | null>(null);
  const { bg, fg } = avatarColors(child.id);
  const style = { width: size, height: size, borderRadius: size / 2 };
  const showPhoto = child.photoUri && failed !== child.photoUri;

  return (
    <View style={style}>
      {showPhoto ? (
        <Image
          source={{ uri: child.photoUri! }}
          style={{ width: '100%', height: '100%', borderRadius: size / 2 }}
          onError={() => setFailed(child.photoUri)}
        />
      ) : (
        <View style={{ flex: 1, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: fg, fontSize: size * 0.42, fontWeight: '700' }}>
            {child.name.trim().charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
      )}
      {/* Overlay rather than border/padding, so a ringed avatar keeps its exact size. */}
      {ring ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: size / 2, borderWidth: 2.5, borderColor: colors.violetStrong }}
        />
      ) : null}
    </View>
  );
}
