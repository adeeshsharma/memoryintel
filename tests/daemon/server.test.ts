import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from '../../src/daemon/server.js';
import { readDaemonHandle, writeDaemonHandle } from '../../src/daemon/daemonHandle.js';
import { readGlobalSettings, writeGlobalSettings } from '../../src/daemon/settings.js';
import type { Server } from 'node:http';

let globalDir: string;
let projectRoot: string;
let server: Server;
let port: number;

beforeEach(async () => {
  globalDir = mkdtempSync(join(tmpdir(), 'mi-server-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  projectRoot = mkdtempSync(join(tmpdir(), 'mi-server-project-'));
  mkdirSync(join(projectRoot, '.memoryintel', 'context'), { recursive: true });
  writeFileSync(join(projectRoot, '.memoryintel', 'context', 'currentMentalModel.md'), 'Hello from mental model.\n');

  writeFileSync(join(globalDir, 'registry.json'), JSON.stringify({
    [projectRoot]: { path: projectRoot, initializedAt: '2026-08-20T10:00:00Z', lastSessionAt: '2026-08-20T10:00:00Z', toolsWired: [] }
  }));

  const started = await startDaemon(0);
  server = started.server;
  port = started.port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('daemon HTTP server', () => {
  it('serves the registry landing page at /', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain(projectRoot);
  });

  it('serves a project page at /project?path=...', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/project?path=${encodeURIComponent(projectRoot)}`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('Hello from mental model.');
  });

  it('returns 404 for an unknown route', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonsense`);
    expect(res.status).toBe(404);
  });

  it('shows a "Stop dashboard" control on the registry page', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    expect(body).toContain('/stop');
    expect(body).toContain('Stop dashboard');
  });

  it('POST /stop with no Origin header (a CLI-style caller) disables the dashboard and clears the daemon handle', async () => {
    writeGlobalSettings({ ...readGlobalSettings(), dashboardEnabled: true });
    writeDaemonHandle({ pid: process.pid, port });

    const res = await fetch(`http://127.0.0.1:${port}/stop`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Dashboard stopped');

    expect(readGlobalSettings().dashboardEnabled).toBe(false);
    expect(readDaemonHandle()).toBeNull();
  });

  it('POST /stop with a mismatched Origin is rejected and changes nothing', async () => {
    writeGlobalSettings({ ...readGlobalSettings(), dashboardEnabled: true });
    writeDaemonHandle({ pid: process.pid, port });

    const res = await fetch(`http://127.0.0.1:${port}/stop`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);

    expect(readGlobalSettings().dashboardEnabled).toBe(true);
    expect(readDaemonHandle()).not.toBeNull();
  });

  it('POST /stop with a matching Origin (a real browser tab on this dashboard) succeeds', async () => {
    writeGlobalSettings({ ...readGlobalSettings(), dashboardEnabled: true });

    const res = await fetch(`http://127.0.0.1:${port}/stop`, {
      method: 'POST',
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    expect(res.status).toBe(200);
    expect(readGlobalSettings().dashboardEnabled).toBe(false);
  });
});
