# `memoryintel doctor` Generated-File Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `memoryintel doctor [--force]` command that refreshes `instructions.md` and the `AGENTS.md`/`GEMINI.md`/`.cursor/rules/memoryintel.mdc` pointer blocks to the current bundled template on an already-initialized project, without ever risking real project memory or a genuine user customization.

**Architecture:** A new `generatedFileHashes` map in `memory-config.json` (seeded by `init` the moment `instructions.md` is freshly written) lets `doctor` tell "untouched since we wrote it" apart from "diverged, don't know why" for `instructions.md`, and refuses to overwrite the latter without `--force`. The pointer block needs no such tracking — its `START_MARKER`/`END_MARKER` fencing already proves ownership, so `doctor` always resyncs it unconditionally.

**Tech Stack:** TypeScript, Node's built-in `node:fs`/`node:crypto`/`node:path` only (this package has zero runtime dependencies - do not add one), Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-08-30-doctor-generated-file-refresh-design.md` (already committed on this same branch, `feature/doctor-generated-file-refresh`)

## Global Constraints

- Zero runtime dependencies - no diff library, no new npm package of any kind.
- `doctor` never reads or writes anything under `context/`, `business/`, `technical/`, `research/`, `memory-index.json`, `memory-events.jsonl`, or `.session-marker.json`.
- `doctor` never inserts a pointer block into a file that doesn't already have one - it only refreshes markers it finds.
- All new file writes on `.memoryintel/`-owned paths use `atomicWriteFile` (`src/core/atomicWrite.ts`) rather than raw `writeFileSync`, matching `update.ts`'s existing convention for mutating this directory. (`genericPointer.ts`'s existing install-time writes are untouched - only new code introduced by this plan uses the atomic helper.)
- Every new/changed test file follows this repo's existing Vitest convention: `mkdtempSync`/`rmSync` for isolation, `describe`/`it`/`expect`.

---

### Task 1: `generatedFileHashes` read/write module

**Files:**
- Create: `src/core/generatedFileHashes.ts`
- Test: `tests/core/generatedFileHashes.test.ts`

**Interfaces:**
- Produces: `hashContent(content: string): string` - sha256 hex digest.
- Produces: `getGeneratedFileHash(root: string, relFile: string): string | undefined` - `root` is the absolute `.memoryintel` directory path (same meaning as everywhere else in this codebase, e.g. `compressionConfig.ts`'s `root` param).
- Produces: `setGeneratedFileHash(root: string, relFile: string, hash: string): void` - read-modify-write of `memory-config.json`, preserving every other existing key.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/generatedFileHashes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashContent, getGeneratedFileHash, setGeneratedFileHash } from '../../src/core/generatedFileHashes.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mi-hashes-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('hashContent', () => {
  it('is deterministic and content-sensitive', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
  });
});

describe('getGeneratedFileHash', () => {
  it('returns undefined when memory-config.json does not exist', () => {
    expect(getGeneratedFileHash(root, 'instructions.md')).toBeUndefined();
  });

  it('returns undefined when the config exists but has no generatedFileHashes key', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ initializedAt: 'x', version: '0.1.0' }));
    expect(getGeneratedFileHash(root, 'instructions.md')).toBeUndefined();
  });

  it('returns undefined on corrupt JSON rather than throwing', () => {
    writeFileSync(join(root, 'memory-config.json'), '{not valid json');
    expect(getGeneratedFileHash(root, 'instructions.md')).toBeUndefined();
  });

  it('returns the recorded hash for the requested file only', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({
      generatedFileHashes: { 'instructions.md': 'abc123' }
    }));
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe('abc123');
    expect(getGeneratedFileHash(root, 'other.md')).toBeUndefined();
  });
});

describe('setGeneratedFileHash', () => {
  it('creates memory-config.json if it does not exist yet', () => {
    setGeneratedFileHash(root, 'instructions.md', 'deadbeef');
    const config = JSON.parse(readFileSync(join(root, 'memory-config.json'), 'utf-8'));
    expect(config.generatedFileHashes['instructions.md']).toBe('deadbeef');
  });

  it('preserves every other existing key in memory-config.json', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({
      initializedAt: '2026-01-01T00:00:00.000Z',
      version: '0.1.0',
      compression: { defaultCeilingLines: 500 }
    }));
    setGeneratedFileHash(root, 'instructions.md', 'deadbeef');
    const config = JSON.parse(readFileSync(join(root, 'memory-config.json'), 'utf-8'));
    expect(config.initializedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(config.compression.defaultCeilingLines).toBe(500);
    expect(config.generatedFileHashes['instructions.md']).toBe('deadbeef');
  });

  it('preserves other files already recorded in generatedFileHashes', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({
      generatedFileHashes: { 'other.md': 'existing-hash' }
    }));
    setGeneratedFileHash(root, 'instructions.md', 'deadbeef');
    const config = JSON.parse(readFileSync(join(root, 'memory-config.json'), 'utf-8'));
    expect(config.generatedFileHashes['other.md']).toBe('existing-hash');
    expect(config.generatedFileHashes['instructions.md']).toBe('deadbeef');
  });

  it('overwrites a previously recorded hash for the same file', () => {
    setGeneratedFileHash(root, 'instructions.md', 'first-hash');
    setGeneratedFileHash(root, 'instructions.md', 'second-hash');
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe('second-hash');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/generatedFileHashes.test.ts`
Expected: FAIL - `Cannot find module '../../src/core/generatedFileHashes.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/generatedFileHashes.ts
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { atomicWriteFile } from './atomicWrite.js';

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function configPath(root: string): string {
  return join(root, 'memory-config.json');
}

// Missing file or corrupt JSON both fall back to an empty object - the same defensive,
// never-throw read pattern compressionConfig.ts already uses for this same file, since neither
// getGeneratedFileHash nor setGeneratedFileHash should ever abort doctor/init over a config
// read problem that isn't this feature's to fix.
function readConfig(root: string): Record<string, unknown> {
  const path = configPath(root);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function getGeneratedFileHash(root: string, relFile: string): string | undefined {
  const hashes = readConfig(root).generatedFileHashes;
  if (hashes && typeof hashes === 'object') {
    const value = (hashes as Record<string, unknown>)[relFile];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

export function setGeneratedFileHash(root: string, relFile: string, hash: string): void {
  const config = readConfig(root);
  const existingHashes =
    config.generatedFileHashes && typeof config.generatedFileHashes === 'object'
      ? (config.generatedFileHashes as Record<string, string>)
      : {};
  config.generatedFileHashes = { ...existingHashes, [relFile]: hash };
  atomicWriteFile(configPath(root), JSON.stringify(config, null, 2) + '\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/generatedFileHashes.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/core/generatedFileHashes.ts tests/core/generatedFileHashes.test.ts
git commit -m "feat: add generatedFileHashes read/write module for doctor's staleness check"
```

---

### Task 2: Seed the hash on fresh `instructions.md` creation in `init`

**Files:**
- Modify: `src/commands/init.ts` (export `INSTRUCTIONS_TEMPLATE`; reorder + extend `runInit`)
- Test: `tests/commands/init.test.ts` (extend)

**Interfaces:**
- Consumes: `hashContent`, `setGeneratedFileHash` from Task 1 (`../core/generatedFileHashes.js`).
- Produces: `export const INSTRUCTIONS_TEMPLATE` (was previously an unexported `const`) - Task 4's `doctor.ts` imports this directly rather than duplicating the template string.

- [ ] **Step 1: Write the failing test**

Add to `tests/commands/init.test.ts` (new `it` block inside the existing `describe('runInit', ...)`; the file already imports `readFileSync`/`join`/`existsSync` from its current header - only the two new imports below need adding):

```typescript
// Add near the top of tests/commands/init.test.ts, alongside the existing imports:
import { getGeneratedFileHash } from '../../src/core/generatedFileHashes.js';
import { createHash } from 'node:crypto';

// Add inside describe('runInit', () => { ... }):
it('seeds generatedFileHashes for instructions.md the moment it is freshly written', () => {
  runInit(dir);
  const root = join(dir, '.memoryintel');
  const instructionsContent = readFileSync(join(root, 'instructions.md'), 'utf-8');
  const expectedHash = createHash('sha256').update(instructionsContent, 'utf-8').digest('hex');
  expect(getGeneratedFileHash(root, 'instructions.md')).toBe(expectedHash);
});

it('does not touch an already-recorded hash when instructions.md already existed', () => {
  runInit(dir);
  const root = join(dir, '.memoryintel');
  // Simulate a project that predates hash-tracking: hand-written config with no
  // generatedFileHashes key, plus an instructions.md already on disk.
  writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ initializedAt: 'x', version: '0.1.0' }));
  runInit(dir); // re-run - instructions.md already exists, so this must be a no-op for hashing too
  expect(getGeneratedFileHash(root, 'instructions.md')).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/commands/init.test.ts`
Expected: FAIL on the first new test - `getGeneratedFileHash(...)` returns `undefined`, not the expected hash (the second new test passes already, since it's asserting today's actual no-op behavior - that's fine, it's here to guard against a future regression once Step 3 changes `runInit`).

- [ ] **Step 3: Write the implementation**

In `src/commands/init.ts`:

```typescript
// Change this line:
const INSTRUCTIONS_TEMPLATE = `# Memory Intel Instructions
// to:
export const INSTRUCTIONS_TEMPLATE = `# Memory Intel Instructions
```

Add an import at the top of the file:

```typescript
import { hashContent, setGeneratedFileHash } from '../core/generatedFileHashes.js';
```

Replace the body of `runInit` (memory-config.json now created before instructions.md, so `setGeneratedFileHash`'s read-modify-write always has the base object to merge into rather than racing to create it from scratch):

```typescript
export function runInit(targetDir: string): void {
  const root = join(targetDir, '.memoryintel');
  mkdirSync(root, { recursive: true });

  ensureFile(join(root, 'memory-config.json'), JSON.stringify({ initializedAt: new Date().toISOString(), version: '0.1.0' }, null, 2) + '\n');

  const instructionsPath = join(root, 'instructions.md');
  const instructionsIsNew = !existsSync(instructionsPath);
  ensureFile(instructionsPath, INSTRUCTIONS_TEMPLATE);
  if (instructionsIsNew) {
    setGeneratedFileHash(root, 'instructions.md', hashContent(INSTRUCTIONS_TEMPLATE));
  }

  ensureFile(join(root, 'memory-index.json'), '{}\n');
  ensureFile(join(root, 'memory-events.jsonl'), '');

  ensureFile(join(root, 'context', 'currentMentalModel.md'), MENTAL_MODEL_STARTER);

  for (const file of STARTER_FILES) {
    const content = file.headings.map((h) => `## ${h}\n`).join('\n');
    ensureFile(join(root, file.relPath), content);
  }

  // No intelligence/*.json scaffolding here: those files back the V2 (semantic retrieval) /
  // V3 (knowledge graph) roadmap items, which stayed permanently dropped (see prd.md's "Future
  // roadmap" section) - `update` has never accepted a write to that path (it's not in
  // WRITABLE_FILES) and nothing else in this codebase reads it. Confirmed dead weight on a real
  // project (distilled-docs): all three files sat at literal `{}` for its entire build. Creating
  // files for a permanently-shelved feature just reads as broken/confusing to find later.

  // Claude Code automation comes from the memoryintel plugin's own hooks/hooks.json (global,
  // active for every project once the plugin is installed) — init never touches .claude/settings.json.
  // The pointer-file adapter still runs here for tools with no plugin-hook equivalent (Cursor,
  // Codex, Gemini CLI, opencode, pi). It touches foreign tools' config files, which this project
  // does not own and cannot assume is well-formed — a failure there must never abort init's own
  // job of scaffolding .memoryintel/. Warn and carry on.
  runAdapter('install pointer-file adapters', () => installPointerAdapters(targetDir));
}
```

(`ensureFile` and `runAdapter` themselves are unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/commands/init.test.ts`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/commands/init.ts tests/commands/init.test.ts
git commit -m "feat: seed instructions.md's generatedFileHash the moment init writes it fresh"
```

---

### Task 3: `refreshPointerBlock` in `genericPointer.ts`

**Files:**
- Modify: `src/adapters/genericPointer.ts`
- Test: `tests/adapters/genericPointer.test.ts` (extend)

**Interfaces:**
- Produces: `export const ADAPTER_FILE_PATHS: string[]` - `['AGENTS.md', 'GEMINI.md', join('.cursor', 'rules', 'memoryintel.mdc')]`, project-root-relative paths, for `doctor.ts` (Task 4) to iterate.
- Produces: `export function refreshPointerBlock(filePath: string): 'refreshed' | 'unchanged' | 'not-installed' | 'missing-file'` - `filePath` is an absolute path.

- [ ] **Step 1: Write the failing tests**

Add to `tests/adapters/genericPointer.test.ts` (extend the existing `import` line to include `refreshPointerBlock`, and add a new `describe` block):

```typescript
// Change the existing import line to:
import { installPointerAdapters, refreshPointerBlock } from '../../src/adapters/genericPointer.js';

// Add a new describe block after the existing describe('installPointerAdapters', ...) block:
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/adapters/genericPointer.test.ts`
Expected: FAIL - `refreshPointerBlock is not a function` / import error

- [ ] **Step 3: Write the implementation**

In `src/adapters/genericPointer.ts`, add after the existing `upsertPointerBlock` function (the `START_MARKER`/`END_MARKER`/`POINTER_BLOCK` constants above it are unchanged and already module-scoped, so the new function can read them directly):

```typescript
export const ADAPTER_FILE_PATHS = ['AGENTS.md', 'GEMINI.md', join('.cursor', 'rules', 'memoryintel.mdc')];

export type PointerBlockRefreshResult = 'refreshed' | 'unchanged' | 'not-installed' | 'missing-file';

// Unlike upsertPointerBlock (install-if-missing, used by init - never overwrites an existing
// block), this always resyncs an EXISTING block to the current POINTER_BLOCK. Safe by
// construction: the markers themselves are the proof this span is machine-owned, regardless of
// what real content surrounds it in the same file. Never installs a block that isn't already
// there - doctor only refreshes, it never adds.
export function refreshPointerBlock(filePath: string): PointerBlockRefreshResult {
  if (!existsSync(filePath)) return 'missing-file';

  const content = readFileSync(filePath, 'utf-8');
  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) return 'not-installed';

  const endOfBlock = endIdx + END_MARKER.length;
  const newContent = `${content.slice(0, startIdx)}${POINTER_BLOCK}${content.slice(endOfBlock)}`;
  if (newContent === content) return 'unchanged';

  writeFileSync(filePath, newContent);
  return 'refreshed';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/adapters/genericPointer.test.ts`
Expected: PASS (all tests in the file, including the 5 new ones)

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/adapters/genericPointer.ts tests/adapters/genericPointer.test.ts
git commit -m "feat: add refreshPointerBlock for unconditional pointer-block resync"
```

---

### Task 4: `runDoctor` command

**Files:**
- Create: `src/commands/doctor.ts`
- Test: `tests/commands/doctor.test.ts`

**Interfaces:**
- Consumes: `INSTRUCTIONS_TEMPLATE` from Task 2 (`./init.js`); `hashContent`, `getGeneratedFileHash`, `setGeneratedFileHash` from Task 1 (`../core/generatedFileHashes.js`); `refreshPointerBlock`, `ADAPTER_FILE_PATHS` from Task 3 (`../adapters/genericPointer.js`); `atomicWriteFile` from `../core/atomicWrite.js`.
- Produces: `export function runDoctor(root: string, options?: { force?: boolean }): string` - `root` is the absolute `.memoryintel` directory path (same convention as `runStatus`). Returns the full plain-text report; Task 5's CLI wiring writes it straight to stdout.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/commands/doctor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/commands/init.js';
import { runDoctor } from '../../src/commands/doctor.js';
import { setGeneratedFileHash, getGeneratedFileHash, hashContent } from '../../src/core/generatedFileHashes.js';
import { INSTRUCTIONS_TEMPLATE } from '../../src/commands/init.js';

let projectDir: string;
let root: string;
beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'mi-doctor-'));
  root = join(projectDir, '.memoryintel');
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

describe('runDoctor - instructions.md', () => {
  it('reports up to date and writes nothing right after a fresh init', () => {
    runInit(projectDir);
    const before = readFileSync(join(root, 'instructions.md'), 'utf-8');
    const report = runDoctor(root);
    expect(report).toContain('instructions.md: up to date');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(before);
  });

  it('safely refreshes when disk matches the recorded hash but the template has moved on', () => {
    runInit(projectDir);
    const staleContent = '# Old instructions\nSome old content.\n';
    writeFileSync(join(root, 'instructions.md'), staleContent);
    setGeneratedFileHash(root, 'instructions.md', hashContent(staleContent));

    const report = runDoctor(root);

    expect(report).toContain('instructions.md: refreshed');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(INSTRUCTIONS_TEMPLATE);
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe(hashContent(INSTRUCTIONS_TEMPLATE));
  });

  it('refuses and writes instructions.md.new when the file diverges with no matching recorded hash', () => {
    runInit(projectDir);
    writeFileSync(join(root, 'instructions.md'), '# Hand-edited\nSomething the user wrote.\n');
    // No setGeneratedFileHash call - simulates either a real hand-edit or a pre-existing
    // project with nothing recorded at all.

    const report = runDoctor(root);

    expect(report).toContain("instructions.md");
    expect(report).toContain('--force');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe('# Hand-edited\nSomething the user wrote.\n');
    expect(existsSync(join(root, 'instructions.md.new'))).toBe(true);
    expect(readFileSync(join(root, 'instructions.md.new'), 'utf-8')).toBe(INSTRUCTIONS_TEMPLATE);
  });

  it('a project with no generatedFileHashes key at all, but content already pristine, reports up to date', () => {
    runInit(projectDir);
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ initializedAt: 'x', version: '0.1.0' }));
    // instructions.md is still exactly INSTRUCTIONS_TEMPLATE from runInit above.

    const report = runDoctor(root);

    expect(report).toContain('instructions.md: up to date');
    expect(existsSync(join(root, 'instructions.md.new'))).toBe(false);
  });

  it('--force overwrites even with no recorded hash and content that genuinely differs', () => {
    runInit(projectDir);
    writeFileSync(join(root, 'instructions.md'), '# Hand-edited\nSomething the user wrote.\n');

    const report = runDoctor(root, { force: true });

    expect(report).toContain('instructions.md: refreshed');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(INSTRUCTIONS_TEMPLATE);
    expect(existsSync(join(root, 'instructions.md.new'))).toBe(false);
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe(hashContent(INSTRUCTIONS_TEMPLATE));
  });

  it('is idempotent: a second run right after a safe refresh reports up to date and writes nothing further', () => {
    runInit(projectDir);
    const staleContent = '# Old\n';
    writeFileSync(join(root, 'instructions.md'), staleContent);
    setGeneratedFileHash(root, 'instructions.md', hashContent(staleContent));

    runDoctor(root);
    const afterFirstRun = readFileSync(join(root, 'instructions.md'), 'utf-8');
    const secondReport = runDoctor(root);

    expect(secondReport).toContain('instructions.md: up to date');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(afterFirstRun);
  });

  it('is idempotent after a forced refresh too: a subsequent plain run reports up to date', () => {
    runInit(projectDir);
    writeFileSync(join(root, 'instructions.md'), '# Hand-edited\n');

    runDoctor(root, { force: true });
    const afterForce = readFileSync(join(root, 'instructions.md'), 'utf-8');
    const secondReport = runDoctor(root); // no --force this time

    expect(secondReport).toContain('instructions.md: up to date');
    expect(readFileSync(join(root, 'instructions.md'), 'utf-8')).toBe(afterForce);
  });
});

describe('runDoctor - pointer blocks', () => {
  it('reports pointer blocks as up to date right after init, with no writes', () => {
    runInit(projectDir);
    const agentsPath = join(projectDir, 'AGENTS.md');
    const before = readFileSync(agentsPath, 'utf-8');

    const report = runDoctor(root);

    expect(report).toContain('AGENTS.md: pointer block up to date.');
    expect(readFileSync(agentsPath, 'utf-8')).toBe(before);
  });

  it('reports a refreshed pointer block and leaves the rest of AGENTS.md untouched', () => {
    runInit(projectDir);
    const agentsPath = join(projectDir, 'AGENTS.md');
    const original = readFileSync(agentsPath, 'utf-8');
    writeFileSync(agentsPath, original.replace('Two hard requirements', 'TAMPERED'));

    const report = runDoctor(root);

    expect(report).toContain('AGENTS.md');
    expect(report).toContain('refreshed');
    expect(readFileSync(agentsPath, 'utf-8')).toBe(original);
  });

  it('does not reinsert a pointer block a user removed entirely', () => {
    runInit(projectDir);
    const agentsPath = join(projectDir, 'AGENTS.md');
    writeFileSync(agentsPath, '# Just my own project notes now\n');

    runDoctor(root);

    expect(readFileSync(agentsPath, 'utf-8')).toBe('# Just my own project notes now\n');
  });

  it('never touches anything under context/, business/, or technical/', () => {
    runInit(projectDir);
    const mentalModelPath = join(root, 'context', 'currentMentalModel.md');
    const before = readFileSync(mentalModelPath, 'utf-8');
    runDoctor(root, { force: true });
    expect(readFileSync(mentalModelPath, 'utf-8')).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/commands/doctor.test.ts`
Expected: FAIL - `Cannot find module '../../src/commands/doctor.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/commands/doctor.ts
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { INSTRUCTIONS_TEMPLATE } from './init.js';
import { hashContent, getGeneratedFileHash, setGeneratedFileHash } from '../core/generatedFileHashes.js';
import { refreshPointerBlock, ADAPTER_FILE_PATHS } from '../adapters/genericPointer.js';
import { atomicWriteFile } from '../core/atomicWrite.js';

export interface DoctorOptions {
  force?: boolean;
}

const INSTRUCTIONS_REL_FILE = 'instructions.md';

function checkInstructions(root: string, options: DoctorOptions): string {
  const instructionsPath = join(root, INSTRUCTIONS_REL_FILE);
  const newFilePath = `${instructionsPath}.new`;

  if (!existsSync(instructionsPath)) {
    return 'instructions.md: missing - run `memoryintel init` to create it.';
  }

  const diskContent = readFileSync(instructionsPath, 'utf-8');
  const diskHash = hashContent(diskContent);
  const templateHash = hashContent(INSTRUCTIONS_TEMPLATE);

  if (diskHash === templateHash) {
    if (existsSync(newFilePath)) unlinkSync(newFilePath);
    // Self-healing: a project with no recorded hash that happens to already be pristine (a
    // fresh init, or content that coincidentally matches) is now provably safe going forward -
    // record it so a future run never has to fall back to the refuse-and-report path for it.
    if (getGeneratedFileHash(root, INSTRUCTIONS_REL_FILE) !== templateHash) {
      setGeneratedFileHash(root, INSTRUCTIONS_REL_FILE, templateHash);
    }
    return 'instructions.md: up to date.';
  }

  const recordedHash = getGeneratedFileHash(root, INSTRUCTIONS_REL_FILE);
  const safeRefresh = recordedHash !== undefined && recordedHash === diskHash;

  if (safeRefresh || options.force) {
    atomicWriteFile(instructionsPath, INSTRUCTIONS_TEMPLATE);
    setGeneratedFileHash(root, INSTRUCTIONS_REL_FILE, templateHash);
    if (existsSync(newFilePath)) unlinkSync(newFilePath);
    return safeRefresh
      ? 'instructions.md: refreshed to the current template.'
      : 'instructions.md: refreshed (forced).';
  }

  atomicWriteFile(newFilePath, INSTRUCTIONS_TEMPLATE);
  return (
    "instructions.md: differs from the current template and its last-known-safe state can't be " +
    "confirmed (either hand-edited, or from before doctor existed). Wrote the current template " +
    "to instructions.md.new for comparison (e.g. `diff .memoryintel/instructions.md " +
    ".memoryintel/instructions.md.new`). Run `memoryintel doctor --force` to adopt it anyway - " +
    "this overwrites instructions.md and removes the .new file."
  );
}

function checkPointerBlocks(projectRoot: string): string[] {
  const lines: string[] = [];
  for (const relPath of ADAPTER_FILE_PATHS) {
    const result = refreshPointerBlock(join(projectRoot, relPath));
    if (result === 'refreshed') lines.push(`${relPath}: pointer block refreshed.`);
    else if (result === 'unchanged') lines.push(`${relPath}: pointer block up to date.`);
    else if (result === 'not-installed') lines.push(`${relPath}: no pointer block found - skipped.`);
    // 'missing-file' is not reported - most projects won't have all three adapter files, and
    // that's not something worth flagging as noise on every doctor run.
  }
  return lines;
}

export function runDoctor(root: string, options: DoctorOptions = {}): string {
  const projectRoot = dirname(root);
  const lines = [checkInstructions(root, options), ...checkPointerBlocks(projectRoot)];
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/commands/doctor.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/commands/doctor.ts tests/commands/doctor.test.ts
git commit -m "feat: add runDoctor command implementing the hash-gated and pointer-block refresh logic"
```

---

### Task 5: Wire `doctor` into the CLI

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli.test.ts` (extend)

**Interfaces:**
- Consumes: `runDoctor` from Task 4 (`./commands/doctor.js`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/cli.test.ts`:

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/commands/init.js';

// Add inside describe('cli dispatch', () => { ... }), alongside the existing tests:
it('documents doctor in the usage text', () => {
  const usage = dispatch([]).stdout;
  expect(usage).toContain('doctor');
});

it('doctor errors cleanly when no .memoryintel/ exists', () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'mi-cli-doctor-empty-'));
  const originalCwd = process.cwd();
  process.chdir(emptyDir);
  try {
    const result = dispatch(['doctor']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No .memoryintel/ found');
  } finally {
    process.chdir(originalCwd);
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

it('doctor reports up to date right after init, and applies --force when passed', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'mi-cli-doctor-'));
  const originalCwd = process.cwd();
  try {
    runInit(projectDir);
    process.chdir(projectDir);
    const result = dispatch(['doctor']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('instructions.md: up to date');

    const forced = dispatch(['doctor', '--force']);
    expect(forced.exitCode).toBe(0);
    expect(forced.stdout).toContain('instructions.md');
  } finally {
    process.chdir(originalCwd);
    rmSync(projectDir, { recursive: true, force: true });
  }
});
```

Update the existing "documents every implemented command" test's command list to include `'doctor'`:

```typescript
// Change:
for (const command of ['init', 'scan', 'import', 'load', 'update', 'status', 'check-stop']) {
// to:
for (const command of ['init', 'scan', 'import', 'load', 'update', 'status', 'check-stop', 'doctor']) {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL - `doctor` case not implemented yet (usage text doesn't mention it, `dispatch(['doctor'])` falls into the `default:` unknown-command branch)

- [ ] **Step 3: Write the implementation**

In `src/cli.ts`, add the import alongside the other command imports near the top:

```typescript
import { runDoctor } from './commands/doctor.js';
```

Add `doctor` to the `USAGE` string, after the `dashboard` line and before the closing backtick:

```typescript
  dashboard <enable|disable>  Turn the shared local dashboard on or off
  doctor [--force]         Refresh memoryintel's own generated files (instructions.md, pointer
                           blocks) to the current template wherever it's provably safe;
                           --force also overwrites instructions.md when it isn't
  daemon start              Run the dashboard daemon in the foreground (usually auto-started)
```

Add a case to the `switch (command)` block in `dispatch()`, alongside the existing `case 'status':` (same shape - resolve root, error if missing, otherwise call the command module and return its output as stdout):

```typescript
    case 'doctor': {
      const root = findMemoryIntelRoot(process.cwd());
      if (!root) return { exitCode: 1, stdout: '', stderr: 'No .memoryintel/ found.\n' };
      const force = argv.includes('--force');
      return { exitCode: 0, stdout: runDoctor(root, { force }), stderr: '' };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS, every test file green (238 existing + the new tests added across Tasks 1-5)

- [ ] **Step 6: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: wire memoryintel doctor into the CLI dispatch and usage text"
```

---

## Post-implementation

Once all five tasks are green, use the `superpowers:finishing-a-development-branch` skill on branch `feature/doctor-generated-file-refresh` (already contains the committed spec from brainstorming, plus this plan file and all five implementation commits) - push it and open a PR against `master`, per this session's established pattern of never merging PRs directly. Do not push to `master` directly.
