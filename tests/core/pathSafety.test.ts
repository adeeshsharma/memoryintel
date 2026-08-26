import { describe, it, expect } from 'vitest';
import { assertSafePath, UnsafePathError, WRITABLE_FILES } from '../../src/core/pathSafety.js';
import { join } from 'node:path';

describe('assertSafePath', () => {
  const root = '/tmp/fake-root/.memoryintel';

  it('accepts every file in WRITABLE_FILES', () => {
    for (const file of WRITABLE_FILES) {
      expect(assertSafePath(root, file)).toBe(join(root, file));
    }
  });

  it('rejects a path outside the known writable set', () => {
    expect(() => assertSafePath(root, 'intelligence/entities.json')).toThrow(UnsafePathError);
  });

  it('rejects path traversal attempts', () => {
    expect(() => assertSafePath(root, '../../etc/passwd')).toThrow(UnsafePathError);
  });

  it('rejects absolute paths', () => {
    expect(() => assertSafePath(root, '/etc/passwd')).toThrow(UnsafePathError);
  });
});
