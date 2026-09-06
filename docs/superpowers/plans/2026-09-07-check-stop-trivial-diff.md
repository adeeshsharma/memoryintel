# check-stop Trivial-Diff Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `check-stop` skip blocking on trivial diffs (lockfile-only, whitespace-only, or small under a configurable line ceiling), while a manifest-file touch always still blocks and a consecutive-skip cap forces a real block if trivial diffs keep piling up unnoticed.

**Architecture:** A new pure-logic module, `src/core/trivialDiff.ts`, owns an ordered decision tree (`isTrivialDiff`) plus a `memory-config.json` reader (`readTrivialDiffConfig`) mirroring the existing `compressionConfig.ts` pattern. `src/adapters/claudeCode.ts`'s `runCheckStop` calls into it right before it would otherwise write the marker and block, and `.session-marker.json` gains a `consecutiveTrivialSkips` counter that `resolveCheckStopMarker` resets.

**Tech Stack:** TypeScript, Node `child_process.execFileSync` (git shell-out, matching the existing `gitPorcelain.ts` style), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-check-stop-trivial-diff-design.md`

## Global Constraints

- Default line ceiling: 20 (`DEFAULT_LINE_CEILING`). Configurable via `memory-config.json`'s `trivialDiff.lineCeiling`.
- Default consecutive-skip cap: 3 (`DEFAULT_CONSECUTIVE_SKIP_CAP`). Configurable via `trivialDiff.consecutiveSkipCap`.
- A manifest-file touch (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`) is an absolute veto — never trivial, regardless of any other rule.
- Any git command failure during triviality classification fails **closed** (treated as not trivial) — never silently allow on an error.
- No semantic/AST diff analysis, no enable/disable toggle for the feature as a whole, no change to Claude Code's own block wording. Only the two numeric config knobs above exist.
- Feature ships on by default — no opt-in flag.

---

### Task 1: `trivialDiff.ts` — config reader

**Files:**
- Create: `src/core/trivialDiff.ts`
- Test: `tests/core/trivialDiff.test.ts`

**Interfaces:**
- Produces: `export interface TrivialDiffConfig { lineCeiling: number; consecutiveSkipCap: number }`, `export const DEFAULT_LINE_CEILING = 20`, `export const DEFAULT_CONSECUTIVE_SKIP_CAP = 3`, `export function readTrivialDiffConfig(memoryRoot: string): TrivialDiffConfig`.

- [ ] **Step 1: Write the failing tests**

Create `tests/core/trivialDiff.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/trivialDiff.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/trivialDiff.js'` (or similar module-not-found).

- [ ] **Step 3: Create the implementation**

Create `src/core/trivialDiff.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mirrors compressionConfig.ts's DEFAULT_CEILING_CHARS pattern: a small, stable default most
// projects never need to override.
export const DEFAULT_LINE_CEILING = 20;
export const DEFAULT_CONSECUTIVE_SKIP_CAP = 3;

export interface TrivialDiffConfig {
  lineCeiling: number;
  consecutiveSkipCap: number;
}

interface RawTrivialDiffConfig {
  lineCeiling?: number;
  consecutiveSkipCap?: number;
}

// Reads memory-config.json's optional `trivialDiff` block, following the exact same
// missing-file/missing-key/corrupt-JSON-all-fall-back-silently pattern compressionConfig.ts
// already uses for `compression` — this is a read-time convenience for check-stop, never a
// place that should throw and interrupt the Stop hook.
function readRawConfig(memoryRoot: string): RawTrivialDiffConfig {
  const configPath = join(memoryRoot, 'memory-config.json');
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.trivialDiff && typeof parsed.trivialDiff === 'object') {
      return parsed.trivialDiff as RawTrivialDiffConfig;
    }
    return {};
  } catch {
    return {};
  }
}

export function readTrivialDiffConfig(memoryRoot: string): TrivialDiffConfig {
  const raw = readRawConfig(memoryRoot);
  return {
    lineCeiling: typeof raw.lineCeiling === 'number' ? raw.lineCeiling : DEFAULT_LINE_CEILING,
    consecutiveSkipCap: typeof raw.consecutiveSkipCap === 'number' ? raw.consecutiveSkipCap : DEFAULT_CONSECUTIVE_SKIP_CAP
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/trivialDiff.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/trivialDiff.ts tests/core/trivialDiff.test.ts
git commit -m "feat: add trivial-diff config reader"
```

---

### Task 2: `trivialDiff.ts` — the decision tree (`isTrivialDiff`)

**Files:**
- Modify: `src/core/trivialDiff.ts`
- Test: `tests/core/trivialDiff.test.ts`

**Interfaces:**
- Consumes: `TrivialDiffConfig` (Task 1). `porcelainPath(line: string): string` from `src/core/gitPorcelain.ts` (existing).
- Produces: `export const MANIFEST_FILES: Set<string>`, `export const LOCKFILE_NAMES: Set<string>`, `export function isTrivialDiff(projectRoot: string, statusLines: string[], config: TrivialDiffConfig): boolean`. `statusLines` are raw `git status --porcelain` lines (2-char status code + space + path), already filtered to exclude `.memoryintel/` paths by the caller.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/trivialDiff.test.ts` (add these imports to the existing import block and add the new `describe` block below the existing one):

```ts
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runGitStatusPorcelain } from '../../src/core/gitPorcelain.js';
import { isTrivialDiff, MANIFEST_FILES, LOCKFILE_NAMES } from '../../src/core/trivialDiff.js';
```

```ts
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
```

(Note: `mkdirSync` import added above is unused by these specific cases and may be omitted if your editor flags it — only add it if a later step needs it. Skip adding it if TypeScript/lint complains about an unused import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/trivialDiff.test.ts`
Expected: FAIL — `isTrivialDiff`, `MANIFEST_FILES`, `LOCKFILE_NAMES` are not exported yet.

- [ ] **Step 3: Implement `isTrivialDiff`**

Append to `src/core/trivialDiff.ts` (add `execFileSync` to a new import line, and `porcelainPath` from gitPorcelain.ts):

```ts
import { execFileSync } from 'node:child_process';
import { porcelainPath } from './gitPorcelain.js';

// Same manifest filenames detectStack() (repoScan.ts) recognizes. A manifest touch is a hard
// veto on triviality — it's exactly what the automatic fact-detection feature (sync, PR #18)
// watches for, so it must always reach a real block. This is the single source of truth for
// that list; claudeCode.ts imports it from here instead of keeping its own copy.
export const MANIFEST_FILES = new Set(['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml']);

export const LOCKFILE_NAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'Pipfile.lock', 'composer.lock', 'Gemfile.lock'
]);

interface ChangedFile {
  path: string;
  code: string;
}

function parseStatusLines(statusLines: string[]): ChangedFile[] {
  return statusLines.map((line) => ({ path: porcelainPath(line), code: line.slice(0, 2) }));
}

// True only when every given file is a tracked modification/rename (never a fresh add or a
// deletion) AND each one's diff against HEAD, ignoring whitespace, is empty. A diff that's
// purely new/untracked or purely deleted files always returns false here — a new or removed
// file is never "just a reformat" — and the caller falls through to the line-count fallback.
function isWhitespaceOnlyDiff(projectRoot: string, files: ChangedFile[]): boolean {
  if (files.length === 0) return false;
  const allModifications = files.every((f) => f.code.includes('M') || f.code.includes('R'));
  if (!allModifications) return false;
  try {
    return files.every((f) => {
      const diff = execFileSync('git', ['diff', 'HEAD', '-w', '--', f.path], {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return diff.trim().length === 0;
    });
  } catch {
    return false;
  }
}

// Sums non-whitespace changed lines across every given (non-lockfile) file. Tracked files
// (modified, renamed, staged-added, or deleted) go through `git diff HEAD --numstat -w`, which
// already reports the right added/deleted counts for all of those cases without special-casing
// deletes or staged adds separately. Only genuinely untracked ('??') files need a manual read,
// since `git diff HEAD` has no HEAD-side content to compare an untracked file against at all.
function countChangedLines(projectRoot: string, files: ChangedFile[]): number {
  let total = 0;
  for (const f of files) {
    if (f.code === '??') {
      const content = readFileSync(join(projectRoot, f.path), 'utf-8');
      total += content.length === 0 ? 0 : content.split('\n').length;
      continue;
    }
    const numstat = execFileSync('git', ['diff', 'HEAD', '--numstat', '-w', '--', f.path], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (numstat.length === 0) continue;
    const [added, deleted] = numstat.split('\t');
    total += (Number(added) || 0) + (Number(deleted) || 0);
  }
  return total;
}

// The ordered, explainable decision tree from docs/superpowers/specs/2026-09-07-check-stop-
// trivial-diff-design.md: manifest touch always vetoes (never trivial); an all-lockfiles diff is
// always trivial; a whitespace-only diff (across every non-lockfile file) is trivial regardless
// of the line ceiling; otherwise, total non-whitespace changed lines (lockfiles excluded) against
// the configured ceiling decides it. Any git command failure fails CLOSED (not trivial) — an
// unclassifiable diff must reach the existing block behavior, not silently skip it.
export function isTrivialDiff(projectRoot: string, statusLines: string[], config: TrivialDiffConfig): boolean {
  const files = parseStatusLines(statusLines);
  if (files.length === 0) return true;

  if (files.some((f) => MANIFEST_FILES.has(f.path))) return false;

  const nonLockfiles = files.filter((f) => !LOCKFILE_NAMES.has(f.path));
  if (nonLockfiles.length === 0) return true;

  if (isWhitespaceOnlyDiff(projectRoot, nonLockfiles)) return true;

  try {
    return countChangedLines(projectRoot, nonLockfiles) <= config.lineCeiling;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/trivialDiff.test.ts`
Expected: PASS (all tests in the file, 4 from Task 1 + 12 from this task)

- [ ] **Step 5: Commit**

```bash
git add src/core/trivialDiff.ts tests/core/trivialDiff.test.ts
git commit -m "feat: add isTrivialDiff decision tree"
```

---

### Task 3: Wire trivial-diff skipping into `runCheckStop`

**Files:**
- Modify: `src/adapters/claudeCode.ts` (entire file — see below)
- Modify: `tests/adapters/claudeCode.test.ts` (entire file — see below)

**Interfaces:**
- Consumes: `MANIFEST_FILES`, `isTrivialDiff`, `readTrivialDiffConfig`, `TrivialDiffConfig` (all from Task 2/`src/core/trivialDiff.ts`); `porcelainPath` (existing, `src/core/gitPorcelain.ts`).
- Produces: `SessionMarker` interface gains `consecutiveTrivialSkips: number`. `runCheckStop`'s public signature is unchanged (`(memoryRoot: string) => { decision?: 'block'; reason?: string }`). `resolveCheckStopMarker`'s public signature is unchanged.

This task both changes existing test fixtures (several current tests write a 1-line diff and
assert a block — under the new default 20-line ceiling that diff would now be classified
trivial and skipped, breaking those tests' original intent of exercising the block/marker
mechanism itself) and adds new tests for the trivial-skip integration.

- [ ] **Step 1: Update existing test fixtures to stay non-trivial, and write the new failing tests**

Replace the entire contents of `tests/adapters/claudeCode.test.ts` with:

```ts
// tests/adapters/claudeCode.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheckStop, resolveCheckStopMarker } from '../../src/adapters/claudeCode.js';

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
    // silencing the nudge even though nothing was ever actually recorded to memory. The fix:
    // HEAD is part of the signature now, so a new commit is itself a "this needs to be resolved"
    // event, not a way to make the nudge go away for free.
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
```

(`existsSync` remains imported for parity with the original file even though no test in this
file currently calls it directly — leave the import as shown; it matches the original file's
import list and avoids an unrelated diff.)

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `npx vitest run tests/adapters/claudeCode.test.ts`
Expected: FAIL — the trivial-diff-skipping tests fail because `runCheckStop` doesn't skip yet (they'll see `decision: 'block'` instead of `{}`, or the marker won't have a `consecutiveTrivialSkips` field). The pre-existing tests (now using `SUBSTANTIAL_CHANGE`) should still PASS unchanged, since today's `runCheckStop` blocks on any diff regardless of size.

- [ ] **Step 3: Rewrite `src/adapters/claudeCode.ts`**

Replace the entire contents of `src/adapters/claudeCode.ts` with:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runGitStatusPorcelain, porcelainPath, runGitRevParseHead } from '../core/gitPorcelain.js';
import { syncDetectedFacts } from '../core/factSync.js';
import { MANIFEST_FILES, isTrivialDiff, readTrivialDiffConfig } from '../core/trivialDiff.js';

interface SessionMarker {
  lastFlaggedDiffSignature: string | null;
  consecutiveTrivialSkips: number;
}

function readMarker(markerPath: string): SessionMarker {
  if (!existsSync(markerPath)) return { lastFlaggedDiffSignature: null, consecutiveTrivialSkips: 0 };
  try {
    const raw = readFileSync(markerPath, 'utf-8').trim();
    if (raw.length === 0) return { lastFlaggedDiffSignature: null, consecutiveTrivialSkips: 0 };
    const parsed = JSON.parse(raw);
    return {
      lastFlaggedDiffSignature: typeof parsed.lastFlaggedDiffSignature === 'string' ? parsed.lastFlaggedDiffSignature : null,
      // Missing on any marker written before the trivial-diff feature shipped — reads as 0 so
      // an old marker file doesn't spuriously start partway toward the consecutive-skip cap.
      consecutiveTrivialSkips: typeof parsed.consecutiveTrivialSkips === 'number' ? parsed.consecutiveTrivialSkips : 0
    };
  } catch {
    return { lastFlaggedDiffSignature: null, consecutiveTrivialSkips: 0 };
  }
}

function writeMarker(markerPath: string, marker: SessionMarker): void {
  writeFileSync(markerPath, JSON.stringify(marker));
}

// Shared by computeDiffSignature and isWorkingTreeDirty (and, below, runCheckStop itself) -
// excludes anything under .memoryintel/ entirely: this module's own marker writes (and
// `update`'s writes to memory files) would otherwise show up as part of the very diff being
// tracked, causing every check to see a "new" signature forever, even with no real code change.
function nonMemoryIntelLines(lines: string[]): string[] {
  return lines.filter((l) => {
    const path = porcelainPath(l);
    return path !== '.memoryintel' && !path.startsWith('.memoryintel/');
  });
}

// Combines the current HEAD commit with the sorted, joined `git status --porcelain` output - a
// stable signature for "what's currently dirty, at what commit" - or null if this isn't a git
// repository / git failed for any reason.
//
// HEAD is part of the signature, not just the working-tree diff: a diff-only signature goes
// back to '' the moment a commit lands, even one this project's own memory never recorded -
// this project's own established workflow is to commit promptly, so a diff-only signature was
// blind to almost every real change by the time anyone would notice. Confirmed on a real
// project (distilled-docs): `.session-marker.json` had never once recorded a flagged diff in
// its whole history, despite real, uncommitted work sitting there unaccounted for, because every
// prior unit of work had already been committed by the time any check-stop would have seen it.
function computeDiffSignature(projectRoot: string): string | null {
  const lines = runGitStatusPorcelain(projectRoot);
  if (lines === null) return null;
  const filtered = nonMemoryIntelLines(lines).sort();
  const head = runGitRevParseHead(projectRoot) ?? '';
  return `${head}\n${filtered.join('\n')}`;
}

function isWorkingTreeDirty(projectRoot: string): boolean {
  const lines = runGitStatusPorcelain(projectRoot);
  if (lines === null) return false;
  return nonMemoryIntelLines(lines).length > 0;
}

const BLOCK_REASON =
  "Working tree has changes memory hasn't accounted for. Classify them, write a TOON update-plan, and run `memoryintel update <plan-file>` (see .memoryintel/instructions.md) before finishing - running `memoryintel update` bare, with no plan file, fails. Or finish again to proceed without updating this time.";

// Claude Code's Stop hook JSON schema only recognizes decision: "block" - there is no "allow"
// value, so the non-blocking cases must return {} (decision omitted), not { decision: 'allow' },
// or Claude Code rejects the hook output outright ("Hook JSON output validation failed").
export function runCheckStop(memoryRoot: string): { decision?: 'block'; reason?: string } {
  const projectRoot = dirname(memoryRoot);
  const markerPath = join(memoryRoot, '.session-marker.json');
  const marker = readMarker(markerPath);

  const signature = computeDiffSignature(projectRoot);
  if (signature === null) return {};

  if (signature === marker.lastFlaggedDiffSignature) {
    return {};
  }

  // A brand-new marker (nothing has ever been flagged or resolved in this project) with a
  // currently-clean working tree has nothing actionable to report - baseline silently so a
  // FUTURE commit or dirty file compares against this starting point, rather than blocking
  // just because this exact HEAD has never been seen before, which would nag on every fresh
  // project's very first Stop event.
  if (marker.lastFlaggedDiffSignature === null && !isWorkingTreeDirty(projectRoot)) {
    writeMarker(markerPath, { lastFlaggedDiffSignature: signature, consecutiveTrivialSkips: 0 });
    return {};
  }

  const statusLines = runGitStatusPorcelain(projectRoot);
  const changedLines = statusLines === null ? [] : nonMemoryIntelLines(statusLines);
  const config = readTrivialDiffConfig(memoryRoot);

  // See docs/superpowers/specs/2026-09-07-check-stop-trivial-diff-design.md. A trivial diff
  // (lockfile-only, whitespace-only, or small) allows immediately instead of blocking - but a
  // consecutive-skip cap forces a real block if trivial diffs keep piling up unnoticed, since
  // that's exactly the failure mode this hook was built to catch.
  if (isTrivialDiff(projectRoot, changedLines, config)) {
    const nextSkips = marker.consecutiveTrivialSkips + 1;
    if (nextSkips < config.consecutiveSkipCap) {
      writeMarker(markerPath, { lastFlaggedDiffSignature: signature, consecutiveTrivialSkips: nextSkips });
      return {};
    }
    writeMarker(markerPath, { lastFlaggedDiffSignature: signature, consecutiveTrivialSkips: 0 });
    return { decision: 'block', reason: BLOCK_REASON };
  }

  writeMarker(markerPath, { lastFlaggedDiffSignature: signature, consecutiveTrivialSkips: 0 });

  let reason = BLOCK_REASON;

  // Mechanism 2 (see docs/superpowers/specs/2026-09-06-automatic-fact-detection-design.md): when
  // the diff touches a manifest file, name specifically what auto-detection just found, so the
  // agent's own follow-up judgment gets a concrete lead instead of only "something changed, go
  // figure out what." This never changes the block/allow decision itself - only the reason text.
  // A manifest touch is always non-trivial (isTrivialDiff's rule 1 veto), so this and the
  // trivial-skip branch above are mutually exclusive by construction.
  const touchesManifest = changedLines.some((l) => MANIFEST_FILES.has(porcelainPath(l)));
  if (touchesManifest) {
    const syncResult = syncDetectedFacts(memoryRoot);
    if (syncResult.written.length > 0) {
      reason += ` Also: a manifest file changed — auto-detected facts were just written to ${syncResult.written.join(', ')}. Worth a note elsewhere (e.g. why it was added) if that's not just incidental.`;
    }
  }

  return { decision: 'block', reason };
}

// Called after a successful `update`. Does NOT simply clear the marker to null — `update` only
// writes to .memoryintel/, so the user's actual source diff that triggered the nudge (e.g. an
// uncommitted src.js) is still sitting there afterward. Clearing to null would make that
// still-present, already-addressed diff look "new" again on the very next check-stop call,
// causing an immediate re-block right after the agent just logged something — the opposite of
// the intended anti-nag behavior. Instead, capture the CURRENT diff signature as the new
// baseline: "this exact situation has now been accounted for." Also resets the consecutive-skip
// counter — a real memory update is exactly the event the cap exists to force, so it always
// clears it.
export function resolveCheckStopMarker(memoryRoot: string): void {
  const markerPath = join(memoryRoot, '.session-marker.json');
  const projectRoot = dirname(memoryRoot);
  const signature = computeDiffSignature(projectRoot);
  writeMarker(markerPath, { lastFlaggedDiffSignature: signature ? signature : null, consecutiveTrivialSkips: 0 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/claudeCode.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full suite to check for regressions elsewhere**

Run: `npm test`
Expected: PASS — in particular, confirm no other test file imported `MANIFEST_FILES` (or anything else) from `claudeCode.ts` expecting the old local definition; it's now re-exported indirectly only via `trivialDiff.ts`, not from `claudeCode.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/claudeCode.ts tests/adapters/claudeCode.test.ts
git commit -m "feat: skip check-stop blocking on trivial diffs, with a consecutive-skip cap backstop"
```

---

## Self-Review Notes

- **Spec coverage:** manifest veto (Task 2, rule 1) — covered. All-lockfiles trivial (Task 2, rule 2) — covered. Whitespace-only trivial (Task 2, rule 3) — covered, including the mixed-with-untracked edge case the spec's prose left implicit (test: "whitespace-only tracked file mixed with a large untracked file is not trivial"). Line-count fallback with lockfile exclusion (Task 2, rule 4) — covered. Fail-closed on git failure — covered by every git-shelling helper's `try { … } catch { return false }` (or the outer `isTrivialDiff` try/catch around `countChangedLines`). Config knobs and their defaults/fallbacks (Task 1) — covered. `.session-marker.json` `consecutiveTrivialSkips`, backward-compat read, cap-forced block + reset, `resolveCheckStopMarker` reset (Task 3) — covered. `MANIFEST_FILES` centralized in `trivialDiff.ts`, `claudeCode.ts` importing rather than redefining (Task 2/3) — covered.
- **Placeholder scan:** none found — every step has real, runnable code and real test assertions.
- **Type consistency:** `TrivialDiffConfig { lineCeiling: number; consecutiveSkipCap: number }` used identically in Task 1 (defined), Task 2 (`isTrivialDiff`'s third parameter), and Task 3 (`readTrivialDiffConfig`'s return value passed straight into `isTrivialDiff`). `SessionMarker` gains `consecutiveTrivialSkips: number` consistently across `readMarker`, `writeMarker` call sites, and `resolveCheckStopMarker` in Task 3 — every `writeMarker` call in the rewritten file supplies both fields.
