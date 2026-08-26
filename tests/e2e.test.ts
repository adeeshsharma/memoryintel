import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/commands/init.js';
import { runLoad } from '../src/commands/load.js';
import { runUpdate } from '../src/commands/update.js';
import { runStatus } from '../src/commands/status.js';
import { encodeToonTable } from '../src/core/toon.js';
import { findMemoryIntelRoot } from '../src/core/discovery.js';
import { writeGlobalSettings } from '../src/daemon/settings.js';

let projectDir: string;
let globalDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'mi-e2e-'));
  // runLoad/runUpdate both call ensureDaemonRunning(), which is a real, machine-wide concern -
  // isolating projectDir alone isn't enough. Without this, every `npm test` run on a machine
  // with the dashboard enabled quietly spawns a real background daemon process against the
  // developer's actual ~/.memoryintel/, that nothing here ever cleans up.
  globalDir = mkdtempSync(join(tmpdir(), 'mi-e2e-global-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  // dashboardEnabled defaults to true, which would still spawn a real (if now harmlessly
  // isolated) detached daemon process that this test never kills. This test exercises the
  // init/load/update/status lifecycle, not the dashboard - keep it off entirely.
  writeGlobalSettings({ dashboardEnabled: false });
});
afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(globalDir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('end-to-end: init -> load -> update -> load -> status', () => {
  it('carries a change through the full lifecycle', async () => {
    runInit(projectDir);

    const firstLoad = runLoad(projectDir, 'technical');
    expect(firstLoad).toContain('_No sessions yet._');
    expect(firstLoad).toContain('## Overview');

    const root = findMemoryIntelRoot(projectDir)!;
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'JWT refresh token architecture introduced', reason: 'New auth flow' },
      { file: 'context/currentMentalModel.md', action: 'replace', section: '', content: 'Authentication migration 70% complete. Next milestone: token rotation rollout.', reason: 'session summary' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied.sort()).toEqual(['context/currentMentalModel.md', 'technical/architecture.md']);

    const secondLoad = runLoad(projectDir, 'technical');
    expect(secondLoad).toContain('JWT refresh token architecture introduced');
    expect(secondLoad).toContain('Authentication migration 70% complete');

    const status = runStatus(root);
    expect(status).toContain('Authentication migration 70% complete');
    expect(status).toContain('New auth flow');
  });

  it('leaves everything untouched when the agent has nothing meaningful to report (no update call)', () => {
    runInit(projectDir);
    const before = runLoad(projectDir);
    const after = runLoad(projectDir);
    expect(after).toBe(before);
  });
});
