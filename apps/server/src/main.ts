import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { loadConfig } from './config';

// src/main.ts in development, dist/main.js when built: both sit one level below the migrations folder.
const config = loadConfig(process.env, fileURLToPath(new URL('../drizzle', import.meta.url)));
const app = await createApp(config);
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Kindred Sync (${config.mode}) listening on :${config.port}`);
