import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import QRCode from 'qrcode';

/**
 * A QR code drawn with react-native-svg. Always dark on white with a quiet zone, whatever the app theme,
 * because that's what cameras read reliably.
 */
export default function QrCode({ value, size }: { value: string; size: number }) {
  const { path, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { path: d, count: n + 8 };
  }, [value]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
      <Rect x={0} y={0} width={count} height={count} fill="white" />
      <Path d={path} fill="black" />
    </Svg>
  );
}
