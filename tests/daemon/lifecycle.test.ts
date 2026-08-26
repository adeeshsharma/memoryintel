import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldSpawnDaemon, ensureDaemonRunning } from '../../src/daemon/lifecycle.js';
import { writeGlobalSettings } from '../../src/daemon/settings.js';
import { writeDaemonHandle, readDaemonHandle, isProcessAlive } from '../../src/daemon/daemonHandle.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-lifecycle-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('shouldSpawnDaemon', () => {
  it('is true when enabled and no handle exists', () => {
    expect(shouldSpawnDaemon()).toBe(true);
  });

  it('is false when the dashboard is globally disabled', () => {
    writeGlobalSettings({ dashboardEnabled: false });
    expect(shouldSpawnDaemon()).toBe(false);
  });

  it('is false when a handle exists for a live process (the current process)', () => {
    writeDaemonHandle({ port: 4390, pid: process.pid });
    expect(shouldSpawnDaemon()).toBe(false);
  });

  it('is true when the handle points at a dead process', () => {
    writeDaemonHandle({ port: 4390, pid: 999999 });
    expect(shouldSpawnDaemon()).toBe(true);
  });
});

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

// spawn() returns a pid as soon as the OS has accepted the process-creation request, but there's
// a real window before that pid is reliably queryable via process.kill(pid, 0) - negligible on
// POSIX, occasionally wide enough to matter on a loaded Windows CI runner: even the fix for the
// deterministic isDirectInvocation() bug (which made the spawned child never run main() at all)
// didn't fully settle this - still an intermittent failure afterward, at 2s, on unrelated
// (docs-only) PRs where nothing about the daemon changed. Windows Defender's real-time scan of a
// freshly-built dist/cli.js on a loaded GitHub-hosted runner is a documented, real source of
// exactly this kind of startup latency variance, outside this code's control. A longer bound
// with a small sleep between polls (rather than a tight spin loop burning CPU while waiting)
// tests the actual invariant - the handle names a pid that becomes alive - without being a
// hostage to exactly how fast any given CI run's OS scheduler and AV scanner get out of the way.
function waitForProcessAlive(pid: number, timeoutMs = 10000): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isProcessAlive(pid)) return true;
    sleepSync(50);
  }
  return isProcessAlive(pid);
}

describe('ensureDaemonRunning', () => {
  it('writes a provisional handle for the spawned pid before returning, so an immediate second check does not spawn a duplicate', { timeout: 15000 }, () => {
    // shouldSpawnDaemon() and the actual spawn used to be two unsynchronized steps: two
    // load()/update() calls close together could both see "no live daemon" and both spawn one,
    // and the loser had no handle pointing at it at all - a genuinely orphaned process,
    // confirmed as the root cause of exactly that happening once already on a real project.
    // This proves the fix: by the time ensureDaemonRunning() returns, the handle already names
    // a pid that becomes live almost immediately, so a second caller's shouldSpawnDaemon()
    // correctly says "don't" once it does.
    writeGlobalSettings({ dashboardEnabled: true });
    ensureDaemonRunning();

    const handle = readDaemonHandle();
    expect(handle).not.toBeNull();
    expect(waitForProcessAlive(handle!.pid)).toBe(true);
    expect(shouldSpawnDaemon()).toBe(false);

    // Cleanup: this really did spawn a detached child process (there's no seam to fake that
    // without hiding the exact race this test exists to catch) - it must not survive the test.
    process.kill(handle!.pid, 'SIGKILL');
  });
});
