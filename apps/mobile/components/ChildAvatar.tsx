import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { Child } from '@kindred-log/shared';

// Pastel pairs that fit the slate palette; picked per child so siblings differ.
const PALETTE = [
  { bg: '#4c1d95', fg: '#ddd6fe' },
  { bg: '#164e63', fg: '#a5f3fc' },
  { bg: '#713f12', fg: '#fde68a' },
  { bg: '#14532d', fg: '#bbf7d0' },
  { bg: '#831843', fg: '#fbcfe8' },
  { bg: '#1e3a8a', fg: '#bfdbfe' },
];

function colorsFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
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
  const { bg, fg } = colorsFor(child.id);
  const style = { width: size, height: size, borderRadius: size / 2 };
  const showPhoto = child.photoUri && failed !== child.photoUri;

  return (
    <View style={[style, ring ? { borderWidth: 2, borderColor: '#a78bfa', padding: 2 } : null]}>
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
    </View>
  );
}
