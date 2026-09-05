import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSync, closeSync, constants } from 'node:fs';
import { withLocks, withLockSync } from '../../src/core/lock.js';

let dir: string;
let lockPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-lock-'));
  lockPath = join(dir, '.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('withLocks', () => {
  it('runs the function and releases a single lock afterward', async () => {
    const result = await withLocks([lockPath], () => 42);
    expect(result).toBe(42);
    // Lock released — a second call should succeed immediately.
    expect(await withLocks([lockPath], () => 43)).toBe(43);
  });

  it('acquires every given lock and releases them all afterward', async () => {
    const lockA = join(dir, 'a.lock');
    const lockB = join(dir, 'b.lock');
    const result = await withLocks([lockA, lockB], () => 42);
    expect(result).toBe(42);
    // Both released — a second call over the same paths should succeed immediately.
    expect(await withLocks([lockA, lockB], () => 43)).toBe(43);
  });

  it('two calls over disjoint lock sets run concurrently, not serialized', async () => {
    const order: string[] = [];
    const first = withLocks([join(dir, 'a.lock')], async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('first-end');
    });
    // Give `first` a moment to acquire its lock — if the two calls shared a lock, `second`
    // would have to wait for `first-end` before starting; disjoint lock sets mean it doesn't.
    await new Promise((r) => setTimeout(r, 5));
    const second = withLocks([join(dir, 'b.lock')], () => { order.push('second-start'); });

    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'second-start', 'first-end']);
  });

  it('two calls sharing a lock path still serialize', async () => {
    const shared = join(dir, 'shared.lock');
    const order: string[] = [];
    const first = withLocks([shared], async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('first-end');
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = withLocks([shared], () => { order.push('second-start'); });

    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('releases every acquired lock even if the function throws', async () => {
    const lockA = join(dir, 'a.lock');
    const lockB = join(dir, 'b.lock');
    await expect(withLocks([lockA, lockB], () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await withLocks([lockA, lockB], () => 'recovered')).toBe('recovered');
  });

  it('deduplicates a repeated lock path instead of deadlocking on itself', async () => {
    const lockA = join(dir, 'a.lock');
    const result = await withLocks([lockA, lockA], () => 'ok');
    expect(result).toBe('ok');
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
    // from another thread mid-call the way the async withLocks tests do with a timer, since
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
