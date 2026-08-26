import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDaemonStart } from '../../src/commands/daemonStart.js';
import { readDaemonHandle } from '../../src/daemon/daemonHandle.js';

let dir: string;
let cleanupServer: (() => Promise<void>) | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-daemonstart-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});

afterEach(async () => {
  if (cleanupServer) await cleanupServer();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('runDaemonStart', () => {
  it('starts the server and records a daemon handle', async () => {
    const { port, close } = await runDaemonStart(0);
    cleanupServer = close;
    expect(readDaemonHandle()).toEqual({ port, pid: process.pid });
  });
});
