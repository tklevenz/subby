// The Docker image's runtime dependencies: the server's own npm dependencies (the bundle already contains the shared
// workspace package) at the exact versions pnpm resolved, in runtime/package.json, with every transitive dependency
// pinned by runtime/package-lock.json, so two builds of the same commit install the same code.
//
//   pnpm runtime-lock                         (in apps/server, after changing dependencies) rewrites both files
//   node scripts/runtime-deps.mjs --check     (the Docker build) fails when runtime/package.json is out of date
//
// Not `pnpm deploy`: drizzle-orm's optional peers, shared with the app in the lockfile, would pull in React Native.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(server, 'runtime');
const manifest = join(runtime, 'package.json');

const [listed] = JSON.parse(execFileSync('pnpm', ['list', '--prod', '--depth', '0', '--json'], { cwd: server, encoding: 'utf8' }));
const deps = Object.entries(listed.dependencies)
  .filter(([name]) => !name.startsWith('@subby/'))
  .sort(([a], [b]) => a.localeCompare(b));
const pkg = { name: 'subby-sync', private: true, type: 'module', dependencies: Object.fromEntries(deps.map(([name, d]) => [name, d.version])) };
const text = `${JSON.stringify(pkg, null, 2)}\n`;

if (process.argv.includes('--check')) {
  if (readFileSync(manifest, 'utf8') !== text) {
    console.error('apps/server/runtime/package.json is out of date: run `pnpm runtime-lock` in apps/server and commit both files.');
    process.exit(1);
  }
} else {
  writeFileSync(manifest, text);
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: runtime, stdio: 'inherit' });
}
