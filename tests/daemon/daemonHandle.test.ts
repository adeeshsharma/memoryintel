import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { readDaemonHandle, writeDaemonHandle, clearDaemonHandle, isProcessAlive, pickFreePort } from '../../src/daemon/daemonHandle.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-handle-'));
  process.env.MEMORYINTEL_GLOBAL_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MEMORYINTEL_GLOBAL_DIR;
});

describe('daemon handle', () => {
  it('returns null when no handle has been written', () => {
    expect(readDaemonHandle()).toBeNull();
  });

  it('round-trips a written handle', () => {
    writeDaemonHandle({ port: 4390, pid: 12345 });
    expect(readDaemonHandle()).toEqual({ port: 4390, pid: 12345 });
  });

  it('clearDaemonHandle removes it', () => {
    writeDaemonHandle({ port: 4390, pid: 12345 });
    clearDaemonHandle();
    expect(readDaemonHandle()).toBeNull();
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a pid that almost certainly does not exist', () => {
    expect(isProcessAlive(999999)).toBe(false);
  });
});

describe('pickFreePort', () => {
  it('returns the requested port when it is free', async () => {
    const port = await pickFreePort(41000);
    expect(port).toBe(41000);
  });

  it('skips a port that is already bound', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(41010, '127.0.0.1', resolve));
    try {
      const port = await pickFreePort(41010);
      expect(port).toBe(41011);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it('resolves the real OS-assigned port when startPort is 0, not 0 itself', async () => {
    const port = await pickFreePort(0);
    expect(port).toBeGreaterThan(0);

    // The resolved port must actually be connectable — regression check for the bug where
    // this resolved with the literal input (0) instead of the OS-assigned port.
    const verify = createServer();
    await new Promise<void>((resolve, reject) => {
      verify.once('error', reject);
      verify.listen(port, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve) => verify.close(() => resolve()));
  });
});
