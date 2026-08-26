import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFileHealth } from '../../src/daemon/health.js';

let memoryRoot: string;

beforeEach(() => { memoryRoot = mkdtempSync(join(tmpdir(), 'mi-health-')); });
afterEach(() => rmSync(memoryRoot, { recursive: true, force: true }));

describe('computeFileHealth', () => {
  it('reports null lastUpdated/staleDays for a file never touched by update', () => {
    writeFileSync(join(memoryRoot, 'memory-index.json'), '{}');
    const health = computeFileHealth(memoryRoot);
    const entry = health.find((h) => h.file === 'technical/architecture.md')!;
    expect(entry.lastUpdated).toBeNull();
    expect(entry.staleDays).toBeNull();
  });

  it('computes staleDays from the index lastUpdated timestamp', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(join(memoryRoot, 'memory-index.json'), JSON.stringify({
      'technical/architecture.md': { lastUpdated: twoDaysAgo, summary: 'x' }
    }));
    const health = computeFileHealth(memoryRoot);
    const entry = health.find((h) => h.file === 'technical/architecture.md')!;
    expect(entry.lastUpdated).toBe(twoDaysAgo);
    expect(entry.staleDays).toBe(2);
  });

  it('covers every writable file exactly once', () => {
    writeFileSync(join(memoryRoot, 'memory-index.json'), '{}');
    const health = computeFileHealth(memoryRoot);
    const files = health.map((h) => h.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain('context/decisions.md');
  });
});
