import { openSync, closeSync, unlinkSync, constants } from 'node:fs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A blocking sleep, for callers that cannot go async (see withLockSync below) — Atomics.wait on
// a throwaway SharedArrayBuffer is the standard way to synchronously pause a Node.js thread
// without a busy-loop burning CPU.
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function acquireLock(lockPath: string, retries: number, delayMs: number): Promise<number> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      if (attempt === retries) throw new Error(`Timed out waiting for lock: ${lockPath}`);
      await sleep(delayMs);
    }
  }
  throw new Error(`Timed out waiting for lock: ${lockPath}`);
}

// Acquires every lock in `lockPaths` (deduped, sorted into one global acquisition order so any
// two callers that both need locks A and B can never deadlock by acquiring them in opposite
// order) before running fn, releasing them all afterward even if fn throws. This is what lets a
// caller lock only the specific files a given operation touches - e.g. update() locking just the
// files named in its plan - instead of one project-wide lock that would serialize every update()
// call against every other, even when they touch entirely disjoint files.
export async function withLocks<T>(
  lockPaths: string[],
  fn: () => Promise<T> | T,
  opts: { retries?: number; delayMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 100;
  const delayMs = opts.delayMs ?? 20;
  const sorted = [...new Set(lockPaths)].sort();

  const fds: number[] = [];
  try {
    for (const lockPath of sorted) {
      fds.push(await acquireLock(lockPath, retries, delayMs));
    }
    return await fn();
  } finally {
    // Release in reverse acquisition order; each lock is independent so any partial-acquisition
    // failure above only needs to unwind what was actually opened, which the fds/sorted-prefix
    // pairing here already reflects.
    for (let i = fds.length - 1; i >= 0; i--) {
      closeSync(fds[i]);
      unlinkSync(sorted[i]);
    }
  }
}

// Synchronous, single-lock sibling of withLocks, for callers on a synchronous public API (e.g.
// runLoad) that cannot be made async without rippling out to every caller. Same atomic exclusive-create
// technique; a shorter default retry budget since callers using this are on a hot, latency-
// sensitive path and the critical section (spawnDaemonProcess is a non-blocking spawn().unref())
// is expected to be sub-millisecond, not something worth blocking a CLI invocation over.
export function withLockSync<T>(
  lockPath: string,
  fn: () => T,
  opts: { retries?: number; delayMs?: number } = {}
): T {
  const retries = opts.retries ?? 25;
  const delayMs = opts.delayMs ?? 4;

  let fd: number | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      break;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      if (attempt === retries) throw new Error(`Timed out waiting for lock: ${lockPath}`);
      sleepSync(delayMs);
    }
  }

  try {
    return fn();
  } finally {
    if (fd !== null) closeSync(fd);
    unlinkSync(lockPath);
  }
}
