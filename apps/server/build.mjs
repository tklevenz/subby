// Production build: one ESM file per entry point. The workspace package (@kindred-log/shared, TypeScript source) is bundled;
// npm dependencies stay external and are installed in the image.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@kindred-log/'));

await build({
  // The server, and the admin command (`node dist/admin.js`, run inside the container).
  entryPoints: ['src/main.ts', 'src/admin.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'warning',
});
