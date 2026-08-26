## Overview

Three zones: this project's own `.memoryintel/`, the machine-wide `~/.memoryintel/` shared across
every Memory-Intel project on the machine, and the plugin that wires the two together. Full
diagrams and sequence walkthroughs live in `docs/architecture/memory-intel-architecture.html`
(published as a Claude Artifact — see that file's own footer for the link, or regenerate it via
`docmanager`).

## Components

- **CLI** (`src/cli.ts` + `src/commands/*.ts`) — the only thing that touches disk. `init`, `load`,
  `update`, `status`, `check-stop`, `dashboard enable`/`disable`, `daemon start`.
- **Skill** (`skills/memory-intel/SKILL.md`) — generated from `src/skill.ts`, which imports the
  CLI's own `USAGE` string as its single source of truth (`npm run build` regenerates it;
  `npm run build:skill:check` detects drift).
- **Plugin hooks** (`hooks/hooks.json`) — `SessionStart` runs `npx -y memoryintel load`; `Stop`
  runs `npx -y memoryintel check-stop`. Plugin-wide, never written into a project's own
  `.claude/settings.json`.
- **Section writer** (`src/core/sectionWriter.ts`) — deterministic, heading-addressed
  append/replace/create-section, with dedup and fuzzy-suggestion-on-reject.
- **TOON codec** (`src/core/toon.ts`) — the LLM↔CLI serialization boundary for `update`'s plan
  rows.
- **Daemon/dashboard** (`src/daemon/*`) — a lazily-started, read-only local HTTP server; one
  global on/off switch, not per-project.
- **Adapters** — `src/adapters/claudeCode.ts` (the Stop-hook live-diff nudge, self-compression's
  git-clean gate) and `src/adapters/genericPointer.ts` (pointer files for tools without native
  hooks: Cursor, Codex/Gemini via `AGENTS.md`/`GEMINI.md`).

## Data Flow

`load()` reads the always-loaded content files (plus any requested domain files) → builds a TOON
manifest (headings, line count, compression ceiling, over/under status) + concatenated content →
this becomes `SessionStart`'s stdout, injected as context.

An agent drafts a TOON update-plan → `update()` validates every row against current disk state,
then writes atomically (temp-file + rename) under a file lock → logs to `memory-events.jsonl` and
`memory-index.json` → resolves the check-stop marker to the diff signature at that moment.

## Integrations

Git, via `src/core/gitPorcelain.ts` — used both for the Stop-hook's diff signature and for
self-compression's git-clean gate. Otherwise just Node's `fs`/`child_process` built-ins. No
external services, no network calls anywhere in the CLI itself.
