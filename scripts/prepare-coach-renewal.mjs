// Builds private function artifacts only. Does not deploy, send or write data.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
async function zipperModule() {
  try { return await import(pathToFileURL(require.resolve('@netlify/zip-it-and-ship-it')).href); }
  catch {
    const cache = path.join(os.homedir(), '.npm/_npx');
    for (const entry of await fs.readdir(cache)) {
      const candidate = path.join(cache, entry, 'node_modules/@netlify/zip-it-and-ship-it/dist/main.js');
      try { await fs.access(candidate); return await import(pathToFileURL(candidate).href); }
      catch { /* Try another existing Netlify CLI installation. */ }
    }
    throw new Error('Install Netlify CLI before preparing function ZIPs.');
  }
}

const names = ['coach-renewal', 'coach-renewal-reminder'];
const root = path.join(os.homedir(), 'Library/Application Support/Codex/coach-renewal-reminder-2026-10-16');
const sources = path.join(root, 'functions');
const zips = path.join(root, 'zips');
const manifest = path.resolve(process.argv[2] || 'outputs/coach-renewal-review-2026-10-16/function-artifacts.json');
await fs.mkdir(root, { recursive: true, mode: 0o700 }); await fs.chmod(root, 0o700);
await fs.mkdir(sources, { recursive: true, mode: 0o700 });
await fs.mkdir(zips, { recursive: true, mode: 0o700 });
await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }), { mode: 0o600 });
const key = JSON.parse(await fs.readFile('firebase-admin-key.json', 'utf8'));
if (key.project_id !== 'traininglogforclients') throw new Error('Wrong Firebase credential project');
const define = {
  'process.env.FIREBASE_ADMIN_PROJECT_ID': JSON.stringify(key.project_id),
  'process.env.FIREBASE_ADMIN_CLIENT_EMAIL': JSON.stringify(key.client_email),
  'process.env.FIREBASE_ADMIN_PRIVATE_KEY': JSON.stringify(key.private_key),
};
const { zipFunction } = await zipperModule();
const functions = [];
for (const name of names) {
  const outfile = path.join(sources, `${name}.cjs`);
  await build({ entryPoints: [`netlify/functions/${name}.js`], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile, define });
  await fs.chmod(outfile, 0o600);
  const artifact = await zipFunction(outfile, zips, { basePath: root, repositoryRoot: root, config: { '*': { nodeBundler: 'zisi', nodeVersion: '22.x' } } });
  await fs.chmod(artifact.path, 0o600);
  const bytes = await fs.readFile(artifact.path);
  functions.push({ name, path: artifact.path, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), runtime: artifact.runtime, runtimeVersion: artifact.runtimeVersion });
}
const metadata = { privateRoot: root, functions, function_schedules: [{ name: 'coach-renewal-reminder', cron: '*/10 0,2,8,10,12 * * 1-5' }] };
await fs.mkdir(path.dirname(manifest), { recursive: true });
await fs.writeFile(manifest, JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({ manifest, functions: functions.map(({ name, size, sha256 }) => ({ name, size, sha256 })), function_schedules: metadata.function_schedules }, null, 2));
