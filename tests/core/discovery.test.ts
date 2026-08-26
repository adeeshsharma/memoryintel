import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMemoryIntelRoot } from '../../src/core/discovery.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mi-discovery-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('findMemoryIntelRoot', () => {
  it('finds .memoryintel in the starting directory', () => {
    mkdirSync(join(root, '.memoryintel'));
    expect(findMemoryIntelRoot(root)).toBe(join(root, '.memoryintel'));
  });

  it('finds .memoryintel by walking up from a nested subdirectory', () => {
    mkdirSync(join(root, '.memoryintel'));
    const nested = join(root, 'src', 'deep', 'nested');
    mkdirSync(nested, { recursive: true });
    expect(findMemoryIntelRoot(nested)).toBe(join(root, '.memoryintel'));
  });

  it('returns null when no .memoryintel exists anywhere above', () => {
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(findMemoryIntelRoot(nested)).toBeNull();
  });
});
