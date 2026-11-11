import { describe, expect, it } from 'vitest';
import palette from './palette';

// Vite's glob import (the app has no Node types); the sources come in as raw text.
declare global {
  interface ImportMeta {
    glob(patterns: string[], options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
  }
}

const sources = import.meta.glob(['../app/**/*.{ts,tsx}', '../components/**/*.{ts,tsx}', '../features/**/*.{ts,tsx}', '!**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
// Hex values here are data, not UI chrome: real diaper colors.
const HEX_ALLOWED = new Set(['../components/logTypes.tsx']);

describe('theme', () => {
  it('finds the UI sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
  });

  it('every theme defines the same roles', () => {
    const roles = Object.keys(palette.dark).sort();
    for (const theme of Object.values(palette)) expect(Object.keys(theme).sort()).toEqual(roles);
  });

  it('UI code uses role classes, not raw Tailwind palette steps', () => {
    const raw = /\b(bg|text|border(-[trblxy])?)-(slate|gray|zinc|white|black|violet|cyan|amber|red|orange|yellow|teal|green|fuchsia|blue|lime|pink|purple|sky|emerald|indigo|rose)-\d/;
    const hits = Object.entries(sources).filter(([, src]) => raw.test(src)).map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it('UI code takes colors from theme/colors, not hex literals', () => {
    const hex = /["']#[0-9a-fA-F]{3,8}["']/;
    const hits = Object.entries(sources)
      .filter(([path, src]) => !HEX_ALLOWED.has(path) && hex.test(src))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
