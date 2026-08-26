import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface IndexEntry {
  lastUpdated: string;
  summary: string;
}

export function readIndex(indexPath: string): Record<string, IndexEntry> {
  if (!existsSync(indexPath)) return {};
  const raw = readFileSync(indexPath, 'utf-8').trim();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt memory index at ${indexPath}: ${(err as Error).message}`);
  }
}

export function upsertIndexEntry(indexPath: string, file: string, summary: string): void {
  const index = readIndex(indexPath);
  index[file] = { lastUpdated: new Date().toISOString(), summary };
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
}
