import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashContent, getGeneratedFileHash, setGeneratedFileHash } from '../../src/core/generatedFileHashes.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mi-hashes-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('hashContent', () => {
  it('is deterministic and content-sensitive', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
  });
});

describe('getGeneratedFileHash', () => {
  it('returns undefined when memory-config.json does not exist', () => {
    expect(getGeneratedFileHash(root, 'instructions.md')).toBeUndefined();
  });

  it('returns undefined when the config exists but has no generatedFileHashes key', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ initializedAt: 'x', version: '0.1.0' }));
    expect(getGeneratedFileHash(root, 'instructions.md')).toBeUndefined();
  });

  it('returns undefined on corrupt JSON rather than throwing', () => {
    writeFileSync(join(root, 'memory-config.json'), '{not valid json');
    expect(getGeneratedFileHash(root, 'instructions.md')).toBeUndefined();
  });

  it('returns the recorded hash for the requested file only', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({
      generatedFileHashes: { 'instructions.md': 'abc123' }
    }));
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe('abc123');
    expect(getGeneratedFileHash(root, 'other.md')).toBeUndefined();
  });
});

describe('setGeneratedFileHash', () => {
  it('creates memory-config.json if it does not exist yet', () => {
    setGeneratedFileHash(root, 'instructions.md', 'deadbeef');
    const config = JSON.parse(readFileSync(join(root, 'memory-config.json'), 'utf-8'));
    expect(config.generatedFileHashes['instructions.md']).toBe('deadbeef');
  });

  it('preserves every other existing key in memory-config.json', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({
      initializedAt: '2026-01-01T00:00:00.000Z',
      version: '0.1.0',
      compression: { defaultCeilingLines: 500 }
    }));
    setGeneratedFileHash(root, 'instructions.md', 'deadbeef');
    const config = JSON.parse(readFileSync(join(root, 'memory-config.json'), 'utf-8'));
    expect(config.initializedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(config.compression.defaultCeilingLines).toBe(500);
    expect(config.generatedFileHashes['instructions.md']).toBe('deadbeef');
  });

  it('preserves other files already recorded in generatedFileHashes', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({
      generatedFileHashes: { 'other.md': 'existing-hash' }
    }));
    setGeneratedFileHash(root, 'instructions.md', 'deadbeef');
    const config = JSON.parse(readFileSync(join(root, 'memory-config.json'), 'utf-8'));
    expect(config.generatedFileHashes['other.md']).toBe('existing-hash');
    expect(config.generatedFileHashes['instructions.md']).toBe('deadbeef');
  });

  it('overwrites a previously recorded hash for the same file', () => {
    setGeneratedFileHash(root, 'instructions.md', 'first-hash');
    setGeneratedFileHash(root, 'instructions.md', 'second-hash');
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe('second-hash');
  });
});
