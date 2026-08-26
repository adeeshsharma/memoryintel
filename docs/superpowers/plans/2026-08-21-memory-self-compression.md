# Memory Self-Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent compact an oversized `.memoryintel/` content file through the existing
`update()` mechanism, safely (only once the pre-compression version is a real git commit), with
`load()` surfacing which files need it.

**Architecture:** No new CLI command and no new writer primitive. `load()` gains a size check per
file it already reads (line count vs. a configurable ceiling, surfaced in its existing TOON
manifest). `update()` gains one new optional plan-row field (`kind: compress`) that gates that row
on the target file being git-clean before writing it — reusing the same `applySectionUpdate`/
`replace` path every other update already uses.

**Tech Stack:** TypeScript, Node.js built-ins (`node:fs`, `node:child_process`, `node:path`),
Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-memory-self-compression-design.md`

## Global Constraints

- Only `context/currentMentalModel.md`, `context/activeContext.md`, and the technical/business/
  research domain trio are in scope for the ceiling check and compression gate — never
  `memory-events.jsonl`, `memory-index.json`, or `.session-marker.json` (spec §2).
- The git-clean precondition is scoped to exactly the row's target file, not the whole working
  tree, and reuses the porcelain-parsing approach already proven in
  `src/adapters/claudeCode.ts` (fixed-offset slice at position 3, never `.trim()` first).
- If git status cannot be determined at all (not a repo, git unavailable), a `kind: compress` row
  is rejected, not silently allowed — "cannot verify" is not "safe."
- No new CLI command. Compression is expressed as an ordinary update-plan row; `memoryintel
  update` is the only entry point.
- Every new behavior that is pure code (line counting, config lookup, the git-clean gate) gets a
  test. The compaction judgment itself (what to keep vs. cut) is agent reasoning and is
  documented in `instructions.md`, not tested as code (spec §7).

---

## Task 1: Shared git-porcelain helper, extracted from `claudeCode.ts`

**Files:**
- Create: `src/core/gitPorcelain.ts`
- Create: `tests/core/gitPorcelain.test.ts`
- Modify: `src/adapters/claudeCode.ts` (use the new helper instead of its own inline
  `execFileSync` call, preserving identical behavior)

**Interfaces:**
- Produces: `runGitStatusPorcelain(cwd: string): string[] | null`, `porcelainPath(line: string):
  string`, `isPathClean(cwd: string, relPath: string): boolean | null` — all from
  `src/core/gitPorcelain.ts`. Task 3 consumes `isPathClean`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/gitPorcelain.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGitStatusPorcelain, porcelainPath, isPathClean } from '../../src/core/gitPorcelain.js';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/gitPorcelain.test.ts`
Expected: FAIL — `src/core/gitPorcelain.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/gitPorcelain.ts
import { execFileSync } from 'node:child_process';

// Returns the raw, non-empty `git status --porcelain` lines for cwd, in the order git reports
// them, or null if this isn't a git repository / git failed for any reason. Each line keeps its
// fixed two-character status code + space prefix intact — callers must use porcelainPath (a
// fixed-offset slice) rather than trimming first, since trimming shifts that offset differently
// depending on whether the status code itself starts with a space.
export function runGitStatusPorcelain(cwd: string): string[] | null {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.split('\n').filter((l) => l.length > 0);
  } catch {
    return null;
  }
}

export function porcelainPath(line: string): string {
  return line.slice(3);
}

// True if `relPath` (relative to `cwd`, the same way git itself reports paths when invoked with
// that cwd) has no uncommitted changes, false if it does, or null if git status could not be
// determined at all — callers must treat null as "cannot verify", never as clean.
export function isPathClean(cwd: string, relPath: string): boolean | null {
  const lines = runGitStatusPorcelain(cwd);
  if (lines === null) return null;
  return !lines.some((l) => porcelainPath(l) === relPath);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/gitPorcelain.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Refactor `claudeCode.ts` to use the shared helper**

Replace the inline `execFileSync` call in `computeDiffSignature` (in
`src/adapters/claudeCode.ts`) with the new helper, preserving identical filtering/sorting
behavior:

```typescript
// src/adapters/claudeCode.ts — replace the existing computeDiffSignature body and its import line
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runGitStatusPorcelain, porcelainPath } from '../core/gitPorcelain.js';

// ... (SessionMarker, readMarker, writeMarker unchanged) ...

// Returns the sorted, joined `git status --porcelain` output — a stable signature for "what's
// currently dirty" — or null if this isn't a git repository / git failed for any reason.
//
// Excludes anything under .memoryintel/ entirely: this function's own marker writes (and
// `update`'s writes to memory files) would otherwise show up as part of the very diff being
// tracked, causing every check to see a "new" signature forever, even with no real code change.
function computeDiffSignature(projectRoot: string): string | null {
  const lines = runGitStatusPorcelain(projectRoot);
  if (lines === null) return null;

  const filtered = lines
    .filter((l) => {
      const path = porcelainPath(l);
      return path !== '.memoryintel' && !path.startsWith('.memoryintel/');
    })
    .sort();
  return filtered.join('\n');
}
```

Remove the now-unused `execFileSync` import from `src/adapters/claudeCode.ts`.

- [ ] **Step 6: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: All tests pass, including `tests/adapters/claudeCode.test.ts` unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/core/gitPorcelain.ts tests/core/gitPorcelain.test.ts src/adapters/claudeCode.ts
git commit -m "refactor: extract shared git-porcelain helper, add isPathClean"
```

---

## Task 2: Compression ceiling config + `load()` manifest fields

**Files:**
- Create: `src/core/compressionConfig.ts`
- Create: `tests/core/compressionConfig.test.ts`
- Modify: `src/commands/load.ts`
- Modify: `tests/commands/load.test.ts`

**Interfaces:**
- Produces: `DEFAULT_CEILING_LINES: number`, `countLines(content: string): number`,
  `getCeilingLines(root: string, relFile: string): number` — all from
  `src/core/compressionConfig.ts`. Task 3 does not consume these directly; Task 4 (dashboard)
  does.
- `runLoad`'s TOON manifest rows gain three fields: `lines`, `ceiling`, `status` (`'over'` or
  `'under'`), alongside the existing `file`/`headings` fields.

- [ ] **Step 1: Write the failing tests for `compressionConfig.ts`**

```typescript
// tests/core/compressionConfig.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCeilingLines, countLines, DEFAULT_CEILING_LINES } from '../../src/core/compressionConfig.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mi-compconfig-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('countLines', () => {
  it('returns 0 for empty content', () => {
    expect(countLines('')).toBe(0);
  });

  it('counts lines including a trailing blank line from a final newline', () => {
    expect(countLines('a\nb\nc\n')).toBe(4);
  });
});

describe('getCeilingLines', () => {
  it('returns the built-in default when memory-config.json does not exist', () => {
    expect(getCeilingLines(root, 'technical/architecture.md')).toBe(DEFAULT_CEILING_LINES);
  });

  it('returns the built-in default when memory-config.json has no compression key', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ version: '0.1.0' }));
    expect(getCeilingLines(root, 'technical/architecture.md')).toBe(DEFAULT_CEILING_LINES);
  });

  it('returns memory-config.json\'s defaultCeilingLines when set', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingLines: 500 } }));
    expect(getCeilingLines(root, 'technical/architecture.md')).toBe(500);
  });

  it('prefers a domain override over the default', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({
      compression: { defaultCeilingLines: 300, domainOverrides: { technical: 800 } }
    }));
    expect(getCeilingLines(root, 'technical/architecture.md')).toBe(800);
    expect(getCeilingLines(root, 'business/roadmap.md')).toBe(300);
  });

  it('falls back to the built-in default on corrupt JSON rather than throwing', () => {
    writeFileSync(join(root, 'memory-config.json'), '{ not json');
    expect(getCeilingLines(root, 'technical/architecture.md')).toBe(DEFAULT_CEILING_LINES);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/core/compressionConfig.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/compressionConfig.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_CEILING_LINES = 300;

interface CompressionConfig {
  defaultCeilingLines?: number;
  domainOverrides?: Record<string, number>;
}

// Reads memory-config.json's optional `compression` block. Missing file, missing key, or
// corrupt JSON all fall back to an empty config (which getCeilingLines then resolves to the
// built-in default) — this is a read-time convenience for load()/the dashboard, never a place
// that should throw and interrupt them.
function readCompressionConfig(root: string): CompressionConfig {
  const configPath = join(root, 'memory-config.json');
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.compression && typeof parsed.compression === 'object') {
      return parsed.compression as CompressionConfig;
    }
    return {};
  } catch {
    return {};
  }
}

export function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split('\n').length;
}

// relFile's first path segment (e.g. "technical" from "technical/architecture.md", or "context"
// from "context/activeContext.md") is the domain domainOverrides keys against.
export function getCeilingLines(root: string, relFile: string): number {
  const config = readCompressionConfig(root);
  const domain = relFile.split('/')[0];
  const override = config.domainOverrides?.[domain];
  if (typeof override === 'number') return override;
  if (typeof config.defaultCeilingLines === 'number') return config.defaultCeilingLines;
  return DEFAULT_CEILING_LINES;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/core/compressionConfig.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Write the failing test for `load()`'s manifest fields**

Add to `tests/commands/load.test.ts`, inside the existing `describe('runLoad', ...)` block (after
the `'includes a TOON heading manifest for loaded files'` test):

```typescript
  it('flags a file over its compression ceiling in the manifest', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingLines: 2 } }));
    const output = runLoad(base);
    expect(output).toContain('over');
  });

  it('marks a file under its compression ceiling as under', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingLines: 1000 } }));
    const output = runLoad(base);
    expect(output).toContain('under');
    expect(output).not.toContain(',over');
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/commands/load.test.ts`
Expected: FAIL — manifest has no `status` field yet.

- [ ] **Step 7: Implement the manifest fields in `load.ts`**

```typescript
// src/commands/load.ts — full new contents
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { findMemoryIntelRoot } from '../core/discovery.js';
import { extractHeadings } from '../core/headingMatch.js';
import { encodeToonTable } from '../core/toon.js';
import { getCeilingLines, countLines } from '../core/compressionConfig.js';
import { ensureDaemonRunning } from '../daemon/lifecycle.js';
import { upsertRegistryEntry } from '../daemon/registry.js';

const ALWAYS_LOAD = ['context/currentMentalModel.md', 'context/activeContext.md'];

export type Domain = 'technical' | 'business' | 'research';

const DOMAIN_FILES: Record<Domain, string[]> = {
  technical: ['technical/architecture.md', 'technical/techContext.md', 'technical/patterns.md'],
  business: ['business/productContext.md', 'business/roadmap.md', 'business/stakeholders.md'],
  research: ['research/findings.md', 'research/hypotheses.md']
};

export class UnknownDomainError extends Error {
  constructor(public domain: string) {
    super(`Unknown domain "${domain}". Valid domains are: ${Object.keys(DOMAIN_FILES).join(', ')}.`);
    this.name = 'UnknownDomainError';
  }
}

function assertKnownDomain(domain: string): asserts domain is Domain {
  if (!Object.prototype.hasOwnProperty.call(DOMAIN_FILES, domain)) {
    throw new UnknownDomainError(domain);
  }
}

export function runLoad(cwd: string, domain?: string): string {
  // Validate before touching disk so a bad --domain always produces a clear, named error
  // rather than spreading `undefined` out of DOMAIN_FILES.
  if (domain !== undefined) assertKnownDomain(domain);

  const root = findMemoryIntelRoot(cwd);
  if (!root) return '';

  try {
    ensureDaemonRunning();
    upsertRegistryEntry(dirname(root));
  } catch {
    // Dashboard visibility is best-effort — never let it break `load`.
  }

  const files = [...ALWAYS_LOAD, ...(domain ? DOMAIN_FILES[domain as Domain] : [])];
  const sections: string[] = [];
  const manifestRows: Record<string, string>[] = [];

  for (const relFile of files) {
    const absPath = join(root, relFile);
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, 'utf-8');
    const lines = countLines(content);
    const ceiling = getCeilingLines(root, relFile);
    const status = lines > ceiling ? 'over' : 'under';
    sections.push(`--- FILE: ${relFile} ---\n${content}`);
    manifestRows.push({
      file: relFile,
      headings: extractHeadings(content).join('|'),
      lines: String(lines),
      ceiling: String(ceiling),
      status
    });
  }

  const manifest = encodeToonTable(manifestRows);
  return `${manifest}\n${sections.join('\n')}`;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/commands/load.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 9: Run the full suite and commit**

```bash
npm test
git add src/core/compressionConfig.ts tests/core/compressionConfig.test.ts src/commands/load.ts tests/commands/load.test.ts
git commit -m "feat: surface per-file compression ceiling status in load()'s manifest"
```

---

## Task 3: `update()` — `kind: compress` plan rows, gated on git-clean

**Files:**
- Modify: `src/commands/update.ts`
- Modify: `tests/commands/update.test.ts`

**Interfaces:**
- Consumes: `isPathClean(cwd: string, relPath: string): boolean | null` from
  `src/core/gitPorcelain.ts` (Task 1).
- `PlanRow` gains an optional `kind?: string` field. A row with `kind === 'compress'` is gated
  on `isPathClean(dirname(root), '.memoryintel/' + row.file)` before being written; a row with no
  `kind` (or any other value) behaves exactly as before.
- `runUpdate`'s return shape (`{ applied: string[]; skipped: string[] }`) is unchanged — a
  git-rejected compression row counts as `skipped`, same bucket a deduped row already uses.

- [ ] **Step 1: Write the failing tests**

Add a new `beforeEach`/`describe` block to `tests/commands/update.test.ts`. This block needs its
own git-enabled fixture (the existing top-level `beforeEach` fixture is not a git repo), so add it
alongside the existing `describe('runUpdate daemon/registry side effects', ...)` block, using the
same `initGitRepo`/`commitAll` helper pattern already proven in
`tests/adapters/claudeCode.test.ts`:

```typescript
// Add near the top of tests/commands/update.test.ts, alongside the existing imports:
import { execFileSync } from 'node:child_process';

// Add this new describe block at the end of the file, after the existing
// 'runUpdate daemon/registry side effects' block:

describe('runUpdate compression rows', () => {
  let projectRoot: string;
  let compressRoot: string;

  function initGitRepo(dir: string): void {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  }

  function commitAll(dir: string, message: string): void {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'mi-update-compress-'));
    compressRoot = join(projectRoot, '.memoryintel');
    mkdirSync(join(compressRoot, 'technical'), { recursive: true });
    writeFileSync(join(compressRoot, 'technical', 'architecture.md'), '## Overview\nverbose old history\n');
    writeFileSync(join(compressRoot, 'memory-index.json'), '{}');
    writeFileSync(join(compressRoot, 'memory-events.jsonl'), '');
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
  });

  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  it('applies a compress row when the target file is git-clean', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' }
    ]);
    const result = await runUpdate(compressRoot, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);
    expect(readFileSync(join(compressRoot, 'technical', 'architecture.md'), 'utf-8')).toBe('## Overview\ncompact summary\n');
  });

  it('logs an applied compress row with type "compression"', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' }
    ]);
    await runUpdate(compressRoot, plan);
    const events = readFileSync(join(compressRoot, 'memory-events.jsonl'), 'utf-8').trim().split('\n');
    expect(JSON.parse(events[0]).type).toBe('compression');
  });

  it('rejects a compress row when the target file has uncommitted changes', async () => {
    writeFileSync(join(compressRoot, 'technical', 'architecture.md'), '## Overview\nverbose old history\nplus a dirty edit\n');

    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' }
    ]);
    const result = await runUpdate(compressRoot, plan);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['technical/architecture.md']);

    const content = readFileSync(join(compressRoot, 'technical', 'architecture.md'), 'utf-8');
    expect(content).toBe('## Overview\nverbose old history\nplus a dirty edit\n');
  });

  it('logs a rejected compress row with type "compression-rejected" and a clear reason', async () => {
    writeFileSync(join(compressRoot, 'technical', 'architecture.md'), '## Overview\nverbose old history\nplus a dirty edit\n');
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' }
    ]);
    await runUpdate(compressRoot, plan);

    const events = readFileSync(join(compressRoot, 'memory-events.jsonl'), 'utf-8').trim().split('\n');
    const event = JSON.parse(events[0]);
    expect(event.type).toBe('compression-rejected');
    expect(event.summary).toMatch(/uncommitted changes/);
  });

  it('leaves non-compress rows in the same plan unaffected by a dirty target elsewhere', async () => {
    mkdirSync(join(compressRoot, 'context'), { recursive: true });
    writeFileSync(join(compressRoot, 'context', 'currentMentalModel.md'), 'old model\n');
    // architecture.md is dirty relative to git, currentMentalModel.md is not yet tracked at all
    // (also "dirty" from git's perspective, but this plan's row for it is not a compress row).
    writeFileSync(join(compressRoot, 'technical', 'architecture.md'), '## Overview\nverbose old history\nplus a dirty edit\n');

    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' },
      { file: 'context/currentMentalModel.md', action: 'replace', section: '', content: 'new model', reason: 'session summary', kind: '' }
    ]);
    const result = await runUpdate(compressRoot, plan);
    expect(result.skipped).toEqual(['technical/architecture.md']);
    expect(result.applied).toEqual(['context/currentMentalModel.md']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/commands/update.test.ts`
Expected: FAIL — `kind` is not a recognized field yet, and no git-clean gate exists.

- [ ] **Step 3: Implement the gate in `update.ts`**

```typescript
// src/commands/update.ts — full new contents
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { decodeToonTable } from '../core/toon.js';
import { applySectionUpdate, isNearDuplicate, getSectionContent } from '../core/sectionWriter.js';
import { assertSafePath } from '../core/pathSafety.js';
import { upsertIndexEntry } from '../core/memoryIndex.js';
import { appendEvent } from '../core/eventLog.js';
import { atomicWriteFile } from '../core/atomicWrite.js';
import { withLock } from '../core/lock.js';
import { ensureDaemonRunning } from '../daemon/lifecycle.js';
import { upsertRegistryEntry } from '../daemon/registry.js';
import { resolveCheckStopMarker } from '../adapters/claudeCode.js';
import { isPathClean } from '../core/gitPorcelain.js';

interface PlanRow {
  file: string;
  action: 'append' | 'replace' | 'create-section';
  section: string;
  content: string;
  reason: string;
  kind?: string;
}

type EventType = 'memory-update' | 'compression' | 'skipped-duplicate' | 'compression-rejected';

const MENTAL_MODEL_FILE = 'context/currentMentalModel.md';

export async function runUpdate(root: string, planText: string): Promise<{ applied: string[]; skipped: string[] }> {
  try {
    ensureDaemonRunning();
    upsertRegistryEntry(dirname(root));
  } catch {
    // Dashboard visibility is best-effort — never let it break `update`.
  }

  const rows = decodeToonTable(planText) as unknown as PlanRow[];

  return withLock(join(root, '.lock'), () => {
    // Phase 1: validate every entry against current disk state, compute the writes, write nothing yet.
    const writes: { absPath: string; relFile: string; newContent: string; reason: string; skipped: boolean; eventType: EventType }[] = [];

    // Tracks each path's content as computed so far *this call*, so a second row targeting a
    // path already touched by an earlier row builds on that row's result instead of the
    // original on-disk content (which would otherwise silently discard the earlier edit).
    const workingContent = new Map<string, string>();

    for (const row of rows) {
      const absPath = assertSafePath(root, row.file);
      const currentContent = workingContent.has(absPath) ? workingContent.get(absPath)! : readFileSync(absPath, 'utf-8');
      const isCompression = row.kind === 'compress';

      // A compression row rewrites/collapses content whose only durable record, once
      // compressed, is git history — so it may only proceed once the pre-compression version
      // is already a real commit. This check is scoped to this row's own file, never the whole
      // working tree, and treats "cannot determine git status at all" as unsafe, not as clean.
      if (isCompression) {
        const clean = isPathClean(dirname(root), join('.memoryintel', row.file));
        if (clean !== true) {
          const reason = clean === null
            ? `Could not verify git status for ${row.file} — compression skipped this run.`
            : `${row.file} has uncommitted changes — commit the current state before compressing it, then retry.`;
          writes.push({ absPath, relFile: row.file, newContent: currentContent, reason, skipped: true, eventType: 'compression-rejected' });
          continue;
        }
      }

      if (row.file === MENTAL_MODEL_FILE) {
        const skipped = currentContent.trim() === row.content.trim();
        const newContent = skipped ? currentContent : row.content;
        workingContent.set(absPath, newContent);
        writes.push({
          absPath, relFile: row.file, newContent, reason: row.reason, skipped,
          eventType: skipped ? 'skipped-duplicate' : (isCompression ? 'compression' : 'memory-update')
        });
        continue;
      }

      const updated = applySectionUpdate(currentContent, row.section, row.action, row.content);
      const sectionContent = getSectionContent(currentContent, row.section);
      // The duplicate check only makes sense for additive writes. A 'replace' is an explicit,
      // full restatement of the section — narrowing "Uses Postgres 14 and Redis" down to
      // "Uses Postgres 14" must be applied, even though the new text is a substring of the old.
      // ('create-section' that degrades to an append is covered here too; on a genuinely new
      // section there is no existing content, so the check can never fire.)
      const skipped = row.action !== 'replace' && isNearDuplicate(sectionContent ?? '', row.content);
      const newContent = skipped ? currentContent : updated;
      workingContent.set(absPath, newContent);
      writes.push({
        absPath, relFile: row.file, newContent, reason: row.reason, skipped,
        eventType: skipped ? 'skipped-duplicate' : (isCompression ? 'compression' : 'memory-update')
      });
    }

    // Phase 2: apply. Every entry above already validated, so this cannot fail on content grounds.
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const w of writes) {
      if (w.skipped) {
        // A dropped write is still a fact about this session — log it so `status` can show
        // that the agent proposed something and it was deduplicated (or, for compression,
        // rejected) rather than applied (spec §4).
        appendEvent(join(root, 'memory-events.jsonl'), {
          timestamp: new Date().toISOString(),
          type: w.eventType,
          summary: w.reason,
          affectedFiles: [w.relFile]
        });
        skipped.push(w.relFile);
        continue;
      }
      atomicWriteFile(w.absPath, w.newContent);
      upsertIndexEntry(join(root, 'memory-index.json'), w.relFile, w.reason);
      appendEvent(join(root, 'memory-events.jsonl'), {
        timestamp: new Date().toISOString(),
        type: w.eventType,
        summary: w.reason,
        affectedFiles: [w.relFile]
      });
      applied.push(w.relFile);
    }

    resolveCheckStopMarker(root);
    return { applied, skipped };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/commands/update.test.ts`
Expected: PASS (all existing tests plus the 5 new ones)

- [ ] **Step 5: Run the full suite and commit**

```bash
npm test
git add src/commands/update.ts tests/commands/update.test.ts
git commit -m "feat: gate kind=compress update rows on the target file being git-clean"
```

---

## Task 4: Agent guidance, CLI usage note, and dashboard display

**Files:**
- Modify: `src/commands/init.ts` (`INSTRUCTIONS_TEMPLATE`)
- Modify: `tests/commands/init.test.ts`
- Modify: `src/cli.ts` (`USAGE`)
- Modify: `src/daemon/views/projectPage.ts`
- Modify: `tests/daemon/views/projectPage.test.ts` (if this file exists — see Step 5)

**Interfaces:**
- No new exported functions. `renderFileBrowser` (in `projectPage.ts`) reuses
  `getCeilingLines`/`countLines` from Task 2's `src/core/compressionConfig.ts`.

- [ ] **Step 1: Update `INSTRUCTIONS_TEMPLATE` in `init.ts`**

```typescript
// src/commands/init.ts — replace INSTRUCTIONS_TEMPLATE's contents
const INSTRUCTIONS_TEMPLATE = `# Memory Intel Instructions

This project uses Memory Intel. Read this file at the start of every session.

## Session start
Run \`memoryintel load [--domain technical|business|research]\` and treat its output as project context.
Its manifest reports each loaded file's \`lines\`, \`ceiling\`, and \`status\` (\`over\`/\`under\`) — see
"Compaction" below for what to do about a file marked \`over\`.

## Session end
If your work changed project understanding (new architecture, feature, decision, integration, or
roadmap item — not formatting/typos/comments), draft an update-plan (TOON table: file, action,
section, content, reason) and run \`memoryintel update\`. Reuse exact existing heading names from
the manifest \`load\` gave you. If nothing meaningful changed, do nothing — do not call \`update\`.

## Compaction
A file marked \`status: over\` in \`load\`'s manifest has grown past its configured line ceiling.
This is a signal, not a command — compact it only when it's a sensible moment to (the same
judgment you already apply to whether to update at all), by adding a row to your update-plan with
one extra field, \`kind: compress\`, and \`action: replace\` against the section that's grown large.
\`update\` will only apply that row if the target file is currently git-clean — if it isn't, the row
is rejected and the file is left untouched; commit the current state first, then retry. Aim to
compact to comfortably under the ceiling, not exactly at it.

git is the archive: nothing is duplicated into a second file. What you cut is still fully
recoverable from git history — it just won't be loaded by default anymore. Because of that:

- **Keep verbatim, never compress away:** architecture decisions and their rationale, unresolved
  open questions, anything a future session would need to avoid repeating a mistake or
  re-deriving a conclusion already reached.
- **Safe to compress:** resolved narrative ("we tried X, it didn't work, we did Y instead"
  collapses to "Y (not X — see git history for why)"), routine progress entries fully superseded
  by a later one, verbose detail a terser statement of the current state already covers.
- **Rule of thumb:** if a future session would reasonably ask "why is it built this way?" and
  your summary can't answer, you compressed too much — keep more.

The ceiling itself is configurable in \`memory-config.json\` under a \`compression\` key
(\`defaultCeilingLines\`, and optional \`domainOverrides\` keyed by domain, e.g. \`"technical": 500\`)
— the built-in default is 300 lines if unset.

## Dashboard
If the user asks to turn off the dashboard/web UI, run \`memoryintel dashboard disable\`. This is a
single shared dashboard for every Memory Intel project on this machine — tell the user it affects
all of their projects, not just this one. \`memoryintel dashboard enable\` turns it back on.
`;
```

- [ ] **Step 2: Confirm `tests/commands/init.test.ts` needs no change**

Already checked: its one test touching `instructions.md` content (`'only tells agents to run
commands this CLI actually implements'`, around line 49) only asserts substrings
(`toContain('memoryintel load')`, `toContain('memoryintel dashboard disable')`, etc.), all of
which remain present in the new template — no exact-string match to break. No edit needed here;
proceed to Step 3.

- [ ] **Step 3: Run `init` tests to confirm they pass with the new template**

Run: `npx vitest run tests/commands/init.test.ts`
Expected: PASS

- [ ] **Step 4: Add a usage note to `cli.ts`'s `USAGE`**

```typescript
// src/cli.ts — replace the USAGE constant
export const USAGE = `Usage: memoryintel <command> [options]

Commands:
  init [path]              Initialize .memoryintel/ in the current or given directory
  load [--domain <d>]      Print resolved memory context to stdout
  update <plan.toon|->     Apply an update-plan (file path, or - for stdin)
  status                   Print a human-readable summary of current memory state
  check-stop               Stop-hook check: emit a JSON allow/block decision
  dashboard <enable|disable>  Turn the shared local dashboard on or off
  daemon start             Run the dashboard daemon in the foreground (usually auto-started)

An update-plan row may set kind=compress to compact an oversized section; update() only applies
such a row when its target file is currently git-clean.
`;
```

- [ ] **Step 5: Confirm `tests/cli.test.ts` needs no change**

Already checked: `tests/cli.test.ts` only asserts `result.stdout.toContain('Usage: memoryintel')`
in two places — a substring at the very start of `USAGE`, unaffected by the appended note. No
edit needed here; proceed to Step 6.

- [ ] **Step 6: Add `lines/ceiling` to the dashboard's file browser**

```typescript
// src/daemon/views/projectPage.ts — replace renderFileBrowser
import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { WRITABLE_FILES } from '../../core/pathSafety.js';
import { computeFileHealth } from '../health.js';
import { detectToolsWired } from '../registry.js';
import { getCeilingLines, countLines } from '../../core/compressionConfig.js';
import { escapeHtml, pageShell, freshnessTier } from './layout.js';

function renderFileBrowser(memoryRoot: string): string {
  const groups: Record<string, string[]> = {};
  for (const file of WRITABLE_FILES) {
    if (file === 'context/currentMentalModel.md') continue;
    const [domain] = file.split('/');
    (groups[domain] ??= []).push(file);
  }

  const health = computeFileHealth(memoryRoot);
  const healthByFile = Object.fromEntries(health.map((h) => [h.file, h]));

  const sections = Object.entries(groups).map(([domain, files]) => {
    const items = files.map((file) => {
      const path = join(memoryRoot, file);
      const content = existsSync(path) ? readFileSync(path, 'utf-8').trim() : '';
      const staleness = healthByFile[file]?.staleDays;
      const tier = freshnessTier(staleness ?? null);
      const stalenessLabel = staleness === null || staleness === undefined ? 'never updated' : `${staleness}d ago`;
      const lines = countLines(content);
      const ceiling = getCeilingLines(memoryRoot, file);
      const sizeClass = lines > ceiling ? 'stale' : 'muted';
      const sizeLabel = `${lines}/${ceiling} lines`;
      return `<details><summary>${escapeHtml(file)} <span class="muted stale-label ${tier}">(${stalenessLabel})</span> <span class="${sizeClass}">${escapeHtml(sizeLabel)}</span></summary><pre>${escapeHtml(content || '(empty)')}</pre></details>`;
    }).join('\n');
    return `<h3>${escapeHtml(domain)}</h3>\n${items}`;
  });

  return sections.join('\n');
}
```

(The rest of `projectPage.ts` — `renderEventTimeline` and `renderProjectPage` — is unchanged.)

- [ ] **Step 7: Add a test confirming the size label appears**

`tests/daemon/views/projectPage.test.ts` is the only test file touching `renderProjectPage`/
`renderFileBrowser`; already checked, it only asserts substrings (e.g.
`toContain('Microservices.')`), so no existing assertion breaks. Add one new test inside its
existing `describe('renderProjectPage', ...)` block, using that file's existing `projectRoot`
fixture:

```typescript
  it('shows a lines/ceiling size label for a memory file', () => {
    const html = renderProjectPage(projectRoot);
    expect(html).toMatch(/\d+\/\d+ lines/);
  });
```

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 9: Rebuild the generated skill (picks up the new `USAGE` text automatically)**

Run: `npm run build`

- [ ] **Step 10: Commit**

```bash
git add src/commands/init.ts tests/commands/init.test.ts src/cli.ts src/daemon/views/projectPage.ts skills/memory-intel/SKILL.md
git add -A
git commit -m "docs+feat: compaction guidance, USAGE note, dashboard size display"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run the full test suite one more time**

Run: `npm test`
Expected: All tests pass, 0 failures.

- [ ] **Step 2: Run the skill-drift check**

Run: `npm run build:skill:check`
Expected: No drift reported (the skill was already regenerated in Task 4, Step 9).

- [ ] **Step 3: Confirm no stray uncommitted changes remain**

Run: `git status --porcelain`
Expected: Empty output.
