/**
 * E2E global setup: make sure there is a library and a Subsonic server to talk to.
 *
 * The mock server speaks the same REST API as Navidrome, so the suite exercises
 * the real client code paths (auth tokens, JSON parsing, streaming, range
 * requests) without needing a real music server in CI.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MOCK_PORT = process.env.MOCK_SUBSONIC_PORT ?? '4534';
const MOCK_USER = process.env.MOCK_SUBSONIC_USER ?? 'admin';
const MOCK_PASS = process.env.MOCK_SUBSONIC_PASS ?? 'admin';

let mock: ChildProcess | undefined;

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError)}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const root = process.cwd();
  const music = join(root, 'testdata/music');

  // 1. The demo library is generated (it is deliberately not committed).
  if (!existsSync(music)) {
    console.log('[e2e] seeding the demo library in testdata/music …');
    const seeded = spawnSync('bash', [join(root, 'scripts/seed-library.sh'), music], {
      stdio: 'inherit',
      env: { ...process.env, SEED_FILES_ONLY: '0' },
    });
    if (seeded.status !== 0) {
      throw new Error('could not generate the demo library (needs ffmpeg on PATH)');
    }
  }

  // 2. Start the mock Subsonic server.
  mock = spawn(
    process.execPath,
    [
      join(root, 'tools/mock-subsonic/server.mjs'),
      '--music',
      music,
      '--port',
      MOCK_PORT,
      '--user',
      MOCK_USER,
      '--password',
      MOCK_PASS,
    ],
    { stdio: 'pipe', env: process.env },
  );

  mock.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.log(`[mock] ${text}`);
  });
  mock.on('exit', (code) => {
    if (code && code !== 0) console.error(`[mock] exited with code ${code}`);
  });

  await waitFor(
    `http://127.0.0.1:${MOCK_PORT}/rest/ping?u=${MOCK_USER}&t=ready&s=ready&v=1.16.1&c=e2e&f=json`,
  );

  return async () => {
    mock?.kill('SIGTERM');
  };
}

export { MOCK_PORT, MOCK_USER, MOCK_PASS };
