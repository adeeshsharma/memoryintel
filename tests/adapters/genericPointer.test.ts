import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPointerAdapters } from '../../src/adapters/genericPointer.js';

let projectRoot: string;
beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), 'mi-pointer-')); });
afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

describe('installPointerAdapters', () => {
  it('creates AGENTS.md with a pointer block when no native file exists', () => {
    installPointerAdapters(projectRoot);
    const content = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('memoryintel:managed:start');
    expect(content).toContain('.memoryintel/instructions.md');
  });

  it('appends the pointer block to an existing GEMINI.md without touching prior content', () => {
    writeFileSync(join(projectRoot, 'GEMINI.md'), '# My project notes\nSome existing content.\n');
    installPointerAdapters(projectRoot);
    const content = readFileSync(join(projectRoot, 'GEMINI.md'), 'utf-8');
    expect(content).toContain('Some existing content.');
    expect(content).toContain('memoryintel:managed:start');
  });

  it('writes .cursor/rules/memoryintel.mdc with alwaysApply: true', () => {
    installPointerAdapters(projectRoot);
    const content = readFileSync(join(projectRoot, '.cursor', 'rules', 'memoryintel.mdc'), 'utf-8');
    expect(content).toContain('alwaysApply: true');
    expect(content).toContain('.memoryintel/instructions.md');
  });

  it('is idempotent: re-running does not duplicate the pointer block', () => {
    installPointerAdapters(projectRoot);
    installPointerAdapters(projectRoot);
    const content = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf-8');
    const occurrences = (content.match(/memoryintel:managed:start/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('does not create AGENTS.md when a native file already existed', () => {
    writeFileSync(join(projectRoot, 'GEMINI.md'), '# notes\n');
    installPointerAdapters(projectRoot);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
  });
});
