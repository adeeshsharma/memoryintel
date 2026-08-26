import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSync, closeSync, constants } from 'node:fs';
import { withLock, withLockSync } from '../../src/core/lock.js';

let dir: string;
let lockPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-lock-'));
  lockPath = join(dir, '.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('withLock', () => {
  it('runs the function and releases the lock afterward', async () => {
    const result = await withLock(lockPath, () => 42);
    expect(result).toBe(42);
    // Lock released — a second call should succeed immediately.
    const second = await withLock(lockPath, () => 43);
    expect(second).toBe(43);
  });

  it('serializes two concurrent calls instead of racing', async () => {
    const order: string[] = [];
    const first = withLock(lockPath, async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('first-end');
    });
    // Give `first` a moment to acquire the lock before `second` tries.
    await new Promise((r) => setTimeout(r, 5));
    const second = withLock(lockPath, () => { order.push('second-start'); });

    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('releases the lock even if the function throws', async () => {
    await expect(withLock(lockPath, () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await withLock(lockPath, () => 'recovered');
    expect(result).toBe('recovered');
  });
});

describe('withLockSync', () => {
  it('runs the function and releases the lock afterward', () => {
    const result = withLockSync(lockPath, () => 42);
    expect(result).toBe(42);
    // Lock released — a second call should succeed immediately.
    expect(withLockSync(lockPath, () => 43)).toBe(43);
  });

  it('releases the lock even if the function throws', () => {
    expect(() => withLockSync(lockPath, () => { throw new Error('boom'); })).toThrow('boom');
    expect(withLockSync(lockPath, () => 'recovered')).toBe('recovered');
  });

  it('times out with a clear error if the lock is never released', () => {
    // Simulates another process holding the lock indefinitely - there's no way to release it
    // from another thread mid-call the way the async withLock test does with a timer, since
    // withLockSync blocks this thread synchronously. Pre-creating (and never removing) the lock
    // file is the synchronous equivalent: it proves the retry budget is real and bounded, not
    // an infinite/silent hang.
    const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    try {
      expect(() => withLockSync(lockPath, () => 'never', { retries: 3, delayMs: 1 })).toThrow('Timed out waiting for lock');
    } finally {
      closeSync(fd);
    }
  });
});
