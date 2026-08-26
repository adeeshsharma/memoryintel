# Init Slash Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (no subagent-driven-development needed — this plan is small, static-file-only, and was explicitly approved for direct/no-worktree execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Claude Code slash command (`/memory-intel:init`) that bootstraps Memory Intel for a project, closing the gap between the PRD's stated UX and what exists today (a terminal-only CLI).

**Architecture:** A new, separate Claude Code plugin — `plugin/.claude-plugin/plugin.json` + `plugin/skills/init/SKILL.md` — added as its own top-level directory in this repo, untouched by and not touching `src/`/`tests/`. The command is a thin UX layer: it instructs Claude to run the already-built, already-tested `memoryintel init` CLI command via Bash, then summarize the result. No new CLI logic.

**Tech Stack:** Static Markdown + JSON only — no TypeScript, no test framework. There is nothing to unit test; verification is direct inspection plus one real manual run of the underlying CLI command (already covered by the existing suite).

**Spec:** `docs/superpowers/specs/2026-08-21-init-slash-command-design.md`

## Global Constraints

- Plugin `name` must be exactly `memory-intel` (this fixes the resulting command to `/memory-intel:init`).
- This plan does not touch `src/`, `tests/`, or the existing per-project hook-wiring (`wireClaudeCodeHooks`) in any way.
- Only one command (`init`) — `load`/`update`/`status` stay agent-invoked, not user-typed.

---

### Task 1: Create the plugin

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`
- Create: `plugin/skills/init/SKILL.md`

**Interfaces:** None — no code, no exports. This task's only "interface" is the resulting slash command name (`/memory-intel:init`), which depends on `plugin.json`'s `name` field exactly matching `memory-intel`.

- [ ] **Step 1: Write `plugin/.claude-plugin/plugin.json`**

```json
{
  "name": "memory-intel",
  "description": "Persistent project memory for AI coding agents — initialize once, then agents automatically load and update project understanding across sessions.",
  "version": "0.1.0"
}
```

- [ ] **Step 2: Write `plugin/skills/init/SKILL.md`**

```markdown
---
description: Initialize Memory Intel for the current project. Use when the user asks to set up, initialize, install, or bootstrap Memory Intel.
allowed-tools: Bash(memoryintel init:*)
---

Run `memoryintel init` now, using the Bash tool, in the current project's root directory. This is
a one-time setup step. If `.memoryintel/` already exists, this is safe to re-run — it only fills in
anything missing, it never overwrites existing content.

Once it completes, briefly confirm to the user that Memory Intel is set up: mention that
`.memoryintel/` was created, and which per-tool integrations got wired (Claude Code hooks if
`.claude/` is present, plus pointer files for other tools like Cursor/Codex/Gemini). Do not
narrate implementation internals beyond that — a short confirmation is enough.
```

- [ ] **Step 3: Verify the files are syntactically valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/plugin.json', 'utf-8')); console.log('plugin.json OK')"`
Expected: prints `plugin.json OK` with no error.

Run: `node -e "const fs=require('fs'); const c=fs.readFileSync('plugin/skills/init/SKILL.md','utf-8'); if (!c.startsWith('---')) throw new Error('missing frontmatter'); console.log('SKILL.md frontmatter OK')"`
Expected: prints `SKILL.md frontmatter OK` with no error.

- [ ] **Step 4: Verify the underlying CLI command this plugin delegates to still works**

Run: `npx vitest run tests/commands/init.test.ts tests/cliBinary.test.ts`
Expected: PASS — confirms `memoryintel init` (what the slash command actually invokes) is unaffected and working, since this plan added no CLI code.

- [ ] **Step 5: Commit**

```bash
git add plugin/
git commit -m "feat: add /memory-intel:init Claude Code plugin command"
```

---

## Self-Review Notes

**Spec coverage:** §3's plugin structure, manifest contents, and SKILL.md behavior → Task 1 Steps 1-2. §4's "no hooks, no other commands, no publishing" → confirmed by what's absent from Task 1 (nothing else is created). §5's verification approach → Task 1 Steps 3-4.

**No placeholders found** on final read-through.
