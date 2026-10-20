/**
 * Test runner.
 *
 * Boots a throwaway server on a free port with a temporary DATA_DIR, runs
 * every suite against it, then shuts it down. Nothing here touches
 * `data/workspaces.json`, and nothing depends on the developer's own server
 * being up — `npm test` is meant to be runnable at any time, including with the
 * real app already running on 8787.
 *
 * The server is started as a child process rather than imported so that its
 * shutdown path, the MCP subprocess and the debounced writes are exercised the
 * same way production runs them.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PORT = Number(process.env.TEST_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;

const SUITES = [
  { name: 'units', file: 'verify-units.mjs', needsServer: false },
  { name: 'screener', file: 'verify-screener.mjs', needsServer: true },
  { name: 'workspaces', file: 'verify-workspaces.mjs', needsServer: true },
  { name: 'watchlists', file: 'verify-watchlists.mjs', needsServer: true },
];

const run = (file, env) => new Promise((done) => {
  const child = spawn(process.execPath, [join(HERE, file)], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  child.on('exit', (code) => done(code ?? 1));
});

const waitForHealth = async (tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const dataDir = await mkdtemp(join(tmpdir(), 'desk-test-'));
let server = null;
let failed = 0;

try {
  const needsServer = SUITES.some((s) => s.needsServer);
  if (needsServer) {
    console.log(`starting a throwaway server on ${BASE} (DATA_DIR=${dataDir})`);
    server = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const noise = [];
    server.stdout.on('data', (b) => noise.push(String(b)));
    server.stderr.on('data', (b) => noise.push(String(b)));

    if (!(await waitForHealth())) {
      console.error('\nserver did not become healthy\n');
      console.error(noise.join('').slice(-3000));
      process.exitCode = 1;
      throw new Error('server never came up');
    }
  }

  for (const suite of SUITES) {
    console.log(`\n${'─'.repeat(60)}\n${suite.name}\n${'─'.repeat(60)}`);
    const code = await run(suite.file, { API: BASE, DESK_TEST: '1' });
    if (code !== 0) failed += 1;
  }
} finally {
  if (server) {
    // SIGTERM so the shutdown handler flushes rather than the process dying.
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (!server.killed) server.kill('SIGKILL');
  }
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

console.log(`${'─'.repeat(60)}`);
console.log(failed ? `\n${failed} suite(s) failed\n` : '\nall suites passed\n');
process.exit(failed ? 1 : 0);