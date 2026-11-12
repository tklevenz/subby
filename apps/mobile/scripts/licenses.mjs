// Writes assets/licenses.json: the open source packages that ship in the app, with their license texts, for
// Settings → Open source licenses. Run before a release build when dependencies changed:
//   node scripts/licenses.mjs
// "Ships" means: its code is in the JS bundle (read from the bundle's source maps, both platforms), plus what
// ships natively or as an asset without JS (EXTRA). Build tools never reach the phone and aren't listed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(app, '../..');

/** Shipped without JS in the bundle: resolved like the rest, or described by hand (`text`). */
const EXTRA = [
  // The icons, drawn from its SVG paths (components/icons/faPaths.ts, generated once; the package isn't installed).
  {
    name: 'Font Awesome Free',
    version: '6.7.2',
    license: 'CC-BY-4.0',
    url: 'https://fontawesome.com/license/free',
    text: 'Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com\nLicense - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)\nCopyright 2024 Fonticons, Inc.',
  },
  '@expo-google-fonts/fredoka', // the wordmark font, embedded by the expo-font plugin
  {
    name: 'SQLCipher',
    version: '4',
    license: 'BSD-3-Clause',
    url: 'https://github.com/sqlcipher/sqlcipher',
    text: `Copyright (c) 2025, ZETETIC LLC
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the ZETETIC LLC nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY ZETETIC LLC ''AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL ZETETIC LLC BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  },
];

/**
 * Packages published without a license file: the text of the project they belong to (the same license and
 * holder), or of another package under the same standard license.
 */
const BORROW = {
  '@react-native/assets-registry': 'react-native',
  '@react-native/js-polyfills': 'react-native',
  '@react-native/normalize-colors': 'react-native',
  '@react-native/virtualized-lists': 'react-native',
  'metro-runtime': 'react-native', // Metro, by Meta, MIT like React Native
  '@expo/ui': 'expo',
  'expo-router': 'expo',
  'drizzle-orm': 'uuidv7', // the plain Apache-2.0 text
};
const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
/** Without a file or a project to borrow from: the standard text with the holder named in the project. */
const HOLDERS = { 'standard-navigation': 'React Navigation Contributors' };

const out = mkdtempSync(join(tmpdir(), 'subby-licenses-'));
try {
  execFileSync('npx', ['expo', 'export', '--platform', 'android', '--platform', 'ios', '--source-maps', '--output-dir', out], {
    cwd: app,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const maps = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.map')) maps.push(p);
    }
  };
  walk(out);

  // Package folders, from source paths like /node_modules/.pnpm/<x>/node_modules/<name>/lib/file.js.
  const dirs = new Map();
  for (const map of maps) {
    for (const source of JSON.parse(readFileSync(map, 'utf8')).sources) {
      const m = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/.][^/]*))\//.exec(source);
      if (m && !dirs.has(m[2])) dirs.set(m[2], join(repo, m[1]));
    }
  }
  for (const extra of EXTRA) {
    if (typeof extra !== 'string') continue;
    dirs.set(extra, dirname(join(app, 'node_modules', extra, 'package.json')));
  }

  const packages = [];
  for (const [name, dir] of dirs) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const licenseFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
    const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    packages.push({
      name,
      version: pkg.version,
      license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see text'),
      url: pkg.homepage ?? repoUrl?.replace(/^git\+/, '').replace(/\.git$/, ''),
      text: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : undefined,
    });
  }
  for (const extra of EXTRA) if (typeof extra !== 'string') packages.push(extra);
  for (const p of packages) {
    if (p.text) continue;
    if (BORROW[p.name]) p.text = packages.find((q) => q.name === BORROW[p.name])?.text;
    else if (HOLDERS[p.name] && p.license === 'MIT') p.text = MIT(HOLDERS[p.name]);
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));

  // Many packages share a text word for word: kept once, referenced by index.
  const texts = [];
  const list = packages.map(({ text, ...p }) => {
    if (!text) return p;
    let i = texts.indexOf(text);
    if (i < 0) i = texts.push(text) - 1;
    return { ...p, text: i };
  });
  const missing = list.filter((p) => p.text === undefined).map((p) => p.name);
  if (missing.length) console.warn(`No license file in: ${missing.join(', ')}`);
  writeFileSync(join(app, 'assets/licenses.json'), JSON.stringify({ packages: list, texts }) + '\n');
  console.log(`${list.length} packages, ${texts.length} license texts → assets/licenses.json`);
} finally {
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
}
