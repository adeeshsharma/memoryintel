import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPointerAdapters, refreshPointerBlock } from '../../src/adapters/genericPointer.js';

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

describe('refreshPointerBlock', () => {
  it('returns missing-file when the target file does not exist', () => {
    expect(refreshPointerBlock(join(projectRoot, 'AGENTS.md'))).toBe('missing-file');
  });

  it('returns not-installed and leaves the file untouched when no marker is present', () => {
    writeFileSync(join(projectRoot, 'AGENTS.md'), '# Just some notes, no pointer block here\n');
    const result = refreshPointerBlock(join(projectRoot, 'AGENTS.md'));
    expect(result).toBe('not-installed');
    expect(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf-8')).toBe('# Just some notes, no pointer block here\n');
  });

  it('returns unchanged when the installed block already matches the current template exactly', () => {
    installPointerAdapters(projectRoot);
    const result = refreshPointerBlock(join(projectRoot, 'AGENTS.md'));
    expect(result).toBe('unchanged');
  });

  it('restores a hand-edited block to the current template, leaving surrounding content untouched', () => {
    installPointerAdapters(projectRoot);
    const agentsPath = join(projectRoot, 'AGENTS.md');
    const original = readFileSync(agentsPath, 'utf-8');
    const tampered = original.replace('Two hard requirements', 'ONE EDITED REQUIREMENT');
    writeFileSync(agentsPath, tampered);

    const result = refreshPointerBlock(agentsPath);
    expect(result).toBe('refreshed');
    const restored = readFileSync(agentsPath, 'utf-8');
    expect(restored).toBe(original);
    expect(restored).not.toContain('ONE EDITED REQUIREMENT');
  });

  it('leaves content outside the markers completely untouched when refreshing', () => {
    writeFileSync(join(projectRoot, 'GEMINI.md'), '# My project notes\nSome existing content.\n');
    installPointerAdapters(projectRoot);
    const geminiPath = join(projectRoot, 'GEMINI.md');
    const beforeRefresh = readFileSync(geminiPath, 'utf-8');
    refreshPointerBlock(geminiPath);
    expect(readFileSync(geminiPath, 'utf-8')).toBe(beforeRefresh);
    expect(readFileSync(geminiPath, 'utf-8')).toContain('Some existing content.');
  });
});
