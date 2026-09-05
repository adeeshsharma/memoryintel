import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCeilingChars, countLines, DEFAULT_CEILING_CHARS } from '../../src/core/compressionConfig.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mi-compconfig-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('countLines', () => {
  it('returns 0 for empty content', () => {
    expect(countLines('')).toBe(0);
  });

  it('counts lines including a trailing blank line from a final newline', () => {
    expect(countLines('a\nb\nc\n')).toBe(4);
  });
});

describe('getCeilingChars', () => {
  it('returns the built-in default when memory-config.json does not exist', () => {
    expect(getCeilingChars(root, 'technical/architecture.md')).toBe(DEFAULT_CEILING_CHARS);
  });

  it('returns the built-in default when memory-config.json has no compression key', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ version: '0.1.0' }));
    expect(getCeilingChars(root, 'technical/architecture.md')).toBe(DEFAULT_CEILING_CHARS);
  });

  it("returns memory-config.json's defaultCeilingChars when set", () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingChars: 20000 } }));
    expect(getCeilingChars(root, 'technical/architecture.md')).toBe(20000);
  });

  it('prefers a domain override over the default', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({
      compression: { defaultCeilingChars: 12000, domainOverrides: { technical: 30000 } }
    }));
    expect(getCeilingChars(root, 'technical/architecture.md')).toBe(30000);
    expect(getCeilingChars(root, 'business/roadmap.md')).toBe(12000);
  });

  it('falls back to the built-in default on corrupt JSON rather than throwing', () => {
    writeFileSync(join(root, 'memory-config.json'), '{ not json');
    expect(getCeilingChars(root, 'technical/architecture.md')).toBe(DEFAULT_CEILING_CHARS);
  });
});
