# Check-Stop Live-Diff Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inert `.session-marker.json` mechanism (nobody ever wrote the booleans it read) with a live `git status --porcelain` check inside `check-stop`, so the Claude Code Stop-hook nudge actually fires — once per distinct unresolved diff, not once ever per session.

**Architecture:** `runCheckStop` computes its own answer on every call by shelling out to `git status --porcelain` in the project root and comparing a sorted signature of changed files against what was last flagged, persisted in the same `.memoryintel/.session-marker.json` file (now holding one field instead of three). `runUpdate` gets one new call — `clearCheckStopMarker` — so a successful update resolves whatever was pending. `load` is no longer involved in this mechanism at all.

**Tech Stack:** Same as the existing codebase (TypeScript, Node >=18, Vitest). Uses `node:child_process`'s `execFileSync` to call `git` — no new dependency.

**Spec:** `docs/superpowers/specs/2026-08-21-check-stop-live-diff-design.md`

## Global Constraints

- No git repository present, or `git` unavailable, or the command errors for any reason → fail open (`allow`), never block or throw.
- Corrupt/unparseable `.session-marker.json` → treat as `{ lastFlaggedDiffSignature: null }`, never crash.
- `load` must not be modified by this plan — the marker is now owned entirely by `check-stop` (read/write) and `update` (clear-on-success).

---

### Task 1: Live-diff `runCheckStop` + `clearCheckStopMarker`

**Files:**
- Modify: `src/adapters/claudeCode.ts`
- Modify: `tests/adapters/claudeCode.test.ts` (the `runCheckStop` describe block is replaced; `wireClaudeCodeHooks`'s three existing tests are untouched)

**Interfaces:**
- Produces: `runCheckStop(memoryRoot: string): { decision: 'block' | 'allow'; reason?: string }` (same signature as before, new internal behavior), `clearCheckStopMarker(memoryRoot: string): void` — consumed by `runUpdate` in Task 2.

- [ ] **Step 1: Write the failing tests**

Replace the file's `beforeEach` to always leave a real committable file in the fixture (an empty `.memoryintel/` directory alone has nothing for git to track), and replace the entire `runCheckStop` describe block:

```typescript
// tests/adapters/claudeCode.test.ts — replace beforeEach with:
import { execFileSync } from 'node:child_process';

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'mi-cc-'));
  memoryRoot = join(projectRoot, '.memoryintel');
  mkdirSync(memoryRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'README.md'), 'test project\n');
});

// add helpers, alongside the existing imports/beforeEach/afterEach, above the describe blocks:
function initGitRepo(root: string): void {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
}

function commitAll(root: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root });
}

// replace the entire `describe('runCheckStop', ...)` block with:
describe('runCheckStop', () => {
  it('allows the stop when the project is not a git repository (fail open)', () => {
    expect(runCheckStop(memoryRoot)).toEqual({ decision: 'allow' });
  });

  it('allows the stop when the git working tree is clean', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    expect(runCheckStop(memoryRoot)).toEqual({ decision: 'allow' });
  });

  it('blocks once when the working tree has uncommitted changes', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), 'changed');

    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
    expect(result.reason).toMatch(/memoryintel update/);

    const marker = JSON.parse(readFileSync(join(memoryRoot, '.session-marker.json'), 'utf-8'));
    expect(marker.lastFlaggedDiffSignature).toContain('src.ts');
  });

  it('allows on a repeated check for the exact same unresolved diff (no re-nagging)', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), 'changed');

    runCheckStop(memoryRoot);
    const second = runCheckStop(memoryRoot);
    expect(second).toEqual({ decision: 'allow' });
  });

  it('blocks again when the diff changes further after already being flagged', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), 'changed');
    runCheckStop(memoryRoot);

    writeFileSync(join(projectRoot, 'other.ts'), 'also changed');
    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
  });

  it('clears the flagged signature and stops blocking once the tree goes clean', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), 'changed');
    runCheckStop(memoryRoot);

    commitAll(projectRoot, 'resolved');
    const result = runCheckStop(memoryRoot);
    expect(result).toEqual({ decision: 'allow' });

    const marker = JSON.parse(readFileSync(join(memoryRoot, '.session-marker.json'), 'utf-8'));
    expect(marker.lastFlaggedDiffSignature).toBeNull();
  });
});

describe('clearCheckStopMarker', () => {
  it('resets a flagged signature so the same diff gets re-flagged after a resolved update', () => {
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
    writeFileSync(join(projectRoot, 'src.ts'), 'changed');
    runCheckStop(memoryRoot);
    expect(runCheckStop(memoryRoot).decision).toBe('allow');

    clearCheckStopMarker(memoryRoot);
    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');
  });

  it('is safe to call when no marker file exists yet', () => {
    expect(() => clearCheckStopMarker(memoryRoot)).not.toThrow();
  });
});
```

Update the import line at the top of the file to also bring in `clearCheckStopMarker`:

```typescript
import { wireClaudeCodeHooks, runCheckStop, clearCheckStopMarker } from '../../src/adapters/claudeCode.js';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adapters/claudeCode.test.ts`
Expected: FAIL — `clearCheckStopMarker` doesn't exist yet, and the old `runCheckStop` tests' assumptions (marker with `hasChanges`/`nudged` fields) no longer match the new test bodies calling into git.

- [ ] **Step 3: Write the implementation**

Replace everything from `interface SessionMarker` to the end of `src/adapters/claudeCode.ts` (the `wireClaudeCodeHooks` function and everything above it is unchanged):

```typescript
// src/adapters/claudeCode.ts — add this import at the top, alongside the existing ones:
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

// ...wireClaudeCodeHooks and everything above it stays exactly as-is...

// replace from `interface SessionMarker` to the end of the file with:
interface SessionMarker {
  lastFlaggedDiffSignature: string | null;
}

function readMarker(markerPath: string): SessionMarker {
  if (!existsSync(markerPath)) return { lastFlaggedDiffSignature: null };
  try {
    const raw = readFileSync(markerPath, 'utf-8').trim();
    if (raw.length === 0) return { lastFlaggedDiffSignature: null };
    const parsed = JSON.parse(raw);
    return { lastFlaggedDiffSignature: typeof parsed.lastFlaggedDiffSignature === 'string' ? parsed.lastFlaggedDiffSignature : null };
  } catch {
    return { lastFlaggedDiffSignature: null };
  }
}

function writeMarker(markerPath: string, marker: SessionMarker): void {
  writeFileSync(markerPath, JSON.stringify(marker));
}

// Returns the sorted, joined `git status --porcelain` output — a stable signature for "what's
// currently dirty" — or null if this isn't a git repository / git failed for any reason.
function computeDiffSignature(projectRoot: string): string | null {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf-8' });
    const lines = output.split('\n').map((l) => l.trim()).filter(Boolean).sort();
    return lines.join('\n');
  } catch {
    return null;
  }
}

export function runCheckStop(memoryRoot: string): { decision: 'block' | 'allow'; reason?: string } {
  const projectRoot = dirname(memoryRoot);
  const markerPath = join(memoryRoot, '.session-marker.json');
  const marker = readMarker(markerPath);

  const signature = computeDiffSignature(projectRoot);
  if (signature === null) return { decision: 'allow' };

  if (signature === '') {
    if (marker.lastFlaggedDiffSignature !== null) writeMarker(markerPath, { lastFlaggedDiffSignature: null });
    return { decision: 'allow' };
  }

  if (signature === marker.lastFlaggedDiffSignature) {
    return { decision: 'allow' };
  }

  writeMarker(markerPath, { lastFlaggedDiffSignature: signature });
  return {
    decision: 'block',
    reason: "Working tree has changes memory hasn't accounted for. Classify them and run `memoryintel update` before finishing, or finish again to proceed without updating this time."
  };
}

export function clearCheckStopMarker(memoryRoot: string): void {
  const markerPath = join(memoryRoot, '.session-marker.json');
  writeMarker(markerPath, { lastFlaggedDiffSignature: null });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters/claudeCode.test.ts`
Expected: PASS (all `wireClaudeCodeHooks` tests still pass unchanged; all new `runCheckStop`/`clearCheckStopMarker` tests pass)

- [ ] **Step 5: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/claudeCode.ts tests/adapters/claudeCode.test.ts
git commit -m "feat: replace inert session-marker booleans with a live git-diff check-stop nudge"
```

---

### Task 2: Wire `clearCheckStopMarker` into `update`

**Files:**
- Modify: `src/commands/update.ts`
- Modify: `tests/commands/update.test.ts`

**Interfaces:**
- Consumes: `clearCheckStopMarker` (Task 1).

- [ ] **Step 1: Write the failing test**

Read `tests/commands/update.test.ts`'s current top-of-file imports and `beforeEach` before editing — it already creates a fixture `.memoryintel/` at a variable named `root`. Add this test inside the existing `describe('runUpdate', ...)` block (anywhere after the other test cases):

```typescript
// tests/commands/update.test.ts — add near the top, alongside the other imports:
import { clearCheckStopMarker } from '../../src/adapters/claudeCode.js';

// add inside `describe('runUpdate', ...)`:
it('clears any pending check-stop nudge on a successful update', async () => {
  writeFileSync(join(root, '.session-marker.json'), JSON.stringify({ lastFlaggedDiffSignature: 'stale-signature' }));

  const plan = encodeToonTable([
    { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'noted', reason: 'r' }
  ]);
  await runUpdate(root, plan);

  const marker = JSON.parse(readFileSync(join(root, '.session-marker.json'), 'utf-8'));
  expect(marker.lastFlaggedDiffSignature).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/update.test.ts`
Expected: FAIL — the marker still reads `'stale-signature'`, nothing clears it yet.

- [ ] **Step 3: Modify `src/commands/update.ts`**

```typescript
// src/commands/update.ts — add this import alongside the existing ones:
import { clearCheckStopMarker } from '../adapters/claudeCode.js';

// inside the withLock callback, immediately before `return { applied, skipped };`, add:
clearCheckStopMarker(root);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/update.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/update.ts tests/commands/update.test.ts
git commit -m "feat: clear the check-stop nudge marker on a successful update"
```

---

## Self-Review Notes

**Spec coverage:** §2's signature/state/decision logic → Task 1. §2's "resolution clears the marker" → Task 2. §2's "`load` uninvolved" → no task touches `load.ts`, confirmed by grep during self-review. §4's error handling (no git repo, corrupt marker) → both covered by Task 1's `computeDiffSignature`/`readMarker` try/catch paths and their respective tests (fail-open test, and the implicit "missing marker" default already covered by every test that never writes one before the first `runCheckStop` call).

**Type consistency checked:** `runCheckStop`'s external signature (`memoryRoot: string) => { decision: 'block' | 'allow'; reason?: string }`) is unchanged from the pre-existing code Task 2 and `src/cli.ts`'s `check-stop` case already call — no caller needs updating. `clearCheckStopMarker(memoryRoot: string): void` matches its use in Task 2 exactly (`runUpdate` already has `root` in scope, which is a memoryRoot per its own existing signature).

**No placeholders found** on final read-through.
