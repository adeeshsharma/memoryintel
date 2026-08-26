# Memory Intel CLI Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `memoryintel` CLI — `init`, `load`, `update`, `status` — plus the Claude Code hook adapter and a generic pointer-file adapter for Cursor/Codex/Gemini/opencode/pi, per the design spec.

**Architecture:** One Node/TS package. Pure-function core modules (heading matching, TOON encode/decode, section writing, path safety) are unit-tested in isolation; command modules wire them together against real fixture directories in integration tests; adapters write tool-native config files. No LLM calls anywhere in this codebase — all "understanding" is the calling agent's job via `instructions.md`.

**Tech Stack:** TypeScript, Node.js (>=18), Vitest for tests, no CLI-arg-parsing library (manual dispatch — only 5 subcommands with few flags, a dependency isn't earned).

**Spec:** `docs/superpowers/specs/2026-08-20-memory-intel-design.md` (this plan implements §2–§7 and the Claude Code + generic-pointer parts of §6; the pi hook-adapter and the entire §8 web dashboard are out of scope for this plan)

## Global Constraints

- On-disk storage format: JSON/JSONL (`memory-config.json`, `memory-index.json`, `memory-events.jsonl`). LLM ↔ CLI boundary format: TOON (`load`/`status`/`update` payloads).
- Section addressing: `##`-level headings only; `###`+ never treated as a boundary.
- `update` is all-or-nothing: validate every entry against current disk state before writing any file.
- `pi` gets the generic pointer-file adapter in this plan, not hook wiring (see spec deviation note above).
- No dependency on claude-mem or context-mode.

---

### Task 1: Project scaffolding + CLI entrypoint

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Produces: a `memoryintel` bin that dispatches `process.argv[2]` to command handlers (later tasks plug into the `switch` in `src/cli.ts`).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "memoryintel",
  "version": "0.1.0",
  "type": "module",
  "bin": { "memoryintel": "./dist/cli.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "engines": { "node": ">=18" },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": false,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
});
```

- [ ] **Step 4: Write the failing test**

```typescript
// tests/cli.test.ts
import { describe, it, expect } from 'vitest';
import { dispatch } from '../src/cli.js';

describe('cli dispatch', () => {
  it('returns a usage message and exit code 1 for an unknown command', () => {
    const result = dispatch(['unknown-command']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Usage: memoryintel');
  });

  it('returns exit code 0 and usage for no command', () => {
    const result = dispatch([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: memoryintel');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm install && npx vitest run tests/cli.test.ts`
Expected: FAIL — `src/cli.ts` does not exist / `dispatch` not exported.

- [ ] **Step 6: Write minimal implementation**

```typescript
// src/cli.ts
export interface DispatchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const USAGE = `Usage: memoryintel <command> [options]

Commands:
  init [path]              Initialize .memoryintel/ in the current or given directory
  load [--domain <d>]      Print resolved memory context to stdout
  update <plan.toon|->     Apply an update-plan (file path, or - for stdin)
  status                   Print a human-readable summary of current memory state
`;

export function dispatch(argv: string[]): DispatchResult {
  const [command] = argv;

  if (!command) {
    return { exitCode: 0, stdout: USAGE, stderr: '' };
  }

  switch (command) {
    default:
      return { exitCode: 1, stdout: USAGE, stderr: `Unknown command: ${command}\n` };
  }
}

// Real process entrypoint — not exercised by unit tests, only by running the built bin.
if (process.argv[1]?.endsWith('cli.js')) {
  const result = dispatch(process.argv.slice(2));
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/cli.ts tests/cli.test.ts
git commit -m "feat: scaffold memoryintel CLI package with command dispatch"
```

---

### Task 2: Discovery engine

**Files:**
- Create: `src/core/discovery.ts`
- Test: `tests/core/discovery.test.ts`

**Interfaces:**
- Produces: `findMemoryIntelRoot(startDir: string): string | null` — used by `load`, `update`, `status` (Tasks 9–11) to locate `.memoryintel/`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/discovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMemoryIntelRoot } from '../../src/core/discovery.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mi-discovery-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('findMemoryIntelRoot', () => {
  it('finds .memoryintel in the starting directory', () => {
    mkdirSync(join(root, '.memoryintel'));
    expect(findMemoryIntelRoot(root)).toBe(join(root, '.memoryintel'));
  });

  it('finds .memoryintel by walking up from a nested subdirectory', () => {
    mkdirSync(join(root, '.memoryintel'));
    const nested = join(root, 'src', 'deep', 'nested');
    mkdirSync(nested, { recursive: true });
    expect(findMemoryIntelRoot(nested)).toBe(join(root, '.memoryintel'));
  });

  it('returns null when no .memoryintel exists anywhere above', () => {
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(findMemoryIntelRoot(nested)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/discovery.ts
import { existsSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';

export function findMemoryIntelRoot(startDir: string): string | null {
  let dir = startDir;
  const { root } = parse(dir);

  while (true) {
    const candidate = join(dir, '.memoryintel');
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/discovery.ts tests/core/discovery.test.ts
git commit -m "feat: add .memoryintel discovery engine"
```

---

### Task 3: Heading-match utilities

**Files:**
- Create: `src/core/headingMatch.ts`
- Test: `tests/core/headingMatch.test.ts`

**Interfaces:**
- Produces: `normalizeHeading(s: string): string`, `extractHeadings(markdown: string): string[]`, `findHeadingMatch(headings: string[], target: string): string | null`, `suggestHeading(headings: string[], target: string): string | null` — consumed by the section writer (Task 5) and the `load`/`status` heading-manifest output (Tasks 10–11).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/headingMatch.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeHeading, extractHeadings, findHeadingMatch, suggestHeading } from '../../src/core/headingMatch.js';

describe('normalizeHeading', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeHeading('  Authentication   Flow  ')).toBe('authentication flow');
  });
});

describe('extractHeadings', () => {
  it('extracts only level-2 headings, ignoring deeper levels', () => {
    const md = `## Overview\nsome text\n### Sub detail\nmore text\n## Components\n`;
    expect(extractHeadings(md)).toEqual(['Overview', 'Components']);
  });

  it('returns an empty array for markdown with no headings', () => {
    expect(extractHeadings('just some prose')).toEqual([]);
  });
});

describe('findHeadingMatch', () => {
  it('matches case-insensitively and ignores whitespace differences', () => {
    const headings = ['Overview', 'Authentication'];
    expect(findHeadingMatch(headings, '  authentication ')).toBe('Authentication');
  });

  it('returns null when no heading matches', () => {
    expect(findHeadingMatch(['Overview'], 'Authentication')).toBeNull();
  });
});

describe('suggestHeading', () => {
  it('suggests the closest existing heading above the similarity threshold', () => {
    expect(suggestHeading(['Authentication', 'Overview'], 'Auth')).toBe('Authentication');
  });

  it('returns null when nothing is close enough', () => {
    expect(suggestHeading(['Overview', 'Roadmap'], 'Zzzqqq')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/headingMatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/headingMatch.ts

export function normalizeHeading(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^##[ \t]+(.+?)\s*$/.exec(line);
    if (match) headings.push(match[1].trim());
  }
  return headings;
}

export function findHeadingMatch(headings: string[], target: string): string | null {
  const normalizedTarget = normalizeHeading(target);
  return headings.find((h) => normalizeHeading(h) === normalizedTarget) ?? null;
}

// Token-overlap similarity: fraction of the smaller token set contained in the larger one,
// plus a prefix-containment bonus so "Auth" vs "Authentication" scores well.
function similarity(a: string, b: string): number {
  const na = normalizeHeading(a);
  const nb = normalizeHeading(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  const tokensA = new Set(na.split(' '));
  const tokensB = new Set(nb.split(' '));
  const [small, large] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return small.size === 0 ? 0 : shared / small.size;
}

const SUGGESTION_THRESHOLD = 0.6;

export function suggestHeading(headings: string[], target: string): string | null {
  let best: { heading: string; score: number } | null = null;
  for (const h of headings) {
    const score = similarity(h, target);
    if (!best || score > best.score) best = { heading: h, score };
  }
  return best && best.score >= SUGGESTION_THRESHOLD ? best.heading : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/headingMatch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/headingMatch.ts tests/core/headingMatch.test.ts
git commit -m "feat: add heading normalization, matching, and fuzzy-suggestion utilities"
```

---

### Task 4: TOON encode/decode utilities

**Files:**
- Create: `src/core/toon.ts`
- Test: `tests/core/toon.test.ts`

**Interfaces:**
- Produces: `encodeToonTable(rows: Record<string, string>[]): string`, `decodeToonTable(text: string): Record<string, string>[]` — consumed by `update` (Task 9, decoding the incoming plan) and `load`/`status` (Tasks 10–11, encoding the heading manifest).

Scope note: this is a minimal, self-contained tabular TOON-style encoder for our one fixed shape (uniform arrays of flat string-keyed objects) — not a general TOON implementation. Header row declares field names once; each subsequent line is one comma-separated row. Deliberately avoids taking on an external, unverified dependency for a format this narrow.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/toon.test.ts
import { describe, it, expect } from 'vitest';
import { encodeToonTable, decodeToonTable } from '../../src/core/toon.js';

describe('encodeToonTable / decodeToonTable', () => {
  it('round-trips a simple table', () => {
    const rows = [
      { file: 'architecture.md', action: 'append', section: 'Authentication', content: 'JWT refresh added', reason: 'new auth flow' },
      { file: 'progress.md', action: 'replace', section: 'Status', content: '70% complete', reason: 'progress update' }
    ];
    const encoded = encodeToonTable(rows);
    expect(decodeToonTable(encoded)).toEqual(rows);
  });

  it('handles fields containing commas by quoting them', () => {
    const rows = [{ file: 'a.md', action: 'append', section: 'X', content: 'has, a comma', reason: 'r' }];
    const decoded = decodeToonTable(encodeToonTable(rows));
    expect(decoded).toEqual(rows);
  });

  it('decodes an empty table to an empty array', () => {
    expect(decodeToonTable(encodeToonTable([]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/toon.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/toon.ts

function quoteField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function encodeToonTable(rows: Record<string, string>[]): string {
  if (rows.length === 0) return `items[0]{}:\n`;

  const fields = Object.keys(rows[0]);
  const header = `items[${rows.length}]{${fields.join(',')}}:`;
  const lines = rows.map((row) => '  ' + fields.map((f) => quoteField(row[f] ?? '')).join(','));
  return [header, ...lines].join('\n') + '\n';
}

export function decodeToonTable(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((l) => l.length > 0);
  const headerLine = lines[0];
  const headerMatch = /^items\[(\d+)\]\{(.*)\}:$/.exec(headerLine ?? '');
  if (!headerMatch) throw new Error(`Malformed TOON table header: ${headerLine}`);

  const count = Number(headerMatch[1]);
  const fields = headerMatch[2].length > 0 ? headerMatch[2].split(',') : [];
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < count; i++) {
    const rawLine = lines[i + 1];
    if (rawLine === undefined) throw new Error(`Expected ${count} rows, found ${i}`);
    const values = splitCsvLine(rawLine.trim());
    const row: Record<string, string> = {};
    fields.forEach((f, idx) => { row[f] = values[idx] ?? ''; });
    rows.push(row);
  }

  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/toon.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/toon.ts tests/core/toon.test.ts
git commit -m "feat: add minimal TOON table encode/decode for the update-plan boundary"
```

---

### Task 5: Section writer (append / replace / create-section + dedup)

**Files:**
- Create: `src/core/sectionWriter.ts`
- Test: `tests/core/sectionWriter.test.ts`

**Interfaces:**
- Consumes: `extractHeadings`, `findHeadingMatch`, `suggestHeading`, `normalizeHeading` from `src/core/headingMatch.ts` (Task 3).
- Produces: `applySectionUpdate(markdown: string, section: string, action: SectionAction, content: string): string`, `SectionRejectedError`, `isNearDuplicate(existingBlock: string, newContent: string): boolean` — consumed by `update` (Task 9).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/sectionWriter.test.ts
import { describe, it, expect } from 'vitest';
import { applySectionUpdate, isNearDuplicate, SectionRejectedError } from '../../src/core/sectionWriter.js';

describe('applySectionUpdate', () => {
  it('appends content to the end of an existing section, before the next heading', () => {
    const md = `## Overview\nold line\n## Components\nother\n`;
    const result = applySectionUpdate(md, 'Overview', 'append', 'new line');
    expect(result).toBe(`## Overview\nold line\nnew line\n## Components\nother\n`);
  });

  it('replaces the entire content of an existing section', () => {
    const md = `## Status\nold status\n## Next\nplan\n`;
    const result = applySectionUpdate(md, 'Status', 'replace', 'new status');
    expect(result).toBe(`## Status\nnew status\n## Next\nplan\n`);
  });

  it('creates a new heading at the end of the file when action is create-section', () => {
    const md = `## Overview\nold line\n`;
    const result = applySectionUpdate(md, 'Risks', 'create-section', 'a new risk');
    expect(result).toBe(`## Overview\nold line\n## Risks\na new risk\n`);
  });

  it('degrades create-section to append when the (normalized) heading already exists', () => {
    const md = `## Overview\nold line\n`;
    const result = applySectionUpdate(md, '  overview ', 'create-section', 'more');
    expect(result).toBe(`## Overview\nold line\nmore\n`);
  });

  it('never lets a deeper heading (###) be treated as a section boundary', () => {
    const md = `## Overview\nintro\n### Detail\ndetail text\nmore intro\n## Next\n`;
    const result = applySectionUpdate(md, 'Overview', 'append', 'appended');
    expect(result).toBe(`## Overview\nintro\n### Detail\ndetail text\nmore intro\nappended\n## Next\n`);
  });

  it('rejects append when the target section does not exist, with a suggestion', () => {
    const md = `## Authentication\ntext\n`;
    expect(() => applySectionUpdate(md, 'Auth', 'append', 'x')).toThrow(SectionRejectedError);
    try {
      applySectionUpdate(md, 'Auth', 'append', 'x');
    } catch (e) {
      expect((e as SectionRejectedError).suggestion).toBe('Authentication');
    }
  });

  it('rejects replace when the target section does not exist', () => {
    const md = `## Overview\ntext\n`;
    expect(() => applySectionUpdate(md, 'Nonexistent Thing', 'replace', 'x')).toThrow(SectionRejectedError);
  });
});

describe('isNearDuplicate', () => {
  it('treats whitespace-only differences as duplicates', () => {
    expect(isNearDuplicate('some text here', '  some   text here  ')).toBe(true);
  });

  it('treats substantively different content as not duplicate', () => {
    expect(isNearDuplicate('the old status', 'a completely different update')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/sectionWriter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/sectionWriter.ts
import { extractHeadings, findHeadingMatch, suggestHeading, normalizeHeading } from './headingMatch.js';

export type SectionAction = 'append' | 'replace' | 'create-section';

export class SectionRejectedError extends Error {
  constructor(public section: string, public suggestion: string | null) {
    super(
      suggestion
        ? `Section "${section}" not found. Did you mean "${suggestion}"?`
        : `Section "${section}" not found and no similar heading exists.`
    );
  }
}

// Returns [startLine, endLine) of the section's content, and [headingLine] index.
function findSectionBounds(lines: string[], headingText: string): { headingLine: number; contentStart: number; contentEnd: number } | null {
  const target = normalizeHeading(headingText);
  for (let i = 0; i < lines.length; i++) {
    const match = /^##[ \t]+(.+?)\s*$/.exec(lines[i]);
    if (match && normalizeHeading(match[1].trim()) === target) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^##[ \t]+.+/.test(lines[j])) { end = j; break; }
      }
      return { headingLine: i, contentStart: i + 1, contentEnd: end };
    }
  }
  return null;
}

export function applySectionUpdate(markdown: string, section: string, action: SectionAction, content: string): string {
  const lines = markdown.split('\n');
  const headings = extractHeadings(markdown);
  const existingHeading = findHeadingMatch(headings, section);

  if (action === 'create-section' && !existingHeading) {
    const needsTrailingNewline = lines.length > 0 && lines[lines.length - 1] !== '';
    const prefix = needsTrailingNewline ? lines.join('\n') + '\n' : lines.join('\n');
    return `${prefix}## ${section}\n${content}\n`;
  }

  // create-section on an existing heading degrades to append; append/replace require an existing match.
  if (!existingHeading) {
    const suggestion = suggestHeading(headings, section);
    throw new SectionRejectedError(section, suggestion);
  }

  const bounds = findSectionBounds(lines, existingHeading)!;
  const before = lines.slice(0, bounds.contentStart);
  const existingContentLines = lines.slice(bounds.contentStart, bounds.contentEnd);
  const after = lines.slice(bounds.contentEnd);

  const newContentLines = action === 'replace'
    ? [content]
    : [...existingContentLines.filter((l) => l !== ''), content];

  return [...before, ...newContentLines, ...after].join('\n');
}

export function isNearDuplicate(existingBlock: string, newContent: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalize(existingBlock).includes(normalize(newContent));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/sectionWriter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/sectionWriter.ts tests/core/sectionWriter.test.ts
git commit -m "feat: add deterministic markdown section writer with drift-resistant addressing"
```

---

### Task 6: Path safety validator

**Files:**
- Create: `src/core/pathSafety.ts`
- Test: `tests/core/pathSafety.test.ts`

**Interfaces:**
- Produces: `assertSafePath(root: string, relFile: string): string`, `UnsafePathError`, `WRITABLE_FILES: readonly string[]` — consumed by `update` (Task 9).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/pathSafety.test.ts
import { describe, it, expect } from 'vitest';
import { assertSafePath, UnsafePathError, WRITABLE_FILES } from '../../src/core/pathSafety.js';
import { join } from 'node:path';

describe('assertSafePath', () => {
  const root = '/tmp/fake-root/.memoryintel';

  it('accepts every file in WRITABLE_FILES', () => {
    for (const file of WRITABLE_FILES) {
      expect(assertSafePath(root, file)).toBe(join(root, file));
    }
  });

  it('rejects a path outside the known writable set', () => {
    expect(() => assertSafePath(root, 'intelligence/entities.json')).toThrow(UnsafePathError);
  });

  it('rejects path traversal attempts', () => {
    expect(() => assertSafePath(root, '../../etc/passwd')).toThrow(UnsafePathError);
  });

  it('rejects absolute paths', () => {
    expect(() => assertSafePath(root, '/etc/passwd')).toThrow(UnsafePathError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/pathSafety.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/pathSafety.ts
import { join, resolve, isAbsolute } from 'node:path';

export const WRITABLE_FILES = [
  'context/projectBrief.md',
  'context/objectives.md',
  'context/activeContext.md',
  'context/decisions.md',
  'context/progress.md',
  'context/learnings.md',
  'context/currentMentalModel.md',
  'technical/architecture.md',
  'technical/techContext.md',
  'technical/patterns.md',
  'technical/integrations.md',
  'technical/infrastructure.md',
  'business/productContext.md',
  'business/roadmap.md',
  'business/stakeholders.md',
  'business/marketContext.md',
  'research/findings.md',
  'research/references.md',
  'research/hypotheses.md'
] as const;

export class UnsafePathError extends Error {
  constructor(relFile: string) {
    super(`"${relFile}" is not a recognized Memory Intel file and cannot be written.`);
  }
}

export function assertSafePath(root: string, relFile: string): string {
  if (isAbsolute(relFile) || !(WRITABLE_FILES as readonly string[]).includes(relFile)) {
    throw new UnsafePathError(relFile);
  }

  const resolved = resolve(root, relFile);
  const resolvedRoot = resolve(root);
  if (!resolved.startsWith(resolvedRoot + '/')) {
    throw new UnsafePathError(relFile);
  }

  return join(root, relFile);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/pathSafety.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/pathSafety.ts tests/core/pathSafety.test.ts
git commit -m "feat: add path-safety validator restricting update targets to known files"
```

---

### Task 7: Index and event log helpers

**Files:**
- Create: `src/core/memoryIndex.ts`
- Create: `src/core/eventLog.ts`
- Test: `tests/core/memoryIndex.test.ts`
- Test: `tests/core/eventLog.test.ts`

**Interfaces:**
- Produces: `upsertIndexEntry(indexPath: string, file: string, summary: string): void`, `readIndex(indexPath: string): Record<string, { lastUpdated: string; summary: string }>`, `appendEvent(eventsPath: string, event: MemoryEvent): void`, `type MemoryEvent = { timestamp: string; type: string; summary: string; affectedFiles: string[] }` — consumed by `update` (Task 9) and `status` (Task 11).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/memoryIndex.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertIndexEntry, readIndex } from '../../src/core/memoryIndex.js';

let dir: string;
let indexPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-index-'));
  indexPath = join(dir, 'memory-index.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('upsertIndexEntry / readIndex', () => {
  it('creates the index file if missing and adds an entry', () => {
    upsertIndexEntry(indexPath, 'technical/architecture.md', 'JWT refresh introduced');
    const index = readIndex(indexPath);
    expect(index['technical/architecture.md'].summary).toBe('JWT refresh introduced');
    expect(typeof index['technical/architecture.md'].lastUpdated).toBe('string');
  });

  it('overwrites an existing entry for the same file', () => {
    upsertIndexEntry(indexPath, 'technical/architecture.md', 'first');
    upsertIndexEntry(indexPath, 'technical/architecture.md', 'second');
    const index = readIndex(indexPath);
    expect(Object.keys(index).length).toBe(1);
    expect(index['technical/architecture.md'].summary).toBe('second');
  });
});
```

```typescript
// tests/core/eventLog.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent } from '../../src/core/eventLog.js';

let dir: string;
let eventsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-events-'));
  eventsPath = join(dir, 'memory-events.jsonl');
  writeFileSync(eventsPath, '');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('appendEvent', () => {
  it('appends one JSON line per call', () => {
    appendEvent(eventsPath, { timestamp: '2026-08-20T10:00:00Z', type: 'architecture-change', summary: 'JWT refresh introduced', affectedFiles: ['technical/architecture.md'] });
    appendEvent(eventsPath, { timestamp: '2026-08-20T10:05:00Z', type: 'progress-update', summary: 'Milestone hit', affectedFiles: ['context/progress.md'] });

    const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe('architecture-change');
    expect(JSON.parse(lines[1]).summary).toBe('Milestone hit');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/memoryIndex.test.ts tests/core/eventLog.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/memoryIndex.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface IndexEntry {
  lastUpdated: string;
  summary: string;
}

export function readIndex(indexPath: string): Record<string, IndexEntry> {
  if (!existsSync(indexPath)) return {};
  const raw = readFileSync(indexPath, 'utf-8').trim();
  return raw.length === 0 ? {} : JSON.parse(raw);
}

export function upsertIndexEntry(indexPath: string, file: string, summary: string): void {
  const index = readIndex(indexPath);
  index[file] = { lastUpdated: new Date().toISOString(), summary };
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
}
```

```typescript
// src/core/eventLog.ts
import { appendFileSync } from 'node:fs';

export interface MemoryEvent {
  timestamp: string;
  type: string;
  summary: string;
  affectedFiles: string[];
}

export function appendEvent(eventsPath: string, event: MemoryEvent): void {
  appendFileSync(eventsPath, JSON.stringify(event) + '\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/memoryIndex.test.ts tests/core/eventLog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/memoryIndex.ts src/core/eventLog.ts tests/core/memoryIndex.test.ts tests/core/eventLog.test.ts
git commit -m "feat: add memory-index and event-log persistence helpers"
```

---

### Task 8: Atomic write and update lock

**Files:**
- Create: `src/core/atomicWrite.ts`
- Create: `src/core/lock.ts`
- Test: `tests/core/atomicWrite.test.ts`
- Test: `tests/core/lock.test.ts`

**Interfaces:**
- Produces: `atomicWriteFile(path: string, content: string): void`, `withLock<T>(lockPath: string, fn: () => Promise<T> | T, opts?: { retries?: number; delayMs?: number }): Promise<T>` — consumed by `update` (Task 9).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/atomicWrite.test.ts
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
```

```typescript
// tests/core/lock.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLock } from '../../src/core/lock.js';

let dir: string;
let lockPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-lock-'));
  lockPath = join(dir, '.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('withLock', () => {
  it('runs the function and releases the lock afterward', async () => {
    const result = await withLock(lockPath, () => 42);
    expect(result).toBe(42);
    // Lock released — a second call should succeed immediately.
    const second = await withLock(lockPath, () => 43);
    expect(second).toBe(43);
  });

  it('serializes two concurrent calls instead of racing', async () => {
    const order: string[] = [];
    const first = withLock(lockPath, async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('first-end');
    });
    // Give `first` a moment to acquire the lock before `second` tries.
    await new Promise((r) => setTimeout(r, 5));
    const second = withLock(lockPath, () => { order.push('second-start'); });

    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('releases the lock even if the function throws', async () => {
    await expect(withLock(lockPath, () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await withLock(lockPath, () => 'recovered');
    expect(result).toBe('recovered');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/atomicWrite.test.ts tests/core/lock.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/core/atomicWrite.ts
import { writeFileSync, renameSync } from 'node:fs';

export function atomicWriteFile(path: string, content: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, content);
  renameSync(tempPath, path);
}
```

```typescript
// src/core/lock.ts
import { openSync, closeSync, unlinkSync, constants } from 'node:fs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T> | T,
  opts: { retries?: number; delayMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 100;
  const delayMs = opts.delayMs ?? 20;

  let fd: number | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      break;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      if (attempt === retries) throw new Error(`Timed out waiting for lock: ${lockPath}`);
      await sleep(delayMs);
    }
  }

  try {
    return await fn();
  } finally {
    if (fd !== null) closeSync(fd);
    unlinkSync(lockPath);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/atomicWrite.test.ts tests/core/lock.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/atomicWrite.ts src/core/lock.ts tests/core/atomicWrite.test.ts tests/core/lock.test.ts
git commit -m "feat: add atomic file writes and a retrying file-based update lock"
```

---

### Task 9: `update` command

**Files:**
- Create: `src/commands/update.ts`
- Modify: `src/cli.ts` (wire the `update` case into `dispatch`)
- Test: `tests/commands/update.test.ts`

**Interfaces:**
- Consumes: `decodeToonTable` (Task 4), `applySectionUpdate`, `SectionRejectedError`, `isNearDuplicate` (Task 5), `assertSafePath`, `UnsafePathError` (Task 6), `upsertIndexEntry` (Task 7), `appendEvent` (Task 7), `atomicWriteFile` (Task 8), `withLock` (Task 8).
- Produces: `runUpdate(root: string, planText: string): Promise<{ applied: string[]; skipped: string[] }>` — throws `Error` (with a human-readable message, including any `SectionRejectedError`/`UnsafePathError` message) on any invalid entry, without writing anything. Consumed by `src/cli.ts`'s dispatch and by Task 15's end-to-end test.

Each plan row (after TOON decode) has fields: `file`, `action` (`append`|`replace`|`create-section`), `section` (ignored for `currentMentalModel.md`), `content`, `reason`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/commands/update.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUpdate } from '../../src/commands/update.js';
import { encodeToonTable } from '../../src/core/toon.js';

let root: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'mi-update-'));
  root = join(base, '.memoryintel');
  mkdirSync(join(root, 'technical'), { recursive: true });
  mkdirSync(join(root, 'context'), { recursive: true });
  writeFileSync(join(root, 'technical', 'architecture.md'), '## Overview\nintro\n');
  writeFileSync(join(root, 'context', 'currentMentalModel.md'), 'old mental model\n');
  writeFileSync(join(root, 'memory-index.json'), '{}');
  writeFileSync(join(root, 'memory-events.jsonl'), '');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('runUpdate', () => {
  it('applies a valid single-entry plan and logs an event', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'JWT refresh added', reason: 'new auth flow' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);

    const content = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    expect(content).toContain('JWT refresh added');

    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n');
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]).summary).toBe('new auth flow');
  });

  it('fully overwrites currentMentalModel.md regardless of action/section', async () => {
    const plan = encodeToonTable([
      { file: 'context/currentMentalModel.md', action: 'replace', section: '', content: 'brand new mental model', reason: 'session summary' }
    ]);
    await runUpdate(root, plan);
    expect(readFileSync(join(root, 'context', 'currentMentalModel.md'), 'utf-8')).toBe('brand new mental model');
  });

  it('rejects the whole plan and writes nothing when one entry targets a missing section', async () => {
    const before = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'ok entry', reason: 'r1' },
      { file: 'technical/architecture.md', action: 'append', section: 'Nonexistent', content: 'bad entry', reason: 'r2' }
    ]);
    await expect(runUpdate(root, plan)).rejects.toThrow(/not found/);
    expect(readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8')).toBe(before);
  });

  it('rejects a plan targeting a path outside the writable set', async () => {
    const plan = encodeToonTable([
      { file: 'intelligence/entities.json', action: 'append', section: 'x', content: 'y', reason: 'r' }
    ]);
    await expect(runUpdate(root, plan)).rejects.toThrow(/not a recognized/);
  });

  it('skips writing content that is a near-duplicate of what is already there', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'intro', reason: 'no-op' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['technical/architecture.md']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/update.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/commands/update.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeToonTable } from '../core/toon.js';
import { applySectionUpdate, isNearDuplicate } from '../core/sectionWriter.js';
import { assertSafePath } from '../core/pathSafety.js';
import { upsertIndexEntry } from '../core/memoryIndex.js';
import { appendEvent } from '../core/eventLog.js';
import { atomicWriteFile } from '../core/atomicWrite.js';
import { withLock } from '../core/lock.js';

interface PlanRow {
  file: string;
  action: 'append' | 'replace' | 'create-section';
  section: string;
  content: string;
  reason: string;
}

const MENTAL_MODEL_FILE = 'context/currentMentalModel.md';

export async function runUpdate(root: string, planText: string): Promise<{ applied: string[]; skipped: string[] }> {
  const rows = decodeToonTable(planText) as unknown as PlanRow[];

  return withLock(join(root, '.lock'), () => {
    // Phase 1: validate every entry against current disk state, compute the writes, write nothing yet.
    const writes: { absPath: string; relFile: string; newContent: string; reason: string; skipped: boolean }[] = [];

    for (const row of rows) {
      const absPath = assertSafePath(root, row.file);
      const currentContent = readFileSync(absPath, 'utf-8');

      if (row.file === MENTAL_MODEL_FILE) {
        writes.push({ absPath, relFile: row.file, newContent: row.content, reason: row.reason, skipped: currentContent.trim() === row.content.trim() });
        continue;
      }

      const updated = applySectionUpdate(currentContent, row.section, row.action, row.content);
      const skipped = isNearDuplicate(currentContent, row.content);
      writes.push({ absPath, relFile: row.file, newContent: skipped ? currentContent : updated, reason: row.reason, skipped });
    }

    // Phase 2: apply. Every entry above already validated, so this cannot fail on content grounds.
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const w of writes) {
      if (w.skipped) {
        skipped.push(w.relFile);
        continue;
      }
      atomicWriteFile(w.absPath, w.newContent);
      upsertIndexEntry(join(root, 'memory-index.json'), w.relFile, w.reason);
      appendEvent(join(root, 'memory-events.jsonl'), {
        timestamp: new Date().toISOString(),
        type: 'memory-update',
        summary: w.reason,
        affectedFiles: [w.relFile]
      });
      applied.push(w.relFile);
    }

    return { applied, skipped };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/update.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `src/cli.ts`**

```typescript
// src/cli.ts — add near the top:
import { readFileSync } from 'node:fs';
import { findMemoryIntelRoot } from './core/discovery.js';
import { runUpdate } from './commands/update.js';

// inside dispatch(), replace the `default:` case's switch with:
switch (command) {
  case 'update': {
    const root = findMemoryIntelRoot(process.cwd());
    if (!root) return { exitCode: 1, stdout: '', stderr: 'No .memoryintel/ found.\n' };

    const source = argv[1] ?? '-';
    const planText = source === '-' ? readFileSync(0, 'utf-8') : readFileSync(source, 'utf-8');

    // Note: dispatch() is synchronous by signature; the real process entrypoint below
    // awaits runUpdate directly rather than through dispatch() for this command.
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  default:
    return { exitCode: 1, stdout: USAGE, stderr: `Unknown command: ${command}\n` };
}
```

```typescript
// src/cli.ts — replace the process-entrypoint block at the bottom with:
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command] = argv;

  if (command === 'update') {
    const root = findMemoryIntelRoot(process.cwd());
    if (!root) { process.stderr.write('No .memoryintel/ found.\n'); process.exit(1); }
    const source = argv[1] ?? '-';
    const planText = source === '-' ? readFileSync(0, 'utf-8') : readFileSync(source, 'utf-8');
    try {
      const result = await runUpdate(root!, planText);
      process.stdout.write(`Applied: ${result.applied.join(', ') || '(none)'}\nSkipped: ${result.skipped.join(', ') || '(none)'}\n`);
      process.exit(0);
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    }
    return;
  }

  const result = dispatch(argv);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (process.argv[1]?.endsWith('cli.js')) {
  main();
}
```

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 7: Commit**

```bash
git add src/commands/update.ts src/cli.ts tests/commands/update.test.ts
git commit -m "feat: implement update command with atomic, lock-guarded plan application"
```

---

### Task 10: `load` command

**Files:**
- Create: `src/commands/load.ts`
- Modify: `src/cli.ts` (wire the `load` case)
- Test: `tests/commands/load.test.ts`

**Interfaces:**
- Consumes: `findMemoryIntelRoot` (Task 2), `extractHeadings` (Task 3), `encodeToonTable` (Task 4).
- Produces: `runLoad(cwd: string, domain?: 'technical' | 'business' | 'research'): string` — returns the full text to print to stdout (empty string when no `.memoryintel/` is found). Consumed by `src/cli.ts` and by Task 15's end-to-end test.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/commands/load.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLoad } from '../../src/commands/load.js';

let base: string;
let root: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mi-load-'));
  root = join(base, '.memoryintel');
  mkdirSync(join(root, 'context'), { recursive: true });
  mkdirSync(join(root, 'technical'), { recursive: true });
  mkdirSync(join(root, 'business'), { recursive: true });
  writeFileSync(join(root, 'context', 'currentMentalModel.md'), 'Auth migration 70% done\n');
  writeFileSync(join(root, 'context', 'activeContext.md'), '## Current Focus\nToken rotation\n');
  writeFileSync(join(root, 'technical', 'architecture.md'), '## Overview\nMicroservices\n');
  writeFileSync(join(root, 'business', 'roadmap.md'), '## Now\nLaunch v1\n');
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('runLoad', () => {
  it('returns empty string when no .memoryintel/ is found', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'mi-load-empty-'));
    expect(runLoad(emptyDir)).toBe('');
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('always includes currentMentalModel.md and activeContext.md', () => {
    const output = runLoad(base);
    expect(output).toContain('Auth migration 70% done');
    expect(output).toContain('Token rotation');
  });

  it('does not include technical/business files with no --domain given', () => {
    const output = runLoad(base);
    expect(output).not.toContain('Microservices');
    expect(output).not.toContain('Launch v1');
  });

  it('includes the technical file set when --domain technical is given', () => {
    const output = runLoad(base, 'technical');
    expect(output).toContain('Microservices');
    expect(output).not.toContain('Launch v1');
  });

  it('includes a TOON heading manifest for loaded files', () => {
    const output = runLoad(base, 'technical');
    expect(output).toContain('items[');
    expect(output).toContain('Overview');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/commands/load.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findMemoryIntelRoot } from '../core/discovery.js';
import { extractHeadings } from '../core/headingMatch.js';
import { encodeToonTable } from '../core/toon.js';

const ALWAYS_LOAD = ['context/currentMentalModel.md', 'context/activeContext.md'];

const DOMAIN_FILES: Record<string, string[]> = {
  technical: ['technical/architecture.md', 'technical/techContext.md', 'technical/patterns.md'],
  business: ['business/productContext.md', 'business/roadmap.md', 'business/stakeholders.md'],
  research: ['research/findings.md', 'research/hypotheses.md']
};

export function runLoad(cwd: string, domain?: 'technical' | 'business' | 'research'): string {
  const root = findMemoryIntelRoot(cwd);
  if (!root) return '';

  const files = [...ALWAYS_LOAD, ...(domain ? DOMAIN_FILES[domain] : [])];
  const sections: string[] = [];
  const manifestRows: Record<string, string>[] = [];

  for (const relFile of files) {
    const absPath = join(root, relFile);
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, 'utf-8');
    sections.push(`--- FILE: ${relFile} ---\n${content}`);
    manifestRows.push({ file: relFile, headings: extractHeadings(content).join('|') });
  }

  const manifest = encodeToonTable(manifestRows);
  return `${manifest}\n${sections.join('\n')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/load.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `src/cli.ts`**

```typescript
// src/cli.ts — add import:
import { runLoad } from './commands/load.js';

// inside dispatch()'s switch, add:
case 'load': {
  const domainFlagIndex = argv.indexOf('--domain');
  const domain = domainFlagIndex !== -1 ? (argv[domainFlagIndex + 1] as 'technical' | 'business' | 'research') : undefined;
  const output = runLoad(process.cwd(), domain);
  return { exitCode: 0, stdout: output, stderr: '' };
}
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/load.ts src/cli.ts tests/commands/load.test.ts
git commit -m "feat: implement load command with always-load and domain-conditional files"
```

---

### Task 11: `status` command

**Files:**
- Create: `src/commands/status.ts`
- Modify: `src/cli.ts` (wire the `status` case)
- Test: `tests/commands/status.test.ts`

**Interfaces:**
- Consumes: `readIndex` (Task 7), `findMemoryIntelRoot` (Task 2).
- Produces: `runStatus(root: string): string` — consumed by `src/cli.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/commands/status.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStatus } from '../../src/commands/status.js';

let root: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'mi-status-'));
  root = join(base, '.memoryintel');
  mkdirSync(join(root, 'context'), { recursive: true });
  writeFileSync(join(root, 'context', 'currentMentalModel.md'), 'Auth migration 70% done\n');
  writeFileSync(join(root, 'memory-index.json'), JSON.stringify({
    'technical/architecture.md': { lastUpdated: '2026-08-20T10:00:00Z', summary: 'JWT refresh introduced' }
  }));
  writeFileSync(join(root, 'memory-events.jsonl'), JSON.stringify({
    timestamp: '2026-08-20T10:00:00Z', type: 'memory-update', summary: 'JWT refresh introduced', affectedFiles: ['technical/architecture.md']
  }) + '\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('runStatus', () => {
  it('includes the current mental model', () => {
    expect(runStatus(root)).toContain('Auth migration 70% done');
  });

  it('includes the index summary', () => {
    expect(runStatus(root)).toContain('JWT refresh introduced');
  });

  it('includes the most recent event', () => {
    expect(runStatus(root)).toContain('memory-update');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/commands/status.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readIndex } from '../core/memoryIndex.js';

export function runStatus(root: string): string {
  const lines: string[] = [];

  const mentalModelPath = join(root, 'context', 'currentMentalModel.md');
  lines.push('=== Current Mental Model ===');
  lines.push(existsSync(mentalModelPath) ? readFileSync(mentalModelPath, 'utf-8').trim() : '(none)');

  lines.push('', '=== Memory Index ===');
  const index = readIndex(join(root, 'memory-index.json'));
  for (const [file, entry] of Object.entries(index)) {
    lines.push(`${file}: ${entry.summary} (updated ${entry.lastUpdated})`);
  }

  lines.push('', '=== Recent Events ===');
  const eventsPath = join(root, 'memory-events.jsonl');
  if (existsSync(eventsPath)) {
    const eventLines = readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of eventLines.slice(-5)) {
      const event = JSON.parse(line);
      lines.push(`[${event.timestamp}] ${event.type}: ${event.summary}`);
    }
  }

  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/status.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `src/cli.ts`**

```typescript
// src/cli.ts — add import:
import { runStatus } from './commands/status.js';

// inside dispatch()'s switch, add:
case 'status': {
  const root = findMemoryIntelRoot(process.cwd());
  if (!root) return { exitCode: 1, stdout: '', stderr: 'No .memoryintel/ found.\n' };
  return { exitCode: 0, stdout: runStatus(root), stderr: '' };
}
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/status.ts src/cli.ts tests/commands/status.test.ts
git commit -m "feat: implement status command for human-readable memory debugging"
```

---

### Task 12: `init` command + templates

**Files:**
- Create: `src/templates/starterFiles.ts`
- Create: `src/commands/init.ts`
- Modify: `src/cli.ts` (wire the `init` case)
- Test: `tests/commands/init.test.ts`

**Interfaces:**
- Produces: `runInit(targetDir: string): void` — consumed by `src/cli.ts` and Task 15's end-to-end test. `STARTER_FILES: { relPath: string; headings: string[] }[]` from `src/templates/starterFiles.ts`, consumed by `init.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/commands/init.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/commands/init.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mi-init-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runInit', () => {
  it('creates the full .memoryintel/ directory tree', () => {
    runInit(dir);
    const root = join(dir, '.memoryintel');
    expect(existsSync(join(root, 'instructions.md'))).toBe(true);
    expect(existsSync(join(root, 'memory-config.json'))).toBe(true);
    expect(existsSync(join(root, 'memory-index.json'))).toBe(true);
    expect(existsSync(join(root, 'memory-events.jsonl'))).toBe(true);
    expect(existsSync(join(root, 'technical', 'architecture.md'))).toBe(true);
    expect(existsSync(join(root, 'context', 'currentMentalModel.md'))).toBe(true);
    expect(existsSync(join(root, 'intelligence', 'entities.json'))).toBe(true);
  });

  it('seeds architecture.md with the starter heading vocabulary', () => {
    runInit(dir);
    const content = readFileSync(join(dir, '.memoryintel', 'technical', 'architecture.md'), 'utf-8');
    expect(content).toContain('## Overview');
    expect(content).toContain('## Components');
    expect(content).toContain('## Data Flow');
    expect(content).toContain('## Integrations');
  });

  it('is idempotent: re-running does not overwrite existing file content', () => {
    runInit(dir);
    const archPath = join(dir, '.memoryintel', 'technical', 'architecture.md');
    writeFileSync(archPath, '## Overview\ncustom content\n');
    runInit(dir);
    expect(readFileSync(archPath, 'utf-8')).toBe('## Overview\ncustom content\n');
  });

  it('creates missing files on re-run without touching existing ones (upgrade path)', () => {
    runInit(dir);
    const root = join(dir, '.memoryintel');
    rmSync(join(root, 'research', 'hypotheses.md'));
    runInit(dir);
    expect(existsSync(join(root, 'research', 'hypotheses.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/init.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/templates/starterFiles.ts

export interface StarterFile {
  relPath: string;
  headings: string[];
}

export const STARTER_FILES: StarterFile[] = [
  { relPath: 'context/projectBrief.md', headings: ['Overview'] },
  { relPath: 'context/objectives.md', headings: ['Objectives'] },
  { relPath: 'context/activeContext.md', headings: ['Current Focus'] },
  { relPath: 'context/decisions.md', headings: ['Decisions Log'] },
  { relPath: 'context/progress.md', headings: ['Status'] },
  { relPath: 'context/learnings.md', headings: ['Learnings'] },
  { relPath: 'technical/architecture.md', headings: ['Overview', 'Components', 'Data Flow', 'Integrations'] },
  { relPath: 'technical/techContext.md', headings: ['Stack', 'Conventions', 'Environment'] },
  { relPath: 'technical/patterns.md', headings: ['Design Patterns', 'Anti-Patterns'] },
  { relPath: 'technical/integrations.md', headings: ['External Services', 'Internal Dependencies'] },
  { relPath: 'technical/infrastructure.md', headings: ['Deployment', 'Hosting', 'CI/CD'] },
  { relPath: 'business/productContext.md', headings: ['Product Overview', 'Users', 'Value Proposition'] },
  { relPath: 'business/roadmap.md', headings: ['Now', 'Next', 'Later'] },
  { relPath: 'business/stakeholders.md', headings: ['Team', 'External Stakeholders'] },
  { relPath: 'business/marketContext.md', headings: ['Market Overview', 'Competitors'] },
  { relPath: 'research/findings.md', headings: ['Key Findings'] },
  { relPath: 'research/references.md', headings: ['Sources'] },
  { relPath: 'research/hypotheses.md', headings: ['Open Hypotheses'] }
];

// No headings — always fully overwritten by `update`, never section-addressed.
export const MENTAL_MODEL_STARTER = '_No sessions yet._\n';
```

```typescript
// src/commands/init.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { STARTER_FILES, MENTAL_MODEL_STARTER } from '../templates/starterFiles.js';

const INSTRUCTIONS_TEMPLATE = `# Memory Intel Instructions

This project uses Memory Intel. Read this file at the start of every session.

## Session start
Run \`memoryintel load [--domain technical|business|research]\` and treat its output as project context.

## Session end
If your work changed project understanding (new architecture, feature, decision, integration, or
roadmap item — not formatting/typos/comments), draft an update-plan (TOON table: file, action,
section, content, reason) and run \`memoryintel update\`. Reuse exact existing heading names from
the manifest `load` gave you. If nothing meaningful changed, do nothing — do not call \`update\`.

## Dashboard
If the user asks to turn off the dashboard/web UI, run \`memoryintel dashboard disable\`. This is a
single shared dashboard for every Memory Intel project on this machine — tell the user it affects
all of their projects, not just this one. \`memoryintel dashboard enable\` turns it back on.
`;

function ensureFile(path: string, content: string): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function runInit(targetDir: string): void {
  const root = join(targetDir, '.memoryintel');
  mkdirSync(root, { recursive: true });

  ensureFile(join(root, 'instructions.md'), INSTRUCTIONS_TEMPLATE);
  ensureFile(join(root, 'memory-config.json'), JSON.stringify({ initializedAt: new Date().toISOString(), version: '0.1.0' }, null, 2) + '\n');
  ensureFile(join(root, 'memory-index.json'), '{}\n');
  ensureFile(join(root, 'memory-events.jsonl'), '');

  ensureFile(join(root, 'context', 'currentMentalModel.md'), MENTAL_MODEL_STARTER);

  for (const file of STARTER_FILES) {
    const content = file.headings.map((h) => `## ${h}\n`).join('\n');
    ensureFile(join(root, file.relPath), content);
  }

  for (const stub of ['entities.json', 'relationships.json', 'metadata.json']) {
    ensureFile(join(root, 'intelligence', stub), '{}\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/init.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `src/cli.ts`**

```typescript
// src/cli.ts — add import:
import { runInit } from './commands/init.js';

// inside dispatch()'s switch, add:
case 'init': {
  const target = argv[1] ? join(process.cwd(), argv[1]) : process.cwd();
  runInit(target);
  return { exitCode: 0, stdout: `Initialized Memory Intel in ${join(target, '.memoryintel')}\n`, stderr: '' };
}
```

(Add `import { join } from 'node:path';` at the top of `src/cli.ts` if not already present from an earlier task.)

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/templates/starterFiles.ts src/commands/init.ts src/cli.ts tests/commands/init.test.ts
git commit -m "feat: implement init command with seeded starter headings and idempotent re-run"
```

---

### Task 13: Claude Code hook adapter + `check-stop` command

**Files:**
- Create: `src/adapters/claudeCode.ts`
- Modify: `src/commands/init.ts` (call the adapter when a `.claude` directory exists in the project)
- Modify: `src/cli.ts` (wire the `check-stop` case)
- Test: `tests/adapters/claudeCode.test.ts`

**Interfaces:**
- Produces: `wireClaudeCodeHooks(projectRoot: string): void`, `runCheckStop(root: string): { decision: 'block' | 'allow'; reason?: string }`.

Verification note: the block/allow JSON shape below (`{"decision":"block","reason":"..."}`) reflects Claude Code's documented Stop-hook contract as of this plan's writing. Before running Step 6, use the `claude-code-guide` agent (or current Claude Code hook docs) to confirm the exact field names for the installed Claude Code version, and adjust `runCheckStop`'s output shape if it has changed.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/adapters/claudeCode.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wireClaudeCodeHooks, runCheckStop } from '../../src/adapters/claudeCode.js';

let projectRoot: string;
let memoryRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'mi-cc-'));
  memoryRoot = join(projectRoot, '.memoryintel');
  mkdirSync(memoryRoot, { recursive: true });
});
afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

describe('wireClaudeCodeHooks', () => {
  it('creates .claude/settings.json with SessionStart and Stop hooks when none exists', () => {
    wireClaudeCodeHooks(projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf-8'));
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain('memoryintel load');
    expect(JSON.stringify(settings.hooks.Stop)).toContain('memoryintel check-stop');
  });

  it('merges into existing settings.json without removing unrelated hooks', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing-tool session-start' }] }] }
    }));
    wireClaudeCodeHooks(projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf-8'));
    const sessionStartCommands = JSON.stringify(settings.hooks.SessionStart);
    expect(sessionStartCommands).toContain('existing-tool session-start');
    expect(sessionStartCommands).toContain('memoryintel load');
  });

  it('is idempotent: re-running does not duplicate hook entries', () => {
    wireClaudeCodeHooks(projectRoot);
    wireClaudeCodeHooks(projectRoot);
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf-8'));
    const loadCount = (JSON.stringify(settings.hooks.SessionStart).match(/memoryintel load/g) ?? []).length;
    expect(loadCount).toBe(1);
  });
});

describe('runCheckStop', () => {
  it('allows the stop when no session marker exists (fail open)', () => {
    expect(runCheckStop(memoryRoot)).toEqual({ decision: 'allow' });
  });

  it('blocks once when the marker shows unsaved changes and no update ran', () => {
    writeFileSync(join(memoryRoot, '.session-marker.json'), JSON.stringify({ hasChanges: true, updatedSinceMarker: false, nudged: false }));
    const result = runCheckStop(memoryRoot);
    expect(result.decision).toBe('block');

    const marker = JSON.parse(readFileSync(join(memoryRoot, '.session-marker.json'), 'utf-8'));
    expect(marker.nudged).toBe(true);
  });

  it('allows the stop on a second attempt even if still unsaved (no infinite loop)', () => {
    writeFileSync(join(memoryRoot, '.session-marker.json'), JSON.stringify({ hasChanges: true, updatedSinceMarker: false, nudged: true }));
    expect(runCheckStop(memoryRoot)).toEqual({ decision: 'allow' });
  });

  it('allows the stop once update has run since the marker', () => {
    writeFileSync(join(memoryRoot, '.session-marker.json'), JSON.stringify({ hasChanges: true, updatedSinceMarker: true, nudged: false }));
    expect(runCheckStop(memoryRoot)).toEqual({ decision: 'allow' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/claudeCode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/adapters/claudeCode.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface HookEntry { hooks: { type: 'command'; command: string }[] }
interface ClaudeSettings { hooks?: { SessionStart?: HookEntry[]; Stop?: HookEntry[]; [k: string]: unknown } ; [k: string]: unknown }

function readSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8').trim();
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function hasCommand(entries: HookEntry[] | undefined, command: string): boolean {
  return (entries ?? []).some((e) => e.hooks.some((h) => h.command === command));
}

export function wireClaudeCodeHooks(projectRoot: string): void {
  const claudeDir = join(projectRoot, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, 'settings.json');
  const settings = readSettings(settingsPath);

  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  settings.hooks.Stop ??= [];

  if (!hasCommand(settings.hooks.SessionStart, 'memoryintel load')) {
    settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'memoryintel load' }] });
  }
  if (!hasCommand(settings.hooks.Stop, 'memoryintel check-stop')) {
    settings.hooks.Stop.push({ hooks: [{ type: 'command', command: 'memoryintel check-stop' }] });
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

interface SessionMarker { hasChanges: boolean; updatedSinceMarker: boolean; nudged: boolean }

export function runCheckStop(memoryRoot: string): { decision: 'block' | 'allow'; reason?: string } {
  const markerPath = join(memoryRoot, '.session-marker.json');
  if (!existsSync(markerPath)) return { decision: 'allow' };

  const marker: SessionMarker = JSON.parse(readFileSync(markerPath, 'utf-8'));

  if (!marker.hasChanges || marker.updatedSinceMarker || marker.nudged) {
    return { decision: 'allow' };
  }

  marker.nudged = true;
  writeFileSync(markerPath, JSON.stringify(marker));
  return {
    decision: 'block',
    reason: 'Working tree has changes and memory has not been updated this session. Classify the changes and run `memoryintel update` before finishing, or finish again to proceed without updating.'
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/claudeCode.test.ts`
Expected: PASS

- [ ] **Step 5: Wire `init` to call the adapter, and `check-stop` into `src/cli.ts`**

```typescript
// src/commands/init.ts — add import and call at the end of runInit:
import { existsSync as existsSyncCheck } from 'node:fs'; // if not already imported as existsSync above, reuse that import
import { wireClaudeCodeHooks } from '../adapters/claudeCode.js';

// at the end of runInit(targetDir), after the intelligence stubs loop:
if (existsSync(join(targetDir, '.claude'))) {
  wireClaudeCodeHooks(targetDir);
}
```

```typescript
// src/cli.ts — add import:
import { runCheckStop } from './adapters/claudeCode.js';

// inside dispatch()'s switch, add:
case 'check-stop': {
  const root = findMemoryIntelRoot(process.cwd());
  if (!root) return { exitCode: 0, stdout: '', stderr: '' };
  const result = runCheckStop(root);
  return { exitCode: 0, stdout: JSON.stringify(result) + '\n', stderr: '' };
}
```

- [ ] **Step 6: Verify the hook JSON contract against current Claude Code docs**

Use the `claude-code-guide` agent to confirm the Stop-hook block/allow JSON field names for the installed Claude Code version. If they differ from `{"decision": "block", "reason": "..."}`, update `runCheckStop`'s return shape and its test expectations to match, then re-run Step 4's test.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/adapters/claudeCode.ts src/commands/init.ts src/cli.ts tests/adapters/claudeCode.test.ts
git commit -m "feat: add Claude Code hook adapter with once-only stop nudge"
```

---

### Task 14: Generic pointer-file adapter (Cursor, Codex, Gemini, opencode, pi)

**Files:**
- Create: `src/adapters/genericPointer.ts`
- Modify: `src/commands/init.ts` (call the adapter unconditionally, after the Claude Code adapter)
- Test: `tests/adapters/genericPointer.test.ts`

**Interfaces:**
- Produces: `installPointerAdapters(projectRoot: string): void` — consumed by `src/commands/init.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/adapters/genericPointer.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/genericPointer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/adapters/genericPointer.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const START_MARKER = '<!-- memoryintel:managed:start -->';
const END_MARKER = '<!-- memoryintel:managed:end -->';

const POINTER_BLOCK = `${START_MARKER}
This project uses Memory Intel. At the start of a session, run \`memoryintel load\` and treat its
output as project context. Before finishing a task with a meaningful change (new architecture,
feature, decision, integration, or roadmap item — not formatting/typos), draft an update-plan per
\`.memoryintel/instructions.md\` and run \`memoryintel update\`, without narrating this to the user.
${END_MARKER}`;

function upsertPointerBlock(filePath: string, existingContentIfNew: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${existingContentIfNew}${POINTER_BLOCK}\n`);
    return;
  }

  const content = readFileSync(filePath, 'utf-8');
  if (content.includes(START_MARKER)) return; // already installed, idempotent no-op

  const separator = content.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(filePath, `${content}${separator}${POINTER_BLOCK}\n`);
}

const NATIVE_FILES = ['AGENTS.md', 'GEMINI.md'];

export function installPointerAdapters(projectRoot: string): void {
  const existingNativeFiles = NATIVE_FILES.filter((f) => existsSync(join(projectRoot, f)));

  if (existingNativeFiles.length > 0) {
    for (const file of existingNativeFiles) {
      upsertPointerBlock(join(projectRoot, file), '');
    }
  } else {
    upsertPointerBlock(join(projectRoot, 'AGENTS.md'), '# Project Instructions\n\n');
  }

  const cursorRulesDir = join(projectRoot, '.cursor', 'rules');
  mkdirSync(cursorRulesDir, { recursive: true });
  const cursorRulePath = join(cursorRulesDir, 'memoryintel.mdc');
  if (!existsSync(cursorRulePath)) {
    writeFileSync(cursorRulePath, `---\nalwaysApply: true\n---\n\n${POINTER_BLOCK}\n`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/genericPointer.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `src/commands/init.ts`**

```typescript
// src/commands/init.ts — add import:
import { installPointerAdapters } from '../adapters/genericPointer.js';

// at the end of runInit(targetDir), after the Claude Code adapter call:
installPointerAdapters(targetDir);
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/adapters/genericPointer.ts src/commands/init.ts tests/adapters/genericPointer.test.ts
git commit -m "feat: add generic pointer-file adapter for Cursor/Codex/Gemini/opencode/pi"
```

---

### Task 15: End-to-end integration test

**Files:**
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: `runInit` (Task 12), `runLoad` (Task 10), `runUpdate` (Task 9), `runStatus` (Task 11).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/commands/init.js';
import { runLoad } from '../src/commands/load.js';
import { runUpdate } from '../src/commands/update.js';
import { runStatus } from '../src/commands/status.js';
import { encodeToonTable } from '../src/core/toon.js';
import { findMemoryIntelRoot } from '../src/core/discovery.js';

let projectDir: string;

beforeEach(() => { projectDir = mkdtempSync(join(tmpdir(), 'mi-e2e-')); });
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

describe('end-to-end: init -> load -> update -> load -> status', () => {
  it('carries a change through the full lifecycle', async () => {
    runInit(projectDir);

    const firstLoad = runLoad(projectDir, 'technical');
    expect(firstLoad).toContain('_No sessions yet._');
    expect(firstLoad).toContain('## Overview');

    const root = findMemoryIntelRoot(projectDir)!;
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'JWT refresh token architecture introduced', reason: 'New auth flow' },
      { file: 'context/currentMentalModel.md', action: 'replace', section: '', content: 'Authentication migration 70% complete. Next milestone: token rotation rollout.', reason: 'session summary' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied.sort()).toEqual(['context/currentMentalModel.md', 'technical/architecture.md']);

    const secondLoad = runLoad(projectDir, 'technical');
    expect(secondLoad).toContain('JWT refresh token architecture introduced');
    expect(secondLoad).toContain('Authentication migration 70% complete');

    const status = runStatus(root);
    expect(status).toContain('Authentication migration 70% complete');
    expect(status).toContain('New auth flow');
  });

  it('leaves everything untouched when the agent has nothing meaningful to report (no update call)', () => {
    runInit(projectDir);
    const before = runLoad(projectDir);
    const after = runLoad(projectDir);
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/e2e.test.ts`
Expected: If Tasks 1–12 were implemented correctly, this should PASS immediately — it exercises no new production code, only integrates what already exists. If it fails, the failure points to an integration bug between existing modules; fix that bug (not this test) before proceeding.

- [ ] **Step 3: Run the entire test suite one final time**

Run: `npx vitest run`
Expected: PASS — every test file from Tasks 1–15 green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e.test.ts
git commit -m "test: add end-to-end init/load/update/status lifecycle coverage"
```

---

## Self-Review Notes

**Spec coverage:** §2 (architecture) → Task 1; §3 (components→commands) → Tasks 9–12; §3 (TOON boundary) → Task 4; §4 (section addressing + drift mitigations) → Tasks 3, 5; §5 (session lifecycle) → Task 15; §6 (adapters) → Tasks 13–14 (pi hooks explicitly deferred, noted in header); §7 (error handling: missing root, corrupt input, atomicity, locking, path safety, idempotent init) → Tasks 2, 6, 8, 9, 12. §8 (dashboard) and §9's dashboard-specific tests are out of scope for this plan by design (Plan B). §1 (relationship to claude-mem/context-mode) needs no task — it's a non-dependency, nothing to build.

**Type consistency checked:** `SectionAction`, `SectionRejectedError`, `applySectionUpdate` signature used identically in Tasks 5 and 9. `PlanRow` shape (`file`/`action`/`section`/`content`/`reason`) consistent between Task 9's implementation and Task 15's e2e test. `findMemoryIntelRoot` return type (`string | null`) handled consistently in Tasks 9–11, 13, 15.

**No placeholders found** on final read-through.
