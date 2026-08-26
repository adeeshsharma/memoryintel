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

export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T> | T,
  opts: { retries?: number; delayMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 100;
  const delayMs = opts.delayMs ?? 20;

  let fd: number | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      break;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      if (attempt === retries) throw new Error(`Timed out waiting for lock: ${lockPath}`);
      await sleep(delayMs);
    }
  }

  try {
    return await fn();
  } finally {
    if (fd !== null) closeSync(fd);
    unlinkSync(lockPath);
  }
}

// Synchronous sibling of withLock, for callers on a synchronous public API (e.g. runLoad) that
// cannot be made async without rippling out to every caller. Same atomic exclusive-create
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
