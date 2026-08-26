import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readGlobalSettings } from './settings.js';
import { readDaemonHandle, writeDaemonHandle, isProcessAlive } from './daemonHandle.js';
import { ensureGlobalDir, daemonLockPath } from './globalPaths.js';
import { withLockSync } from '../core/lock.js';

export function shouldSpawnDaemon(): boolean {
  if (!readGlobalSettings().dashboardEnabled) return false;
  const handle = readDaemonHandle();
  if (!handle) return true;
  return !isProcessAlive(handle.pid);
}

// Not deeply unit tested — it starts a real detached process. Exercised by Task 13's
// e2e test only insofar as `ensureDaemonRunning` decides *whether* to call it.
export function spawnDaemonProcess(): number {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
  const child = spawn(process.execPath, [cliPath, 'daemon', 'start'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return child.pid!;
}

// shouldSpawnDaemon() (read handle, check liveness) and spawnDaemonProcess() (spawn a detached
// child) are two separate steps with no atomicity between them - two `load`/`update` calls
// running close together can both see "no live daemon" and both spawn one, and the loser's
// daemon then has no handle pointing at it at all once the winner's write lands last. That's a
// genuinely orphaned process with no way to discover it later short of `ps` - confirmed as the
// root cause of exactly that happening once already on a real project. withLockSync closes the
// gap: only one caller can be inside the check-and-spawn section at a time. It's not enough on
// its own, though - the real daemon only writes its OWN full handle (with the real port) once
// it's actually listening (see server.ts's startDaemon), which happens after this function has
// already returned. A second caller arriving in that window would still see a stale/missing
// handle and spawn again. Writing a provisional handle - same pid the child was just spawned
// with, port unknown - closes that second gap too: isProcessAlive(handle.pid) is true the
// instant the child exists, before it has bound a port or written anything itself, and the
// child's own later write (same pid) just fills in the real port over this placeholder.
export function ensureDaemonRunning(): void {
  try {
    ensureGlobalDir();
    withLockSync(daemonLockPath(), () => {
      if (shouldSpawnDaemon()) {
        const pid = spawnDaemonProcess();
        writeDaemonHandle({ pid, port: 0 });
      }
    });
  } catch {
    // Best-effort only — dashboard visibility must never break the calling command.
  }
}
