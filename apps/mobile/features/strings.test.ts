import { describe, expect, it } from 'vitest';

// Vite's glob import (the app has no Node types); the sources come in as raw text.
declare global {
  interface ImportMeta {
    glob(patterns: string[], options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
  }
}

// Files in this folder come as "./x.ts"; named from the app's root like the rest ("../features/x.ts").
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob(
      ['../app/**/*.{ts,tsx}', '../components/**/*.{ts,tsx}', './**/*.{ts,tsx}', '../store/**/*.{ts,tsx}', '!**/*.test.ts'],
      { query: '?raw', import: 'default', eager: true },
    ),
  ).map(([path, src]) => [path.replace(/^\.\//, '../features/'), src]),
);

/**
 * Files whose text isn't in the catalog yet (A14). Shrinks to nothing; a file leaves the list once `t()` covers it.
 */
const NOT_YET = new Set<string>([
]);

/** Stays English for good: the diagnostics report is for our support, like the server's error messages. */
const ENGLISH = new Set<string>(['../features/diagnostics.ts']);

// JSX text ("<Text>Save</Text>") and quoted strings that read like words for people: a capital, then a space or a
// lowercase letter ("Save", "Log a sleep", 'Bedtime'). Lines ending in `// i18n-ignore` are left alone.
const JSX_TEXT = /(?<![=\-])>\s*([A-Za-z][^<>{}]*[A-Za-z.!?…:),·–-])\s*(?=[<{])/g;
const QUOTED = /(['"`])([A-Z][A-Za-z'’]*(?: [^'"`\n]+)|[A-Z][a-z]+)\1/g;
// A JSX text line that starts lowercase, before an expression ("between {a} and {b}").
const BARE_TEXT = /^\s+([a-z][a-z’']+(?: [a-z’']+)* \{)/;
// Not for people: component and type names, ids, header keys, log levels.
const ALLOWED = /^(React|View|Text|Pressable|Platform|Authorization|Bearer .*|Content-Type|GET|PUT|POST|DELETE|OK|Subby|Subby Sync|Fredoka.*|Inter.*)$/;

export function untranslated(src: string): string[] {
  const hits: string[] = [];
  for (const line of src.split('\n')) {
    if (/^\s*(import|\/\/|\*|\/\*)/.test(line) || /\/\/ i18n-ignore\s*$/.test(line)) continue;
    // Strings inside t(…) calls are keys, not text.
    const code = line.replace(/\bt\(\s*'[^']*'/g, "t(''");
    for (const m of code.matchAll(JSX_TEXT)) if (!ALLOWED.test(m[1])) hits.push(m[1]);
    const bare = BARE_TEXT.exec(code);
    if (bare && !/^\s*(return|const|let|if|else|case|export|import|type|function|await|try|finally|do|async)\b/.test(code)) hits.push(bare[1]);
    for (const m of code.matchAll(QUOTED)) if (!ALLOWED.test(m[2])) hits.push(m[2]);
  }
  return hits;
}

describe('strings', () => {
  it('finds the UI sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
  });

  it('UI text comes from the catalog (t()), not English in the code', () => {
    const hits = Object.entries(sources)
      .filter(([path]) => !NOT_YET.has(path) && !ENGLISH.has(path))
      .flatMap(([path, src]) => untranslated(src).map((s) => `${path}: ${s}`));
    expect(hits).toEqual([]);
  });

  it('lists only files that still have English in them', () => {
    const done = [...NOT_YET].filter((path) => sources[path] !== undefined && untranslated(sources[path]).length === 0);
    expect(done).toEqual([]);
  });
});
