import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTrivialDiffConfig, DEFAULT_LINE_CEILING, DEFAULT_CONSECUTIVE_SKIP_CAP } from '../../src/core/trivialDiff.js';

describe('readTrivialDiffConfig', () => {
  it('returns the built-in defaults when memory-config.json does not exist', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'mi-trivial-config-'));
    expect(readTrivialDiffConfig(memoryRoot)).toEqual({
      lineCeiling: DEFAULT_LINE_CEILING,
      consecutiveSkipCap: DEFAULT_CONSECUTIVE_SKIP_CAP
    });
    rmSync(memoryRoot, { recursive: true, force: true });
  });

  it('honors overrides from the trivialDiff block', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'mi-trivial-config-'));
    writeFileSync(join(memoryRoot, 'memory-config.json'), JSON.stringify({ trivialDiff: { lineCeiling: 5, consecutiveSkipCap: 2 } }));
    expect(readTrivialDiffConfig(memoryRoot)).toEqual({ lineCeiling: 5, consecutiveSkipCap: 2 });
    rmSync(memoryRoot, { recursive: true, force: true });
  });

  it('falls back to defaults on corrupt JSON instead of throwing', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'mi-trivial-config-'));
    writeFileSync(join(memoryRoot, 'memory-config.json'), '{ not valid json');
    expect(() => readTrivialDiffConfig(memoryRoot)).not.toThrow();
    expect(readTrivialDiffConfig(memoryRoot)).toEqual({
      lineCeiling: DEFAULT_LINE_CEILING,
      consecutiveSkipCap: DEFAULT_CONSECUTIVE_SKIP_CAP
    });
    rmSync(memoryRoot, { recursive: true, force: true });
  });

  it('falls back to defaults when memory-config.json has no trivialDiff block', () => {
    const memoryRoot = mkdtempSync(join(tmpdir(), 'mi-trivial-config-'));
    writeFileSync(join(memoryRoot, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingChars: 5000 } }));
    expect(readTrivialDiffConfig(memoryRoot)).toEqual({
      lineCeiling: DEFAULT_LINE_CEILING,
      consecutiveSkipCap: DEFAULT_CONSECUTIVE_SKIP_CAP
    });
    rmSync(memoryRoot, { recursive: true, force: true });
  });
});
