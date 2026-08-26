# Memory Intel Skill + README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (small, approved for direct/no-worktree execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrow `/memory-intel:init` plugin (superseded) with the same generated-skill + README pattern this user's other tools (docmanager, lavish, reactive-editor) use, so Memory Intel is installable via `npx skills add` and documented for the first time.

**Architecture:** `src/skill.ts` exports a pure `createSkillMarkdown()` function that embeds the CLI's own exported `USAGE` string, so the two can never drift apart. `scripts/build-skill.js` (plain JS, run after `tsc`) writes the generated content to `skills/memory-intel/SKILL.md`, with a `--check` mode for drift detection. `package.json` gains a `files` field and build-skill scripts. A new top-level `README.md` documents installation and usage. The old `plugin/` directory is removed.

**Tech Stack:** Same as the existing codebase (TypeScript, Node >=18, Vitest) for the one new pure function; plain ESM JS for the build script, matching the reference tools' convention.

**Spec:** `docs/superpowers/specs/2026-08-21-skill-and-readme-design.md`

## Global Constraints

- `scripts/build-skill.js` imports from **compiled** `dist/`, never from `src/` directly — it must run after `tsc`, and `npm run build` must reflect that ordering.
- No change to `wireClaudeCodeHooks`, `installPointerAdapters`, or any other existing CLI command's behavior.
- The generated `skills/memory-intel/SKILL.md` is committed to the repo, not generated at install/publish time.

---

### Task 1: `createSkillMarkdown()` + export `USAGE`

**Files:**
- Modify: `src/cli.ts` (export the existing `USAGE` constant — no other change)
- Create: `src/skill.ts`
- Test: `tests/skill.test.ts`

**Interfaces:**
- Produces: `createSkillMarkdown(): string` — consumed by `scripts/build-skill.js` (Task 2, via the compiled `dist/skill.js`).

- [ ] **Step 1: Export `USAGE` from `src/cli.ts`**

Change `const USAGE = ...` to `export const USAGE = ...` — this is the only edit to this file. Everything else in `src/cli.ts` stays exactly as-is.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/skill.test.ts
import { describe, it, expect } from 'vitest';
import { createSkillMarkdown } from '../src/skill.js';
import { USAGE } from '../src/cli.js';

describe('createSkillMarkdown', () => {
  it('starts with YAML frontmatter naming the skill', () => {
    const md = createSkillMarkdown();
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('name: memory-intel');
  });

  it('includes a description mentioning both trigger conditions', () => {
    const md = createSkillMarkdown();
    expect(md).toMatch(/description:.*persistent project memory/i);
    expect(md).toMatch(/description:.*\.memoryintel/);
  });

  it('tells the agent how to bootstrap a fresh project', () => {
    const md = createSkillMarkdown();
    expect(md).toContain('memoryintel init');
  });

  it('points to instructions.md as the per-project authority once initialized', () => {
    const md = createSkillMarkdown();
    expect(md).toContain('.memoryintel/instructions.md');
  });

  it('embeds the real CLI USAGE text verbatim, so the two can never drift apart', () => {
    const md = createSkillMarkdown();
    expect(md).toContain(USAGE);
  });

  it('documents a sandboxed-environment fallback that does not assume npx/global install', () => {
    const md = createSkillMarkdown();
    expect(md).toMatch(/node .*dist\/cli\.js/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/skill.test.ts`
Expected: FAIL — `src/skill.ts` doesn't exist yet.

- [ ] **Step 4: Write `src/skill.ts`**

```typescript
// src/skill.ts
import { USAGE } from './cli.js';

export function createSkillMarkdown(): string {
  return `---
name: memory-intel
description: Give an AI coding agent persistent, cross-session project memory. Use when the user asks to set up persistent project memory, or when the current project already contains a .memoryintel/ directory.
---

# Memory Intel

Memory Intel gives an AI coding agent durable, cross-session understanding of a project —
architecture, decisions, progress, and a running "mental model" — that survives new chats, new
agent sessions, and switching tools entirely (Claude Code, Cursor, Codex, Gemini CLI).

## First time in this project? (no \`.memoryintel/\` yet)

If the user asks to set up persistent project memory, run:

    npx -y memoryintel init

This is a one-time step. It scaffolds \`.memoryintel/\`, wires automatic Claude Code hooks, and
installs pointer files for other tools — safe to re-run later, it never overwrites existing content.

## Already initialized? (\`.memoryintel/\` exists)

Read \`.memoryintel/instructions.md\` first — it is the authoritative, per-project guide. In short:

- At the start of a session: run \`memoryintel load [--domain technical|business|research]\` and
  treat the output as project context.
- At the end of a session, only if your work changed real project understanding (new architecture,
  decision, feature, integration, or roadmap item — never for formatting/typos): draft an
  update-plan and run \`memoryintel update\`.
- If the user asks to turn the dashboard on or off: \`memoryintel dashboard enable\` /
  \`memoryintel dashboard disable\`.

## Command reference

${USAGE}
## Sandboxed environments

If \`npx\`/a global \`memoryintel\` install aren't directly runnable, fall back to invoking the
package's built CLI directly: \`node "$(npm root -g)/memoryintel/dist/cli.js" <command>\`.
`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/skill.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/skill.ts tests/skill.test.ts
git commit -m "feat: add createSkillMarkdown, sourced from the CLI's own USAGE text"
```

---

### Task 2: Build pipeline, generated skill, package.json, README, remove old plugin

**Files:**
- Create: `scripts/build-skill.js`
- Create: `skills/memory-intel/SKILL.md` (generated by the script, not hand-written)
- Create: `.claude-plugin/plugin.json` (moved/rewritten from the superseded `plugin/.claude-plugin/plugin.json`)
- Create: `README.md`
- Modify: `package.json`
- Delete: `plugin/` (the entire directory from the superseded spec)

**Interfaces:**
- Consumes: `createSkillMarkdown` (Task 1, via the compiled `dist/skill.js` — not imported directly from `src/`).

- [ ] **Step 1: Remove the superseded plugin directory**

```bash
git rm -r plugin/
```

- [ ] **Step 2: Write `scripts/build-skill.js`**

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillMarkdown } from '../dist/skill.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outPath = join(projectRoot, 'skills', 'memory-intel', 'SKILL.md');
const content = createSkillMarkdown();
const checkMode = process.argv.includes('--check');

if (checkMode) {
  const existing = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : null;
  if (existing !== content) {
    console.error('skills/memory-intel/SKILL.md is out of date. Run `npm run build:skill` to regenerate it.');
    process.exit(1);
  }
  console.log('skills/memory-intel/SKILL.md is up to date.');
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
  console.log(`Wrote ${outPath}`);
}
```

- [ ] **Step 3: Update `package.json`**

```json
{
  "name": "memoryintel",
  "version": "0.1.0",
  "type": "module",
  "bin": { "memoryintel": "./dist/cli.js" },
  "files": ["dist", "skills", ".claude-plugin"],
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/build-skill.js",
    "build:skill": "node scripts/build-skill.js",
    "build:skill:check": "node scripts/build-skill.js --check",
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

- [ ] **Step 4: Run the build and generate the skill for the first time**

Run: `npm run build`
Expected: `tsc` succeeds, then `node scripts/build-skill.js` prints `Wrote <path>/skills/memory-intel/SKILL.md`.

- [ ] **Step 5: Verify the generated file and the drift check**

Run: `npm run build:skill:check`
Expected: prints `skills/memory-intel/SKILL.md is up to date.` and exits 0 (proves the `--check` path works and the committed-vs-generated content matches right after generation).

Read the generated `skills/memory-intel/SKILL.md` to confirm it looks correct (real content, not a template artifact) before committing it.

- [ ] **Step 6: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "memory-intel",
  "description": "Persistent project memory for AI coding agents — initialize once, then agents automatically load and update project understanding across sessions.",
  "version": "0.1.0"
}
```

Verify: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json', 'utf-8')); console.log('OK')"` prints `OK`.

- [ ] **Step 7: Write `README.md`**

```markdown
# Memory Intel

Persistent, cross-session project memory for AI coding agents. Run it once per project; after
that, agents automatically load and update project understanding — architecture, decisions,
progress, a running "mental model" — across new chats, new sessions, and even across tools
(Claude Code, Cursor, Codex, Gemini CLI).

## Quick Start

```bash
npx skills add <owner>/<repo> --skill memory-intel
```

This installs the agent skill that teaches Claude (or any compatible agent) when and how to use
Memory Intel — including bootstrapping a project the first time you ask it to.

## Installing the CLI

The skill above prefers `npx -y memoryintel <command>` and doesn't require a global install. If you
want `memoryintel` directly on your PATH:

```bash
npm install -g memoryintel
```

Or from source:

```bash
git clone <this-repo-url>
cd memoryintel
npm install
npm run build
npm link
```

## Usage

Once installed, run this once per project:

```bash
memoryintel init
```

That's it — no other command to remember. `memoryintel init` scaffolds `.memoryintel/`, wires
automatic Claude Code hooks, and installs pointer files for other tools. From then on, agents load
and update project memory on their own, per `.memoryintel/instructions.md`.

If a shared local dashboard is running (a read-only view of every initialized project on this
machine), turn it off any time with `memoryintel dashboard disable` — or back on with
`memoryintel dashboard enable`.

## How it works

Full design docs live in `docs/superpowers/specs/`. In short: `.memoryintel/` is a structured,
git-committed set of markdown/JSON files an agent reads at session start and selectively updates at
session end — never a changelog, always a maintained understanding of the project as it is now.
```

- [ ] **Step 8: Run the full test suite one final time**

Run: `npx vitest run`
Expected: PASS — this task touched no CLI test-covered behavior, only packaging/docs.

- [ ] **Step 9: Commit**

```bash
git add scripts/ skills/ .claude-plugin/ package.json README.md
git commit -m "feat: generate the memory-intel skill, add build pipeline, README, and plugin manifest"
```

---

## Self-Review Notes

**Spec coverage:** §3's file layout, `src/skill.ts` content, `scripts/build-skill.js` behavior, `package.json` changes, `.claude-plugin/plugin.json`, and `README.md` structure → Tasks 1–2 directly. §2's two confirmed decisions (whole-workflow scope, hooks stay combined) → reflected in `src/skill.ts`'s content (mentions dashboard + session model, no `setup hooks` command) and by Task 2 not touching `init.ts`. §4's non-goals → confirmed by what Task 2 does NOT do (no npm publish, no `setup hooks`, no `wireClaudeCodeHooks` changes).

**Type consistency checked:** `createSkillMarkdown(): string` signature matches its Task 1 definition and Task 2's `build-skill.js` import exactly. `USAGE`'s export in `src/cli.ts` is the only change to that file — confirmed no other line moves.

**No placeholders found** on final read-through, except the intentional `<owner>/<repo>` and `<this-repo-url>` placeholders in `README.md`, which the human partner fills in once this repo has a remote — called out explicitly in §3's design text, not an oversight.
