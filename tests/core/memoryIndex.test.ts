import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertIndexEntry, readIndex } from '../../src/core/memoryIndex.js';

let dir: string;
let indexPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-index-'));
  indexPath = join(dir, 'memory-index.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('upsertIndexEntry / readIndex', () => {
  it('creates the index file if missing and adds an entry', () => {
    upsertIndexEntry(indexPath, 'technical/architecture.md', 'JWT refresh introduced');
    const index = readIndex(indexPath);
    expect(index['technical/architecture.md'].summary).toBe('JWT refresh introduced');
    expect(typeof index['technical/architecture.md'].lastUpdated).toBe('string');
  });

  it('overwrites an existing entry for the same file', () => {
    upsertIndexEntry(indexPath, 'technical/architecture.md', 'first');
    upsertIndexEntry(indexPath, 'technical/architecture.md', 'second');
    const index = readIndex(indexPath);
    expect(Object.keys(index).length).toBe(1);
    expect(index['technical/architecture.md'].summary).toBe('second');
  });
});
