import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from '../../src/core/atomicWrite.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mi-atomic-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('atomicWriteFile', () => {
  it('writes the file content and leaves no temp file behind', () => {
    const target = join(dir, 'file.md');
    atomicWriteFile(target, 'hello world');
    expect(readFileSync(target, 'utf-8')).toBe('hello world');
    expect(readdirSync(dir)).toEqual(['file.md']);
  });

  it('overwrites an existing file completely', () => {
    const target = join(dir, 'file.md');
    writeFileSync(target, 'old content');
    atomicWriteFile(target, 'new content');
    expect(readFileSync(target, 'utf-8')).toBe('new content');
  });
});
