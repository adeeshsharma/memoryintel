import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGlobalSettings, writeGlobalSettings } from '../../src/daemon/settings.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-settings-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('readGlobalSettings / writeGlobalSettings', () => {
  it('defaults to dashboardEnabled: true when no settings file exists', () => {
    expect(readGlobalSettings()).toEqual({ dashboardEnabled: true });
  });

  it('round-trips a written value', () => {
    writeGlobalSettings({ dashboardEnabled: false });
    expect(readGlobalSettings()).toEqual({ dashboardEnabled: false });
  });
});
