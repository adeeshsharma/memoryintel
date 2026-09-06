// tests/adapters/claudeCode.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheckStop, resolveCheckStopMarker } from '../../src/adapters/claudeCode.js';
import { runInit } from '../../src/commands/init.js';

let projectRoot: string;
let memoryRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'mi-cc-'));
  memoryRoot = join(projectRoot, '.memoryintel');
  mkdirSync(memoryRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'README.md'), 'test project\n');
});
afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

function initGitRepo(root: string): void {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
}

function commitAll(root: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root });
}

// Safely over the default trivial-diff line ceiling (20), so these fixtures keep exercising a
// genuinely non-trivial diff for the block/marker-mechanism tests below, independent of the
// trivial-diff-skip feature under test in its own describe block further down.
const SUBSTANTIAL_CHANGE = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
const SUBSTANTIAL_CHANGE_2 = Array.from({ length: 25 }, (_, i) => `other ${i}`).join('\n');

describe('runCheckStop', () => {
  it('allows the stop when the project is not a git repository (fail open)', () => {
    expect(runCheckStop(memoryRoot)).toEqual({});
  });

  it('allows the stop when the git working tree is clean', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    expect(runCheckStop(memoryRoot)).toEqual({});
  });

  it('blocks once when the working tree has uncommitted changes', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), SUBSTANTIAL_CHANGE);

    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/memoryintel update/);
    // Caught live: an agent read this exact message, ran bare `memoryintel update` (no plan
    // file), and hit a cryptic parser error. The reason text must spell out that a plan-file
    // argument is required, not just name the command.
    expect(result.reason).toContain('memoryintel update <plan-file>');

    const marker = JSON.parse(readFileSync(join(memoryRoot, '.session-marker.json'), 'utf-8'));
    expect(marker.lastFlaggedDiffSignature).toContain('src.ts');
  });

  it('allows on a repeated check for the exact same unresolved diff (no re-nagging)', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), SUBSTANTIAL_CHANGE);

    runCheckStop(memoryRoot);
    const second = runCheckStop(memoryRoot);
    expect(second).toEqual({});
  });

  it('blocks again when the diff changes further after already being flagged', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), SUBSTANTIAL_CHANGE);
    runCheckStop(memoryRoot);

    writeFileSync(join(projectRoot, 'other.ts'), SUBSTANTIAL_CHANGE_2);
    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
  });

  it('still blocks after a commit resolves the working tree, if memoryintel update was never run', () => {
    // This used to be the opposite: committing (without ever running `memoryintel update`) made
    // the working tree clean, and a clean tree was treated as "resolved" all on its own -
    // silencing the nudge even though nothing was ever actually recorded to memory. That's
    // exactly the gap a real project hit: this project's own established workflow is to commit
    // promptly, so the nudge went quiet almost immediately after every real change, and
    // `.session-marker.json` never once recorded a flagged diff across the project's whole
    // history despite substantial unaccounted work landing. The fix: HEAD is part of the
    // signature now, so a new commit is itself a "this needs to be resolved" event, not a way
    // to make the nudge go away for free.
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), SUBSTANTIAL_CHANGE);
    runCheckStop(memoryRoot);

    commitAll(projectRoot, 'resolved');
    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
  });

  it('blocks on the next check after a commit lands on a previously-clean, already-baselined tree', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    runCheckStop(memoryRoot); // establishes the baseline for 'initial'

    writeFileSync(join(projectRoot, 'src.ts'), SUBSTANTIAL_CHANGE);
    commitAll(projectRoot, 'new work, committed promptly');
    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
  });

  it('names the specific detected fact in the block reason when the diff touches package.json', () => {
    runInit(projectRoot);
    initGitRepo(projectRoot);
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    commitAll(projectRoot, 'initial');

    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { next: '^14.0.0' } })
    );

    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('technical/techContext.md');
  });

  it('does not mention detected facts in the reason when the diff does not touch a manifest file', () => {
    runInit(projectRoot);
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), SUBSTANTIAL_CHANGE);

    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
    expect(result.reason).not.toContain('technical/techContext.md');
  });
});

describe('runCheckStop trivial-diff skipping', () => {
  it('allows immediately (no block) when the diff is judged trivial, and records the skip on the marker', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'trivial.ts'), 'x');

    expect(runCheckStop(memoryRoot)).toEqual({});

    const marker = JSON.parse(readFileSync(join(memoryRoot, '.session-marker.json'), 'utf-8'));
    expect(marker.consecutiveTrivialSkips).toBe(1);
  });

  it('forces a real block on the Nth consecutive trivial skip (using a configured cap), then resets the counter', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(memoryRoot, 'memory-config.json'), JSON.stringify({ trivialDiff: { consecutiveSkipCap: 2 } }));

    writeFileSync(join(projectRoot, 'trivial1.ts'), 'x');
    expect(runCheckStop(memoryRoot)).toEqual({});

    writeFileSync(join(projectRoot, 'trivial2.ts'), 'y');
    const second = runCheckStop(memoryRoot);
    expect(second.decision).toBe('block');

    const marker = JSON.parse(readFileSync(join(memoryRoot, '.session-marker.json'), 'utf-8'));
    expect(marker.consecutiveTrivialSkips).toBe(0);
  });

  it('a manifest-file touch always blocks, never trivial-skips, even for a 1-line change', () => {
    initGitRepo(projectRoot);
    writeFileSync(join(projectRoot, 'package.json'), '{}');
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'package.json'), '{"a":1}');

    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
  });

  it('a marker file written before this feature (no consecutiveTrivialSkips key) is read as 0', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(memoryRoot, '.session-marker.json'), JSON.stringify({ lastFlaggedDiffSignature: null }));
    writeFileSync(join(projectRoot, 'trivial.ts'), 'x');

    expect(runCheckStop(memoryRoot)).toEqual({});
    const marker = JSON.parse(readFileSync(join(memoryRoot, '.session-marker.json'), 'utf-8'));
    expect(marker.consecutiveTrivialSkips).toBe(1);
  });
});

describe('resolveCheckStopMarker', () => {
  it('does not re-block on the very next check when the same diff is still present after update', () => {
    // Mirrors what `update` actually does: it writes to .memoryintel/, never to the source
    // file that triggered the nudge — so `src.ts` is still dirty afterward. resolveCheckStopMarker
    // must recognize that as "already accounted for", not treat it as a brand-new diff.
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), SUBSTANTIAL_CHANGE);
    expect(runCheckStop(memoryRoot).decision).toBe('block');

    resolveCheckStopMarker(memoryRoot);
    const result = runCheckStop(memoryRoot);
    expect(result).toEqual({});
  });

  it('still allows a genuinely clean tree afterward', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    resolveCheckStopMarker(memoryRoot);
    expect(runCheckStop(memoryRoot)).toEqual({});
  });

  it('blocks again if the diff grows further after resolving', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), SUBSTANTIAL_CHANGE);
    runCheckStop(memoryRoot);
    resolveCheckStopMarker(memoryRoot);

    writeFileSync(join(projectRoot, 'other.ts'), SUBSTANTIAL_CHANGE_2);
    expect(runCheckStop(memoryRoot).decision).toBe('block');
  });

  it('is safe to call when no marker file exists yet', () => {
    expect(() => resolveCheckStopMarker(memoryRoot)).not.toThrow();
  });

  it('resets the consecutive-skip counter after a real update, even if it was nonzero', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'trivial.ts'), 'x');
    runCheckStop(memoryRoot); // one trivial skip recorded

    resolveCheckStopMarker(memoryRoot);

    const marker = JSON.parse(readFileSync(join(memoryRoot, '.session-marker.json'), 'utf-8'));
    expect(marker.consecutiveTrivialSkips).toBe(0);
  });
});
