import { WRITABLE_FILES } from '../core/pathSafety.js';
import { readIndex } from '../core/memoryIndex.js';
import { join } from 'node:path';

export interface FileHealth {
  file: string;
  lastUpdated: string | null;
  staleDays: number | null;
}

export function computeFileHealth(memoryRoot: string): FileHealth[] {
  const index = readIndex(join(memoryRoot, 'memory-index.json'));
  const now = Date.now();

  return WRITABLE_FILES.map((file) => {
    const entry = index[file];
    if (!entry) return { file, lastUpdated: null, staleDays: null };

    const staleDays = Math.floor((now - new Date(entry.lastUpdated).getTime()) / (24 * 60 * 60 * 1000));
    return { file, lastUpdated: entry.lastUpdated, staleDays };
  });
}
