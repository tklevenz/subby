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
// JSX text after an expression, up to a closing tag ("{label} logged</Text>").
const AFTER_EXPR = /\}[ \t]*([A-Za-z][A-Za-z’' ]*[A-Za-z.!?…])\s*(?=<\/)/g;
// A JSX child expression ("">{active ? 'tap to pause' : …}") and, inside it, a string it can show: lowercase words
// right after `{`, `?`, `:`, `??`, `||` or `&&` (not compared with `===`, which are ids).
const CHILD_EXPR = />\s*\{([^{}]*)\}/g;
const SHOWN = /(?:^|[?:]|\?\?|\|\||&&)\s*(['"`])([a-z][a-z’' ]*)\1/g;
// Props people read or hear, with lowercase words ("label="suggested"", "placeholder: 'name'").
const TEXT_PROP = /\b(?:label|title|placeholder|accessibilityLabel|accessibilityHint|hint|subtitle|message)\s*[=:]\s*\{?\s*(['"`])([a-z][a-z’' ]*)\1/g;
// Not for people: component and type names, ids, header keys, log levels, unit symbols.
const ALLOWED = /^(React|View|Text|Pressable|Platform|Authorization|Bearer .*|Content-Type|GET|PUT|POST|DELETE|OK|Subby|Subby Sync|Fredoka.*|Inter.*|ml|oz|g|kg|lb|cm|in)$/;

export function untranslated(src: string): string[] {
  const hits: string[] = [];
  for (const line of src.split('\n')) {
    if (/^\s*(import|\/\/|\*|\/\*)/.test(line) || /\/\/ i18n-ignore\s*$/.test(line)) continue;
    // Strings inside t(…) calls are keys, not text: whole calls without nested parentheses, else the first key.
    let code = line;
    for (let prev = ''; prev !== code; ) [prev, code] = [code, code.replace(/\bt\([^()]*\)/g, 't()')];
    code = code.replace(/\bt\(\s*'[^']*'/g, "t(''");
    for (const m of code.matchAll(JSX_TEXT)) if (!ALLOWED.test(m[1])) hits.push(m[1]);
    for (const m of code.matchAll(AFTER_EXPR)) if (!ALLOWED.test(m[1])) hits.push(m[1]);
    const bare = BARE_TEXT.exec(code);
    if (bare && !/^\s*(return|const|let|if|else|case|export|import|type|function|await|try|finally|do|async)\b/.test(code)) hits.push(bare[1]);
    for (const m of code.matchAll(QUOTED)) if (!ALLOWED.test(m[2])) hits.push(m[2]);
    for (const expr of code.matchAll(CHILD_EXPR)) {
      for (const m of expr[1].matchAll(SHOWN)) if (!ALLOWED.test(m[2])) hits.push(m[2]);
    }
    for (const m of code.matchAll(TEXT_PROP)) if (!ALLOWED.test(m[2])) hits.push(m[2]);
  }
  return hits;
}

describe('strings', () => {
  it('finds the UI sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
  });

  it('catches lowercase text too, and leaves keys and ids alone', () => {
    expect(untranslated(`<Text className="x">{active ? 'tap to pause' : hint ? 'suggested' : ''}</Text>`)).toEqual(['tap to pause', 'suggested']);
    expect(untranslated(`<Text>{label} logged</Text>`)).toEqual(['logged']);
    expect(untranslated(`<Text>~{m.months} mo</Text>`)).toEqual(['mo']);
    expect(untranslated(`<Button label="done" />`)).toEqual(['done']);
    expect(untranslated(`<Text>{t(side === 'left' ? 'feed.left' : 'feed.right')}</Text>`)).toEqual([]);
    expect(untranslated(`<Text>{kind === 'nap' ? t('a.b') : t('c.d', { n: 1 })}</Text>`)).toEqual([]);
    expect(untranslated(`{ text: t('common.cancel'), style: 'cancel' },`)).toEqual([]);
    expect(untranslated(`{ value: 'ml', label: 'ml' },`)).toEqual([]);
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
