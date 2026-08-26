import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGlobalDir, ensureGlobalDir, registryPath, settingsPath, daemonHandlePath } from '../../src/daemon/globalPaths.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('globalPaths', () => {
  it('honors MEMORYINTEL_GLOBAL_DIR', () => {
    expect(getGlobalDir()).toBe(dir);
  });

  it('ensureGlobalDir creates the directory and returns its path', () => {
    const created = ensureGlobalDir();
    expect(created).toBe(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it('derives registry/settings/daemon-handle paths under the global dir', () => {
    expect(registryPath()).toBe(join(dir, 'registry.json'));
    expect(settingsPath()).toBe(join(dir, 'settings.json'));
    expect(daemonHandlePath()).toBe(join(dir, 'daemon.json'));
  });
});
