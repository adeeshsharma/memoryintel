# Automatic Stack/Integration Fact Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect and write high-confidence stack/integration/deployment facts into `technical/techContext.md`, `technical/integrations.md`, and `technical/infrastructure.md` — with zero agent or user action required — and make `check-stop`'s nudge name specifically what it detected.

**Architecture:** A pure-data mapping table (`knownFacts.ts`) turns `detectStack()`'s existing dependency list into human-readable facts. A best-effort signal scanner (`infraSignals.ts`) checks for deployment config files. A generic marker-based block writer (`detectedBlock.ts`, modeled on the existing pointer-block mechanism in `adapters/genericPointer.ts`) inserts/refreshes a machine-owned `<!-- memoryintel:detected:start/end -->` block under a named heading, never touching agent-authored content elsewhere in the same section. An orchestrator (`factSync.ts`) wires these together and is called automatically from both `load` (every session start) and `check-stop` (only when the diff touches a manifest file), plus exposed manually as `memoryintel sync`.

**Tech Stack:** TypeScript, Node.js built-ins only (`node:fs`, `node:path`, `node:child_process` — already used throughout this codebase), Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-09-06-automatic-fact-detection-design.md`

## Global Constraints

- The detected block never creates a target file that doesn't already exist — a directory `init` hasn't touched is left completely alone (`upsertDetectedBlock` returns `'missing-file'`, no write).
- The detected block never creates a heading that doesn't exist in the target file either — only refreshes/inserts under a heading that's really there.
- Content outside the `<!-- memoryintel:detected:start -->`/`<!-- memoryintel:detected:end -->` markers is never touched, in any file, ever.
- Infrastructure/deployment detection is config-file-presence only (`vercel.json`, `.vercel/`, `netlify.toml`, `Dockerfile`, `docker-compose.yml`, `fly.toml`, `render.yaml`, `wrangler.toml`, `Procfile`, `.github/workflows/*.yml` grepped for known deploy-action names) — never dependency-based, since no dependency signal exists for "where is this deployed."
- `check-stop`'s manifest-file gate uses exactly the same file set `detectStack()` already recognizes: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`.
- No interactive prompting is introduced anywhere in this feature — this was explicitly decided against during brainstorming in favor of best-effort-only detection.
- Every write in this feature reuses the existing atomic-write + per-file-lock mechanism (`atomicWriteFile`, `withLockSync`) — no new write primitive.

---

### Task 1: `knownFacts.ts` — the dependency-to-fact mapping table

**Files:**
- Create: `src/core/knownFacts.ts`
- Test: `tests/core/knownFacts.test.ts`

**Interfaces:**
- Produces: `KnownFact` interface (`{ match: string | string[]; fact: string; target: 'techContext' | 'integrations' }`), `KNOWN_FACTS: KnownFact[]`, `matchKnownFacts(dependencies: string[]): { techContext: string[]; integrations: string[] }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/knownFacts.test.ts
import { describe, it, expect } from 'vitest';
import { matchKnownFacts } from '../../src/core/knownFacts.js';

describe('matchKnownFacts', () => {
  it('matches a framework dependency into techContext', () => {
    const result = matchKnownFacts(['next', 'react', 'some-unknown-pkg']);
    expect(result.techContext.some((f) => f.includes('Next.js') && f.includes('`next`'))).toBe(true);
  });

  it('matches a scoped package dependency into integrations', () => {
    const result = matchKnownFacts(['@sanity/client']);
    expect(result.integrations.some((f) => f.includes('Sanity') && f.includes('@sanity/client'))).toBe(true);
  });

  it('matches whichever alias is present when match is an array', () => {
    const viaAlias = matchKnownFacts(['sanity']);
    expect(viaAlias.integrations.some((f) => f.includes('Sanity') && f.includes('`sanity`'))).toBe(true);
  });

  it('returns empty arrays when nothing matches', () => {
    const result = matchKnownFacts(['some-random-unrelated-package']);
    expect(result.techContext).toEqual([]);
    expect(result.integrations).toEqual([]);
  });

  it('never duplicates a fact when both alias names are present', () => {
    const result = matchKnownFacts(['@sanity/client', 'sanity']);
    const sanityMatches = result.integrations.filter((f) => f.includes('Sanity'));
    expect(sanityMatches.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/knownFacts.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/knownFacts.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/knownFacts.ts
export interface KnownFact {
  // Dependency name(s) (as they'd appear as a package.json dependencies/devDependencies key)
  // that trigger this fact. An array covers a library published under multiple common names.
  match: string | string[];
  fact: string;
  target: 'techContext' | 'integrations';
}

// A curated, deliberately small starter set covering common frameworks, CMS, DB, payment, and
// auth libraries. Extending this is a one-line PR to this file - no plugin system needed at this
// scale (see spec's "Non-goals").
export const KNOWN_FACTS: KnownFact[] = [
  { match: 'next', fact: 'Next.js (React framework)', target: 'techContext' },
  { match: 'react', fact: 'React', target: 'techContext' },
  { match: 'vue', fact: 'Vue', target: 'techContext' },
  { match: 'svelte', fact: 'Svelte', target: 'techContext' },
  { match: 'typescript', fact: 'TypeScript', target: 'techContext' },
  { match: 'express', fact: 'Express', target: 'techContext' },
  { match: 'fastify', fact: 'Fastify', target: 'techContext' },
  { match: 'prisma', fact: 'Prisma (ORM)', target: 'techContext' },
  { match: 'mongoose', fact: 'MongoDB (via Mongoose)', target: 'techContext' },
  { match: 'tailwindcss', fact: 'Tailwind CSS', target: 'techContext' },
  { match: ['@sanity/client', 'sanity'], fact: 'Sanity (headless CMS)', target: 'integrations' },
  { match: 'contentful', fact: 'Contentful (headless CMS)', target: 'integrations' },
  { match: 'stripe', fact: 'Stripe (payments)', target: 'integrations' },
  { match: '@supabase/supabase-js', fact: 'Supabase', target: 'integrations' },
  { match: 'firebase', fact: 'Firebase', target: 'integrations' },
  { match: 'firebase-admin', fact: 'Firebase Admin SDK', target: 'integrations' },
  { match: 'next-auth', fact: 'NextAuth.js (authentication)', target: 'integrations' },
  { match: '@auth0/nextjs-auth0', fact: 'Auth0 (authentication)', target: 'integrations' },
  { match: '@clerk/nextjs', fact: 'Clerk (authentication)', target: 'integrations' },
  { match: '@sendgrid/mail', fact: 'SendGrid (email)', target: 'integrations' },
  { match: 'resend', fact: 'Resend (email)', target: 'integrations' },
  { match: 'twilio', fact: 'Twilio', target: 'integrations' },
  { match: '@aws-sdk/client-s3', fact: 'AWS S3', target: 'integrations' },
  { match: 'openai', fact: 'OpenAI API', target: 'integrations' },
  { match: '@anthropic-ai/sdk', fact: 'Anthropic API', target: 'integrations' },
  { match: '@sentry/node', fact: 'Sentry (error tracking)', target: 'integrations' },
  { match: '@sentry/nextjs', fact: 'Sentry (error tracking)', target: 'integrations' },
  { match: 'posthog-js', fact: 'PostHog (analytics)', target: 'integrations' },
  { match: '@vercel/analytics', fact: 'Vercel Analytics', target: 'integrations' },
  { match: 'graphql', fact: 'GraphQL', target: 'techContext' },
  { match: 'redis', fact: 'Redis', target: 'techContext' },
  { match: 'pg', fact: 'PostgreSQL (via pg)', target: 'techContext' }
];

// Each returned fact line is self-documenting about its evidence (which exact dependency name
// triggered it) - a reader should never have to take the tool's word for a fact it can't trace
// back to something real in the repo. `${matched}` is deliberately the specific name that was
// actually present, not `known.match` itself, since that may be an array of aliases.
export function matchKnownFacts(dependencies: string[]): { techContext: string[]; integrations: string[] } {
  const deps = new Set(dependencies);
  const result: { techContext: string[]; integrations: string[] } = { techContext: [], integrations: [] };

  for (const known of KNOWN_FACTS) {
    const candidates = Array.isArray(known.match) ? known.match : [known.match];
    const matched = candidates.find((c) => deps.has(c));
    if (matched) {
      result[known.target].push(`${known.fact} — via \`${matched}\` in package.json`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/knownFacts.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/core/knownFacts.ts tests/core/knownFacts.test.ts
git commit -m "feat: add dependency-to-fact mapping table"
```

---

### Task 2: `infraSignals.ts` — best-effort deployment detection

**Files:**
- Create: `src/core/infraSignals.ts`
- Test: `tests/core/infraSignals.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `detectInfraSignals(targetDir: string): string[]` — returns fact lines (empty array if nothing found; the "no signal" placeholder text is the caller's responsibility, per Task 4).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/infraSignals.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectInfraSignals } from '../../src/core/infraSignals.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mi-infra-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('detectInfraSignals', () => {
  it('returns an empty array when no known deploy config exists', () => {
    expect(detectInfraSignals(dir)).toEqual([]);
  });

  it('detects vercel.json', () => {
    writeFileSync(join(dir, 'vercel.json'), '{}');
    expect(detectInfraSignals(dir).some((f) => f.includes('Vercel') && f.includes('vercel.json'))).toBe(true);
  });

  it('detects a .vercel/ directory', () => {
    mkdirSync(join(dir, '.vercel'));
    expect(detectInfraSignals(dir).some((f) => f.includes('Vercel'))).toBe(true);
  });

  it('detects netlify.toml', () => {
    writeFileSync(join(dir, 'netlify.toml'), '');
    expect(detectInfraSignals(dir).some((f) => f.includes('Netlify'))).toBe(true);
  });

  it('detects a Dockerfile', () => {
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20');
    expect(detectInfraSignals(dir).some((f) => f.includes('Docker'))).toBe(true);
  });

  it('detects a GitHub Actions workflow referencing a known deploy action', () => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(dir, '.github', 'workflows', 'deploy.yml'),
      'jobs:\n  deploy:\n    steps:\n      - uses: amondnet/vercel-action@v25\n'
    );
    expect(detectInfraSignals(dir).some((f) => f.includes('Vercel') && f.includes('workflow'))).toBe(true);
  });

  it('does not report a workflow file with no recognized deploy action', () => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'jobs:\n  test:\n    steps:\n      - run: npm test\n');
    expect(detectInfraSignals(dir)).toEqual([]);
  });

  it('reports multiple independent signals together', () => {
    writeFileSync(join(dir, 'vercel.json'), '{}');
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:20');
    const result = detectInfraSignals(dir);
    expect(result.some((f) => f.includes('Vercel'))).toBe(true);
    expect(result.some((f) => f.includes('Docker'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/infraSignals.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/infraSignals.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface FileSignal {
  relPath: string; // relative to targetDir; a directory path is checked with existsSync too
  fact: string;
}

// Presence-only, no version/config parsing. Vercel gets two independent signals
// (vercel.json and .vercel/) since either alone is common depending on whether the project was
// ever linked locally via `vercel link` vs. only ever deployed through the dashboard/CI.
const FILE_SIGNALS: FileSignal[] = [
  { relPath: 'vercel.json', fact: 'Vercel' },
  { relPath: '.vercel', fact: 'Vercel' },
  { relPath: 'netlify.toml', fact: 'Netlify' },
  { relPath: 'Dockerfile', fact: 'Docker' },
  { relPath: 'docker-compose.yml', fact: 'Docker Compose' },
  { relPath: 'fly.toml', fact: 'Fly.io' },
  { relPath: 'render.yaml', fact: 'Render' },
  { relPath: 'wrangler.toml', fact: 'Cloudflare Workers (via Wrangler)' },
  { relPath: 'Procfile', fact: 'Heroku (or Heroku-compatible, via Procfile)' }
];

// Known deploy-action name fragments to grep for inside .github/workflows/*.yml - deliberately
// substring matches (not parsing the `uses:` field structurally), since a real YAML parser is
// more machinery than a best-effort signal needs and every real deploy-action reference contains
// one of these fragments regardless of version pin or org fork.
const WORKFLOW_DEPLOY_ACTIONS: { fragment: string; fact: string }[] = [
  { fragment: 'vercel-action', fact: 'Vercel' },
  { fragment: 'amondnet/vercel', fact: 'Vercel' },
  { fragment: 'netlify/actions', fact: 'Netlify' },
  { fragment: 'nwtgck/actions-netlify', fact: 'Netlify' },
  { fragment: 'superfly/flyctl-actions', fact: 'Fly.io' },
  { fragment: 'aws-actions/', fact: 'AWS (via GitHub Actions)' },
  { fragment: 'google-github-actions/', fact: 'Google Cloud (via GitHub Actions)' },
  { fragment: 'azure/webapps-deploy', fact: 'Azure' }
];

function detectWorkflowSignals(targetDir: string): string[] {
  const workflowsDir = join(targetDir, '.github', 'workflows');
  if (!existsSync(workflowsDir)) return [];

  let files: string[];
  try {
    files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    return [];
  }

  const found = new Set<string>();
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(workflowsDir, file), 'utf-8');
    } catch {
      continue;
    }
    for (const { fragment, fact } of WORKFLOW_DEPLOY_ACTIONS) {
      if (content.includes(fragment)) {
        found.add(`${fact} — via \`${file}\` GitHub Actions workflow`);
      }
    }
  }
  return [...found];
}

// Best-effort only, by design: no dependency-based signal exists for "where is this deployed"
// (a project deployed via a hosting platform's dashboard, connected straight to its git remote,
// can leave zero trace in the repo itself - confirmed on a real project during this feature's own
// design). Returns an empty array when nothing is found; the caller decides how to render that
// as an explicit "no signal" statement rather than silence (see factSync.ts).
export function detectInfraSignals(targetDir: string): string[] {
  const found = new Set<string>();

  for (const { relPath, fact } of FILE_SIGNALS) {
    if (existsSync(join(targetDir, relPath))) {
      found.add(`${fact} — via \`${relPath}\``);
    }
  }

  for (const line of detectWorkflowSignals(targetDir)) {
    found.add(line);
  }

  return [...found];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/infraSignals.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/core/infraSignals.ts tests/core/infraSignals.test.ts
git commit -m "feat: add best-effort deployment signal detection"
```

---

### Task 3: `detectedBlock.ts` — generic managed-block writer

**Files:**
- Create: `src/core/detectedBlock.ts`
- Test: `tests/core/detectedBlock.test.ts`

**Interfaces:**
- Consumes: `getSectionContent`, `applySectionUpdate` from `src/core/sectionWriter.js` (existing); `atomicWriteFile` from `src/core/atomicWrite.js` (existing).
- Produces: `DETECTED_START`, `DETECTED_END` (exported constants), `DetectedBlockResult` type (`'written' | 'unchanged' | 'missing-file' | 'missing-heading'`), `upsertDetectedBlock(absPath: string, heading: string, lines: string[]): DetectedBlockResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/detectedBlock.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertDetectedBlock, DETECTED_START, DETECTED_END } from '../../src/core/detectedBlock.js';

let dir: string;
let filePath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-detectedblock-'));
  filePath = join(dir, 'techContext.md');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('upsertDetectedBlock', () => {
  it('returns missing-file and writes nothing when the target file does not exist', () => {
    const result = upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    expect(result).toBe('missing-file');
  });

  it('returns missing-heading when the file exists but the heading does not', () => {
    writeFileSync(filePath, '## Conventions\n\n## Environment\n');
    const result = upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    expect(result).toBe('missing-heading');
  });

  it('inserts a fresh block into an empty section', () => {
    writeFileSync(filePath, '## Stack\n\n## Conventions\n');
    const result = upsertDetectedBlock(filePath, 'Stack', ['- Next.js', '- TypeScript']);
    expect(result).toBe('written');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain(`${DETECTED_START}\n- Next.js\n- TypeScript\n${DETECTED_END}`);
    expect(content).toContain('## Conventions');
  });

  it('inserts the block above existing agent-authored prose in the same section, leaving the prose intact', () => {
    writeFileSync(filePath, '## Stack\nWe picked Next.js because of its SSR support.\n\n## Conventions\n');
    upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('We picked Next.js because of its SSR support.');
    expect(content.indexOf(DETECTED_START)).toBeLessThan(content.indexOf('We picked Next.js'));
  });

  it('refreshes an existing block in place, leaving prose below it untouched', () => {
    writeFileSync(
      filePath,
      `## Stack\n${DETECTED_START}\n- Old Fact\n${DETECTED_END}\n\nAgent note: this stayed the same for months.\n\n## Conventions\n`
    );
    const result = upsertDetectedBlock(filePath, 'Stack', ['- New Fact']);
    expect(result).toBe('written');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('Old Fact');
    expect(content).toContain('New Fact');
    expect(content).toContain('Agent note: this stayed the same for months.');
  });

  it('returns unchanged and writes nothing when the computed block is identical to what is already there', () => {
    writeFileSync(filePath, `## Stack\n${DETECTED_START}\n- Next.js\n${DETECTED_END}\n\n## Conventions\n`);
    const before = readFileSync(filePath, 'utf-8');
    const result = upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    expect(result).toBe('unchanged');
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('never touches a different section in the same file', () => {
    writeFileSync(filePath, '## Stack\n\n## Conventions\nAlways use 2-space indentation.\n');
    upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('Always use 2-space indentation.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/detectedBlock.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/detectedBlock.ts
import { readFileSync, existsSync } from 'node:fs';
import { atomicWriteFile } from './atomicWrite.js';
import { getSectionContent, applySectionUpdate } from './sectionWriter.js';

export const DETECTED_START = '<!-- memoryintel:detected:start -->';
export const DETECTED_END = '<!-- memoryintel:detected:end -->';

export type DetectedBlockResult = 'written' | 'unchanged' | 'missing-file' | 'missing-heading';

function buildBlock(lines: string[]): string {
  return [DETECTED_START, ...lines, DETECTED_END].join('\n');
}

// Inserts or refreshes a memoryintel-owned "detected facts" block at the top of `heading`'s
// section content in the markdown file at absPath - modeled on the existing pointer-block
// mechanism in adapters/genericPointer.ts, generalized to work on an arbitrary heading inside an
// arbitrary file instead of one hardcoded block in one hardcoded set of files.
//
// Never creates the file (a directory `init` hasn't touched is left alone - 'missing-file') and
// never creates the heading either (`init`'s STARTER_FILES already ship every heading this is
// ever pointed at; a project on an old template without it is simply skipped - 'missing-heading'
// - rather than this feature mutating a file's structure it was never asked to manage).
//
// Content outside the markers - including agent-authored prose elsewhere in the very same
// section, above or below the block - is preserved byte-for-byte. This is what makes it safe to
// call this on every session start without ever risking real project understanding: the block is
// fully machine-owned, and everything else in the file categorically is not.
export function upsertDetectedBlock(absPath: string, heading: string, lines: string[]): DetectedBlockResult {
  if (!existsSync(absPath)) return 'missing-file';

  const markdown = readFileSync(absPath, 'utf-8');
  const sectionContent = getSectionContent(markdown, heading);
  if (sectionContent === null) return 'missing-heading';

  const newBlock = buildBlock(lines);
  const startIdx = sectionContent.indexOf(DETECTED_START);
  const endIdx = sectionContent.indexOf(DETECTED_END);

  let newSectionContent: string;
  if (startIdx !== -1 && endIdx !== -1) {
    const before = sectionContent.slice(0, startIdx);
    const after = sectionContent.slice(endIdx + DETECTED_END.length);
    newSectionContent = `${before}${newBlock}${after}`;
  } else {
    const rest = sectionContent.trim();
    newSectionContent = rest.length > 0 ? `${newBlock}\n\n${rest}` : newBlock;
  }

  if (newSectionContent === sectionContent) return 'unchanged';

  const updated = applySectionUpdate(markdown, heading, 'replace', newSectionContent);
  atomicWriteFile(absPath, updated);
  return 'written';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/detectedBlock.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/core/detectedBlock.ts tests/core/detectedBlock.test.ts
git commit -m "feat: add generic managed-block insert/refresh primitive"
```

---

### Task 4: `factSync.ts` — the orchestrator

**Files:**
- Create: `src/core/factSync.ts`
- Test: `tests/core/factSync.test.ts`

**Interfaces:**
- Consumes: `detectStack` from `src/core/repoScan.js` (existing), `matchKnownFacts` from `src/core/knownFacts.js` (Task 1), `detectInfraSignals` from `src/core/infraSignals.js` (Task 2), `upsertDetectedBlock` from `src/core/detectedBlock.js` (Task 3), `upsertIndexEntry` from `src/core/memoryIndex.js` (existing), `appendEvent` from `src/core/eventLog.js` (existing — gains `source` field in Task 5, used here already), `withLockSync` from `src/core/lock.js` (existing).
- Produces: `SyncResult` interface (`{ written: string[] }`), `syncDetectedFacts(memoryRoot: string): SyncResult`.

**Note:** this task's tests write a `source: 'auto-detect'` field on the event object before Task 5 formally adds it to the `MemoryEvent` type — TypeScript's structural typing means this compiles fine even before Task 5 widens the interface (an extra property on an object literal passed to a parameter typed as a plain object would normally trigger excess-property-checking, but `MemoryEvent` doesn't declare `source` as absent, it simply doesn't declare it yet - Task 5 must land before this task's typecheck passes cleanly project-wide, so **do Task 5 first if executing out of order**, or accept a transient type error between Task 4 and Task 5 if executing strictly in this document's order within the same PR before running a final `tsc` check).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/core/factSync.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/commands/init.js';
import { syncDetectedFacts } from '../../src/core/factSync.js';

let projectDir: string;
let root: string;
beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'mi-factsync-'));
  root = join(projectDir, '.memoryintel');
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

describe('syncDetectedFacts', () => {
  it('writes matched stack and integration facts into their target files after init', () => {
    runInit(projectDir);
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0', '@sanity/client': '^6.0.0' } })
    );

    const result = syncDetectedFacts(root);

    expect(result.written).toContain('technical/techContext.md');
    expect(result.written).toContain('technical/integrations.md');
    const techContext = readFileSync(join(root, 'technical/techContext.md'), 'utf-8');
    expect(techContext).toContain('Next.js');
    const integrations = readFileSync(join(root, 'technical/integrations.md'), 'utf-8');
    expect(integrations).toContain('Sanity');
  });

  it('writes the explicit "no signal" placeholder to infrastructure.md when nothing is detected', () => {
    runInit(projectDir);
    const result = syncDetectedFacts(root);
    expect(result.written).toContain('technical/infrastructure.md');
    const infra = readFileSync(join(root, 'technical/infrastructure.md'), 'utf-8');
    expect(infra).toContain('No deployment signal found in repo');
  });

  it('writes a detected deployment fact into infrastructure.md when a config file exists', () => {
    runInit(projectDir);
    writeFileSync(join(projectDir, 'vercel.json'), '{}');
    const result = syncDetectedFacts(root);
    expect(result.written).toContain('technical/infrastructure.md');
    const infra = readFileSync(join(root, 'technical/infrastructure.md'), 'utf-8');
    expect(infra).toContain('Vercel');
  });

  it('is idempotent — a second call with no repo changes writes nothing further', () => {
    runInit(projectDir);
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    syncDetectedFacts(root);
    const second = syncDetectedFacts(root);
    expect(second.written).toEqual([]);
  });

  it('records an index entry and an auto-detect event for each file it actually writes', () => {
    runInit(projectDir);
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    syncDetectedFacts(root);

    const index = JSON.parse(readFileSync(join(root, 'memory-index.json'), 'utf-8'));
    expect(index['technical/techContext.md']).toBeDefined();

    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    const factSyncEvents = events.filter((e) => e.type === 'fact-sync');
    expect(factSyncEvents.length).toBeGreaterThan(0);
    expect(factSyncEvents[0].source).toBe('auto-detect');
  });

  it('does nothing when .memoryintel/ was never initialized (no starter files present)', () => {
    // root deliberately not created via runInit - simulates syncDetectedFacts being called
    // against a directory that has no .memoryintel/ structure at all.
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    const result = syncDetectedFacts(root);
    expect(result.written).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/factSync.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/factSync.ts
import { join, dirname } from 'node:path';
import { detectStack } from './repoScan.js';
import { matchKnownFacts } from './knownFacts.js';
import { detectInfraSignals } from './infraSignals.js';
import { upsertDetectedBlock } from './detectedBlock.js';
import { upsertIndexEntry } from './memoryIndex.js';
import { appendEvent } from './eventLog.js';
import { withLockSync } from './lock.js';

export interface SyncResult {
  written: string[];
}

const TARGETS: { relFile: string; heading: string }[] = [
  { relFile: 'technical/techContext.md', heading: 'Stack' },
  { relFile: 'technical/integrations.md', heading: 'External Services' },
  { relFile: 'technical/infrastructure.md', heading: 'Deployment' }
];

// Automatically detects mechanically-verifiable stack/integration/deployment facts and writes
// them into their managed detected-block (Task 3), with zero agent or user action required -
// called from both `load` (every session start) and `check-stop` (when the diff touches a
// manifest file), plus manually via `memoryintel sync`. A no-op (missing-file, no write, no
// event) on any target file `init` hasn't created - this feature is inert on an uninitialized or
// partially-initialized project, never scaffolding structure of its own.
export function syncDetectedFacts(memoryRoot: string): SyncResult {
  const projectRoot = dirname(memoryRoot);
  const stack = detectStack(projectRoot);
  const matched = matchKnownFacts(stack.dependencies);
  const infraLines = detectInfraSignals(projectRoot);

  const contentByTarget: Record<string, string[]> = {
    'technical/techContext.md':
      matched.techContext.length > 0 ? matched.techContext.map((f) => `- ${f}`) : ['_No stack manifest found._'],
    'technical/integrations.md':
      matched.integrations.length > 0
        ? matched.integrations.map((f) => `- ${f}`)
        : ['_No known integrations detected._'],
    'technical/infrastructure.md':
      infraLines.length > 0 ? infraLines.map((f) => `- ${f}`) : ['_No deployment signal found in repo._']
  };

  const written: string[] = [];
  for (const { relFile, heading } of TARGETS) {
    const absPath = join(memoryRoot, relFile);
    const lockPath = `${absPath}.lock`;
    // Same lock-file naming as update()'s per-file locking (`${absPath}.lock`) - a concurrent
    // agent-driven update() and this auto-sync touching the same file correctly serialize
    // against each other instead of racing.
    const result = withLockSync(lockPath, () => upsertDetectedBlock(absPath, heading, contentByTarget[relFile]));

    if (result === 'written') {
      upsertIndexEntry(
        join(memoryRoot, 'memory-index.json'),
        relFile,
        'Auto-detected stack/integration facts (memoryintel sync)'
      );
      appendEvent(join(memoryRoot, 'memory-events.jsonl'), {
        timestamp: new Date().toISOString(),
        type: 'fact-sync',
        summary: `Auto-detected facts written to ${relFile}`,
        affectedFiles: [relFile],
        source: 'auto-detect'
      });
      written.push(relFile);
    }
  }

  return { written };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/factSync.test.ts`
Expected: PASS (6 tests) — may show a TypeScript error on the `source` property until Task 5 lands; if so, complete Task 5 first, then re-run.

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/core/factSync.ts tests/core/factSync.test.ts
git commit -m "feat: add syncDetectedFacts orchestrator"
```

---

### Task 5: Event-log source tagging

**Files:**
- Modify: `src/core/eventLog.ts` (add `source` field to `MemoryEvent`)
- Modify: `src/commands/update.ts:117-122, 128-133, 144-149` (tag all three existing `appendEvent` calls with `source: 'agent'`)
- Modify: `src/commands/status.ts:29` (render the source tag when present)
- Test: `tests/core/eventLog.test.ts` (extend existing file), `tests/commands/status.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MemoryEvent.source?: 'agent' | 'auto-detect'`.

- [ ] **Step 1: Write the failing test**

Read the existing `tests/core/eventLog.test.ts` first (`cat tests/core/eventLog.test.ts`) to match its exact style, then add:

```typescript
// Append to tests/core/eventLog.test.ts
it('accepts and round-trips an optional source field', () => {
  const eventsPath = join(dir, 'events.jsonl');
  appendEvent(eventsPath, {
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'fact-sync',
    summary: 'test',
    affectedFiles: ['technical/techContext.md'],
    source: 'auto-detect'
  });
  const written = JSON.parse(readFileSync(eventsPath, 'utf-8').trim());
  expect(written.source).toBe('auto-detect');
});
```

(Match `dir`/`readFileSync`/`join` imports to whatever the existing test file already imports — it already sets up a temp dir per the codebase's established `beforeEach`/`afterEach` pattern; reuse that fixture rather than creating a new one.)

Also add to `tests/commands/status.test.ts` (read it first to match its existing fixture setup):

```typescript
it('shows the event source when present', () => {
  runInit(projectDir);
  appendEvent(join(root, 'memory-events.jsonl'), {
    timestamp: new Date().toISOString(),
    type: 'fact-sync',
    summary: 'Auto-detected facts written to technical/techContext.md',
    affectedFiles: ['technical/techContext.md'],
    source: 'auto-detect'
  });
  const report = runStatus(root);
  expect(report).toContain('auto-detect');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/eventLog.test.ts tests/commands/status.test.ts`
Expected: FAIL — `source` is not assignable / not rendered

- [ ] **Step 3: Write the implementation**

In `src/core/eventLog.ts`, add the field to the interface:

```typescript
export interface MemoryEvent {
  timestamp: string;
  type: string;
  summary: string;
  affectedFiles: string[];
  domain?: string | null;
  domainSource?: 'explicit' | 'auto' | null;
  totalChars?: number;
  totalLines?: number;
  // Distinguishes an event memoryintel itself wrote from repo evidence (factSync.ts) from one an
  // agent wrote from its own judgment (update.ts) - lets `status`/the dashboard always show which
  // is which, especially when the two might disagree about the same fact.
  source?: 'agent' | 'auto-detect';
}
```

In `src/commands/update.ts`, add `source: 'agent'` to all three existing `appendEvent` call sites (the skipped-write one around line 117, the applied-write one around line 128, and the over-ceiling one around line 144):

```typescript
// First call site (skipped write), inside the `if (w.skipped)` branch:
appendEvent(join(root, 'memory-events.jsonl'), {
  timestamp: new Date().toISOString(),
  type: w.eventType,
  summary: w.reason,
  affectedFiles: [w.relFile],
  source: 'agent'
});

// Second call site (applied write):
appendEvent(join(root, 'memory-events.jsonl'), {
  timestamp: new Date().toISOString(),
  type: w.eventType,
  summary: w.reason,
  affectedFiles: [w.relFile],
  source: 'agent'
});

// Third call site (over-ceiling):
appendEvent(join(root, 'memory-events.jsonl'), {
  timestamp: new Date().toISOString(),
  type: 'over-ceiling',
  summary: reason,
  affectedFiles: [w.relFile],
  source: 'agent'
});
```

In `src/commands/status.ts`, update the event-rendering line:

```typescript
for (const line of eventLines.slice(-5)) {
  const event = JSON.parse(line);
  const sourceTag = event.source ? ` (${event.source})` : '';
  lines.push(`[${event.timestamp}] ${event.type}${sourceTag}: ${event.summary}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/eventLog.test.ts tests/commands/status.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite to check for regressions from the status.ts formatting change**

Run: `npx vitest run`
Expected: PASS — no existing test asserts the exact old `[timestamp] type: summary` format without a source tag in a way a present-but-empty `sourceTag` (empty string when `event.source` is undefined) would break; existing agent-authored events from before this change have no `source` field at all, so `sourceTag` stays `''` for them and the line renders identically to today.

- [ ] **Step 6: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/core/eventLog.ts src/commands/update.ts src/commands/status.ts tests/core/eventLog.test.ts tests/commands/status.test.ts
git commit -m "feat: tag memory events with their source (agent vs auto-detect)"
```

---

### Task 6: Wire `syncDetectedFacts` into `load`

**Files:**
- Modify: `src/commands/load.ts:71-79` (call `syncDetectedFacts` at the top of `runLoad`, before computing `files`)
- Test: `tests/commands/load.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `syncDetectedFacts` from `src/core/factSync.js` (Task 4).

- [ ] **Step 1: Write the failing test**

Read `tests/commands/load.test.ts` first to match its exact fixture/import style, then add:

```typescript
it('auto-detects and includes newly-detected stack facts in the same load call', () => {
  runInit(projectDir);
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0' } }));

  const output = runLoad(projectDir, 'technical');

  expect(output).toContain('Next.js');
});

it('never breaks load if fact detection throws for any reason', () => {
  runInit(projectDir);
  // A package.json that exists but is not valid JSON - detectStack's readJsonSafe already
  // returns null for this (verified in repoScan.ts), so this exercises the "detection found
  // nothing usable" path end-to-end through load rather than load's own error handling.
  writeFileSync(join(projectDir, 'package.json'), 'not valid json');

  expect(() => runLoad(projectDir, 'technical')).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/load.test.ts`
Expected: FAIL — first new test fails (`Next.js` not in output); second passes already (load already has no reason to throw here, confirming this test alone doesn't prove the wiring — the first test is the real one)

- [ ] **Step 3: Write the implementation**

In `src/commands/load.ts`, add the import:

```typescript
import { syncDetectedFacts } from '../core/factSync.js';
```

At the very top of `runLoad`, right after resolving `root` and before the existing `try { ensureDaemonRunning(); ... }` block:

```typescript
export function runLoad(cwd: string, domain?: string): string {
  if (domain !== undefined) assertKnownDomain(domain);

  const root = findMemoryIntelRoot(cwd);
  if (!root) return '';

  try {
    syncDetectedFacts(root);
  } catch {
    // Best-effort, same policy as the daemon-registry call just below - auto-detection must
    // never be the reason a session-start load fails.
  }

  try {
    ensureDaemonRunning();
    upsertRegistryEntry(dirname(root));
  } catch {
    // Dashboard visibility is best-effort — never let it break `load`.
  }

  // ... rest of the function unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/load.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/commands/load.ts tests/commands/load.test.ts
git commit -m "feat: run automatic fact detection at the start of every load"
```

---

### Task 7: Wire into `check-stop`, with a domain-aware nudge

**Files:**
- Modify: `src/adapters/claudeCode.ts` (add manifest-touch detection, call `syncDetectedFacts`, extend the block reason text)
- Test: `tests/adapters/claudeCode.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `syncDetectedFacts` from `src/core/factSync.js` (Task 4); `runGitStatusPorcelain`, `porcelainPath` from `src/core/gitPorcelain.js` (existing, already imported in this file).
- Produces: no new exports — `runCheckStop`'s return shape is unchanged (`{ decision?: 'block'; reason?: string }`), only its `reason` text gains an optional extra sentence.

- [ ] **Step 1: Write the failing test**

Add to `tests/adapters/claudeCode.test.ts` (it already imports `runCheckStop`, `resolveCheckStopMarker`, and has the `initGitRepo`/`commitAll` helpers and `projectRoot`/`memoryRoot` fixture from `beforeEach` — reuse all of that; only difference from the existing tests is these need a *real* `.memoryintel/` with STARTER_FILES, so import `runInit` too):

```typescript
import { runInit } from '../../src/commands/init.js';

// ... inside describe('runCheckStop', ...), add:

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
  writeFileSync(join(projectRoot, 'src.ts'), 'changed');

  const result = runCheckStop(memoryRoot);
  expect(result.decision).toBe('block');
  expect(result.reason).not.toContain('technical/techContext.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/claudeCode.test.ts`
Expected: First new test FAILs (reason doesn't mention `technical/techContext.md` yet); second new test and all 11 pre-existing tests already PASS (confirms the change so far is additive, not yet wired)

- [ ] **Step 3: Write the implementation**

In `src/adapters/claudeCode.ts`, add the import and a small manifest-file set (matching exactly what `detectStack()` in `repoScan.ts` recognizes):

```typescript
import { syncDetectedFacts } from '../core/factSync.js';

const MANIFEST_FILES = new Set(['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml']);
```

Replace the final block-building return in `runCheckStop` (currently a single hardcoded string literal) with:

```typescript
  writeMarker(markerPath, { lastFlaggedDiffSignature: signature });

  let reason =
    "Working tree has changes memory hasn't accounted for. Classify them, write a TOON update-plan, and run `memoryintel update <plan-file>` (see .memoryintel/instructions.md) before finishing - running `memoryintel update` bare, with no plan file, fails. Or finish again to proceed without updating this time.";

  // Mechanism 2 (see docs/superpowers/specs/2026-09-06-automatic-fact-detection-design.md): when
  // the diff touches a manifest file, name specifically what auto-detection just found, so the
  // agent's own follow-up judgment gets a concrete lead instead of only "something changed, go
  // figure out what." This never changes the block/allow decision itself - only the reason text.
  const statusLines = runGitStatusPorcelain(projectRoot);
  const touchesManifest = statusLines !== null && statusLines.some((l) => MANIFEST_FILES.has(porcelainPath(l)));
  if (touchesManifest) {
    const syncResult = syncDetectedFacts(memoryRoot);
    if (syncResult.written.length > 0) {
      reason += ` Also: a manifest file changed — auto-detected facts were just written to ${syncResult.written.join(', ')}. Worth a note elsewhere (e.g. why it was added) if that's not just incidental.`;
    }
  }

  return { decision: 'block', reason };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/claudeCode.test.ts`
Expected: PASS (13 tests — 11 existing + 2 new)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/adapters/claudeCode.ts tests/adapters/claudeCode.test.ts
git commit -m "feat: check-stop names newly-detected facts in its block reason"
```

---

### Task 8: `memoryintel sync` manual command

**Files:**
- Modify: `src/cli.ts` (add `sync` case to `dispatch`, add import, update `USAGE`)
- Test: `tests/cli.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `syncDetectedFacts` from `src/core/factSync.js` (Task 4).

- [ ] **Step 1: Write the failing test**

Add to `tests/cli.test.ts` (it already imports `dispatch` and `runInit`, and has the `mkdtempSync`/`process.chdir` pattern — reuse it):

```typescript
it('documents sync in the usage text', () => {
  const usage = dispatch([]).stdout;
  expect(usage).toContain('sync');
});

it('sync errors cleanly when no .memoryintel/ exists', () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'mi-cli-sync-empty-'));
  const originalCwd = process.cwd();
  process.chdir(emptyDir);
  try {
    const result = dispatch(['sync']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No .memoryintel/ found');
  } finally {
    process.chdir(originalCwd);
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

it('sync reports what it wrote', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'mi-cli-sync-'));
  const originalCwd = process.cwd();
  try {
    runInit(projectDir);
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    process.chdir(projectDir);
    const result = dispatch(['sync']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('technical/techContext.md');
  } finally {
    process.chdir(originalCwd);
    rmSync(projectDir, { recursive: true, force: true });
  }
});
```

Add the needed import at the top of the test file:

```typescript
import { writeFileSync } from 'node:fs';
```

(Check the existing `import { mkdtempSync, rmSync } from 'node:fs';` line at the top of `tests/cli.test.ts` — add `writeFileSync` to that same import instead of a separate line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL — `sync` is an unknown command (falls through to the `default` case, exit code 1 with usage text instead of the expected behavior)

- [ ] **Step 3: Write the implementation**

In `src/cli.ts`, add the import:

```typescript
import { syncDetectedFacts } from './core/factSync.js';
```

Add a `sync` line to the `USAGE` constant, right after the `check-stop` line:

```typescript
  check-stop               Stop-hook check: emit a JSON allow/block decision
  sync                      Re-scan for stack/integration/deployment facts and write any new
                            findings - runs automatically via load/check-stop; this is the
                            manual/debugging entry point
```

Add a `case 'sync':` branch in `dispatch`, right after the existing `case 'check-stop':` branch:

```typescript
    case 'sync': {
      const root = findMemoryIntelRoot(resolveStartDir(argv));
      if (!root) return { exitCode: 1, stdout: '', stderr: 'No .memoryintel/ found.\n' };
      const result = syncDetectedFacts(root);
      const stdout = result.written.length > 0
        ? `root: ${root}\nUpdated: ${result.written.join(', ')}\n`
        : `root: ${root}\nNo changes - detected facts already up to date.\n`;
      return { exitCode: 0, stdout, stderr: '' };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npx vitest run`
Expected: PASS (all tests across the project, confirming Tasks 1–8 integrate cleanly)

- [ ] **Step 6: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: add memoryintel sync command"
```

---

### Task 9: Document the new command and behavior

**Files:**
- Modify: `README.md` (add `sync` to the command reference, and a short paragraph on automatic detection)
- Modify: `.memoryintel/instructions.md` in this repo itself (this project dogfoods memoryintel on itself — the fact-detection behavior now applies to it too, and its `technical/techContext.md`, `technical/integrations.md`, `technical/infrastructure.md` should get the same auto-population as any other project)

**Interfaces:**
- Consumes: nothing (documentation/dogfooding only, no code).

- [ ] **Step 1: Read the current README's command reference section**

Run: `grep -n "memoryintel doctor\|## Install\|memoryintel status" README.md`

Find the exact spot the `doctor` command is documented (from the CLI reference section already read earlier in this plan's research) and add a `sync` entry immediately after it, matching the existing bullet format exactly (command name, one-line description, matching indentation).

- [ ] **Step 2: Add a short paragraph after the "How it works" section**

Insert, right after the existing paragraph that ends with "...never a changelog, always a maintained understanding of the project as it currently is." (found via `grep -n "never a changelog" README.md`):

```markdown
A second, independent mechanism runs alongside the agent-driven one above: every `load` and
`check-stop` call also auto-detects mechanically-verifiable stack, integration, and deployment
facts (a dependency in `package.json`, a `vercel.json`, a `Dockerfile`) and writes them straight
into `technical/techContext.md` / `integrations.md` / `infrastructure.md` — no agent judgment
involved, no user action required. This is deliberately narrower than the agent-driven mechanism:
it only ever asserts what it can prove from a file that's actually there. `memoryintel sync` runs
the same detection by hand, for debugging.
```

- [ ] **Step 3: Run `memoryintel sync` against this repo itself to seed its own memory**

Run: `cd /Users/adeeshsharma/Desktop/memoryintel && npm run build && node dist/cli.js sync`
Expected: reports `technical/techContext.md`, `technical/integrations.md` (or `technical/infrastructure.md`, if this repo has any of the checked config files) as updated — confirms the feature genuinely works against a real, non-synthetic project before this ships.

- [ ] **Step 4: Review the diff to this repo's own `.memoryintel/` files**

Run: `git diff .memoryintel/`
Expected: a new `<!-- memoryintel:detected:start -->` block appears under `technical/techContext.md`'s `## Stack` heading (should show `TypeScript` at minimum, given this project's own `package.json`), and similarly for `integrations.md`/`infrastructure.md` if applicable. Confirm the diff touches only inside the markers, nothing else in either file.

- [ ] **Step 5: Commit**

```bash
cd /Users/adeeshsharma/Desktop/memoryintel
git add README.md .memoryintel/
git commit -m "docs: document memoryintel sync and auto-detection"
```

---

## Self-Review Notes

**Spec coverage:** §2.1 (managed block, insertion rules) → Task 3. §2.2 (mapping table) → Task 1. §2.3 (infra best-effort) → Task 2. §2.4 (when it runs, including manual `sync`) → Tasks 4, 6, 7, 8. §3 (check-stop nudge) → Task 7. §4 (event-log tagging) → Task 5. §5 (testing) → a test file/task per section throughout. §6 (non-goals) → nothing in this plan builds a plugin system, lockfile parsing, or dashboard changes beyond the source-tag rendering already scoped into Task 5.

**Type consistency check:** `SyncResult` (`{ written: string[] }`) is defined once in Task 4 and consumed identically (`result.written`) in Tasks 6, 7, 8 — no renaming across tasks. `DetectedBlockResult`'s four string-literal values (`'written' | 'unchanged' | 'missing-file' | 'missing-heading'`) are defined in Task 3 and only ever compared against `=== 'written'` in Task 4 — the other three values are never separately branched on elsewhere, so there's no drift risk. `MANIFEST_FILES` is defined once, locally, in Task 7's file (`claudeCode.ts`) — not shared with `repoScan.ts`'s own internal manifest checks, which is fine since both lists are independently kept in sync with the same five filenames by inspection (noted in Global Constraints); a future change to one without the other is the one drift risk worth a human's attention during review, not something this plan can enforce structurally without over-engineering a shared-constant module for five string literals.
