import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { runInit } from '../../src/commands/init.js';
import { runLoad } from '../../src/commands/load.js';
import { startDaemon } from '../../src/daemon/server.js';
import { readRegistry } from '../../src/daemon/registry.js';

let globalDir: string;
let projectDir: string;
let server: Server;
let port: number;

beforeEach(async () => {
  globalDir = mkdtempSync(join(tmpdir(), 'mi-e2e-dash-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  projectDir = mkdtempSync(join(tmpdir(), 'mi-e2e-dash-project-'));

  runInit(projectDir);
  runLoad(projectDir); // registers the project in the global registry

  const started = await startDaemon(0);
  server = started.server;
  port = started.port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('dashboard end-to-end', () => {
  it('a project touched by load shows up on the registry landing page', async () => {
    expect(readRegistry()[projectDir]).toBeDefined();

    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    expect(body).toContain(projectDir);
  });

  it('the project page renders the freshly initialized mental model', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/project?path=${encodeURIComponent(projectDir)}`);
    const body = await res.text();
    expect(body).toContain('No sessions yet.');
  });
});
