import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGitStatusPorcelain } from '../../src/core/gitPorcelain.js';
import {
  readTrivialDiffConfig,
  DEFAULT_LINE_CEILING,
  DEFAULT_CONSECUTIVE_SKIP_CAP,
  isTrivialDiff,
  MANIFEST_FILES,
  LOCKFILE_NAMES
} from '../../src/core/trivialDiff.js';

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

function initGitRepo(root: string): void {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
}

function commitAll(root: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root });
}

const DEFAULT_CONFIG = { lineCeiling: 20, consecutiveSkipCap: 3 };
const MANY_LINES = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
const FEW_LINES = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n');

function statusLinesFor(root: string): string[] {
  return runGitStatusPorcelain(root) ?? [];
}

describe('isTrivialDiff', () => {
  it('is trivial when there are no changed files at all', () => {
    expect(isTrivialDiff('/irrelevant', [], DEFAULT_CONFIG)).toBe(true);
  });

  it('is never trivial when a manifest file is touched, even a 1-line change', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'package.json'), '{}');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'package.json'), '{"a":1}');
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(false);
    expect(MANIFEST_FILES.has('package.json')).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('is trivial when every changed file is a lockfile', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'README.md'), 'x');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'package-lock.json'), MANY_LINES);
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(true);
    expect(LOCKFILE_NAMES.has('package-lock.json')).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('excludes lockfiles from the line-count sum: a lockfile plus a small real change is trivial', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'README.md'), 'x');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'package-lock.json'), MANY_LINES);
    writeFileSync(join(root, 'src.ts'), FEW_LINES);
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('a whitespace-only change to a tracked file is trivial regardless of line count', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'src.ts'), MANY_LINES + '\n');
    commitAll(root, 'initial');
    const reindented = MANY_LINES.split('\n').map((l) => '    ' + l).join('\n') + '\n';
    writeFileSync(join(root, 'src.ts'), reindented);
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('a real (non-whitespace) change under the line ceiling is trivial', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'src.ts'), 'original\n');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'src.ts'), FEW_LINES);
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('a real change at/over the line ceiling is not trivial', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'src.ts'), 'original\n');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'src.ts'), MANY_LINES);
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('a small untracked (new) file is trivial via its own line count', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'README.md'), 'x');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'new.ts'), FEW_LINES);
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('a large untracked (new) file is not trivial', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'README.md'), 'x');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'new.ts'), MANY_LINES);
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('a large deletion is not trivial', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'big.ts'), MANY_LINES);
    commitAll(root, 'initial');
    execFileSync('git', ['rm', '-q', 'big.ts'], { cwd: root });
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('a whitespace-only tracked file mixed with a large untracked file is not trivial (falls through to line count)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'src.ts'), MANY_LINES + '\n');
    commitAll(root, 'initial');
    const reindented = MANY_LINES.split('\n').map((l) => '    ' + l).join('\n') + '\n';
    writeFileSync(join(root, 'src.ts'), reindented);
    writeFileSync(join(root, 'new.ts'), MANY_LINES);
    expect(isTrivialDiff(root, statusLinesFor(root), DEFAULT_CONFIG)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('respects a custom lineCeiling from config', () => {
    const root = mkdtempSync(join(tmpdir(), 'mi-trivial-'));
    initGitRepo(root);
    writeFileSync(join(root, 'src.ts'), 'original\n');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'src.ts'), FEW_LINES);
    expect(isTrivialDiff(root, statusLinesFor(root), { lineCeiling: 2, consecutiveSkipCap: 3 })).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
