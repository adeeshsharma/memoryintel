import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function getGlobalDir(): string {
  return process.env.MEMORYINTEL_GLOBAL_DIR ?? join(homedir(), '.memoryintel');
}

export function ensureGlobalDir(): string {
  const dir = getGlobalDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function registryPath(): string { return join(getGlobalDir(), 'registry.json'); }
export function settingsPath(): string { return join(getGlobalDir(), 'settings.json'); }
export function daemonHandlePath(): string { return join(getGlobalDir(), 'daemon.json'); }
export function daemonLockPath(): string { return join(getGlobalDir(), 'daemon.lock'); }
