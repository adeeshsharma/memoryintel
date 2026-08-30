import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { atomicWriteFile } from './atomicWrite.js';

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function configPath(root: string): string {
  return join(root, 'memory-config.json');
}

// Missing file or corrupt JSON both fall back to an empty object - the same defensive,
// never-throw read pattern compressionConfig.ts already uses for this same file, since neither
// getGeneratedFileHash nor setGeneratedFileHash should ever abort doctor/init over a config
// read problem that isn't this feature's to fix.
function readConfig(root: string): Record<string, unknown> {
  const path = configPath(root);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function getGeneratedFileHash(root: string, relFile: string): string | undefined {
  const hashes = readConfig(root).generatedFileHashes;
  if (hashes && typeof hashes === 'object') {
    const value = (hashes as Record<string, unknown>)[relFile];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

export function setGeneratedFileHash(root: string, relFile: string, hash: string): void {
  const config = readConfig(root);
  const existingHashes =
    config.generatedFileHashes && typeof config.generatedFileHashes === 'object'
      ? (config.generatedFileHashes as Record<string, string>)
      : {};
  config.generatedFileHashes = { ...existingHashes, [relFile]: hash };
  atomicWriteFile(configPath(root), JSON.stringify(config, null, 2) + '\n');
}
