import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGitStatusPorcelain, porcelainPath, isPathClean, runGitRevParseHead, runGitChurn } from '../../src/core/gitPorcelain.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mi-porcelain-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

function commitAll(dir: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

describe('runGitStatusPorcelain', () => {
  it('returns null when the directory is not a git repository', () => {
    expect(runGitStatusPorcelain(root)).toBeNull();
  });

  it('returns an empty array for a clean repository', () => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'a');
    commitAll(root, 'initial');
    expect(runGitStatusPorcelain(root)).toEqual([]);
  });

  it('returns one line per changed path, with the fixed status-code prefix intact', () => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'a');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'a.txt'), 'changed');
    writeFileSync(join(root, 'b.txt'), 'new');

    const lines = runGitStatusPorcelain(root)!;
    expect(lines).toHaveLength(2);
    expect(lines.map(porcelainPath).sort()).toEqual(['a.txt', 'b.txt']);
  });
});

describe('runGitRevParseHead', () => {
  it('returns null when the directory is not a git repository', () => {
    expect(runGitRevParseHead(root)).toBeNull();
  });

  it('returns null when the repository has no commits yet', () => {
    initGitRepo(root);
    expect(runGitRevParseHead(root)).toBeNull();
  });

  it('returns the current commit sha, and a new sha after the next commit', () => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'a');
    commitAll(root, 'initial');
    const first = runGitRevParseHead(root);
    expect(first).toMatch(/^[0-9a-f]{40}$/);

    writeFileSync(join(root, 'a.txt'), 'changed');
    commitAll(root, 'second');
    expect(runGitRevParseHead(root)).not.toBe(first);
  });
});

describe('isPathClean', () => {
  it('returns null when the directory is not a git repository', () => {
    expect(isPathClean(root, 'a.txt')).toBeNull();
  });

  it('returns true for a path with no uncommitted changes', () => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'a');
    writeFileSync(join(root, 'b.txt'), 'b');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'b.txt'), 'changed');

    expect(isPathClean(root, 'a.txt')).toBe(true);
  });

  it('returns false for a path with uncommitted changes', () => {
    initGitRepo(root);
    writeFileSync(join(root, 'a.txt'), 'a');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'a.txt'), 'changed');

    expect(isPathClean(root, 'a.txt')).toBe(false);
  });
});

describe('runGitChurn', () => {
  it('ranks files by number of commits touching them', () => {
    initGitRepo(root);
    writeFileSync(join(root, 'hot.txt'), '1');
    writeFileSync(join(root, 'cold.txt'), '1');
    commitAll(root, 'initial');
    writeFileSync(join(root, 'hot.txt'), '2');
    commitAll(root, 'second');
    writeFileSync(join(root, 'hot.txt'), '3');
    commitAll(root, 'third');

    const churn = runGitChurn(root);
    expect(churn[0]).toEqual({ path: 'hot.txt', changes: 3 });
    expect(churn.find((c) => c.path === 'cold.txt')?.changes).toBe(1);
  });

  it('returns an empty list, not a throw, outside a git repository', () => {
    expect(runGitChurn(root)).toEqual([]);
  });
});
