import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { ensureGlobalDir, daemonHandlePath } from './globalPaths.js';

export interface DaemonHandle {
  port: number;
  pid: number;
}

export function readDaemonHandle(): DaemonHandle | null {
  const path = daemonHandlePath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeDaemonHandle(handle: DaemonHandle): void {
  ensureGlobalDir();
  writeFileSync(daemonHandlePath(), JSON.stringify(handle, null, 2) + '\n');
}

export function clearDaemonHandle(): void {
  const path = daemonHandlePath();
  if (existsSync(path)) unlinkSync(path);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

export function pickFreePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const tester = createServer();
      tester.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          tester.close(() => tryPort(port + 1));
        } else {
          reject(err);
        }
      });
      tester.once('listening', () => {
        const address = tester.address();
        // When startPort is 0, the OS assigns a random free port — address().port carries
        // the real value; `port` itself would still be 0. For an explicit non-zero startPort,
        // address().port equals it, so this is safe for both cases.
        const boundPort = typeof address === 'object' && address !== null ? address.port : port;
        tester.close(() => resolve(boundPort));
      });
      tester.listen(port, '127.0.0.1');
    };
    tryPort(startPort);
  });
}
