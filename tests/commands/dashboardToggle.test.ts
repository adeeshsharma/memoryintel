import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDashboardEnable, runDashboardDisable } from '../../src/commands/dashboardToggle.js';
import { readGlobalSettings } from '../../src/daemon/settings.js';
import { writeDaemonHandle, readDaemonHandle } from '../../src/daemon/daemonHandle.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-toggle-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
  vi.restoreAllMocks();
});

describe('runDashboardEnable', () => {
  it('sets dashboardEnabled to true', () => {
    runDashboardDisable();
    runDashboardEnable();
    expect(readGlobalSettings().dashboardEnabled).toBe(true);
  });
});

describe('runDashboardDisable', () => {
  it('sets dashboardEnabled to false', () => {
    runDashboardDisable();
    expect(readGlobalSettings().dashboardEnabled).toBe(false);
  });

  it('reports stopped: false and leaves no handle when no daemon was running', () => {
    const result = runDashboardDisable();
    expect(result.stopped).toBe(false);
    expect(readDaemonHandle()).toBeNull();
  });

  it('kills the live process and clears the handle when a daemon is running', () => {
    writeDaemonHandle({ port: 4390, pid: process.pid });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const result = runDashboardDisable();
    expect(result.stopped).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    expect(readDaemonHandle()).toBeNull();
  });
});
