# Memory Intel — Design Spec

Status: approved for planning
Companion to: `prd.md` (amended 2026-08-20 — Web dashboard moved from MVP Excluded to Included)

## 1. Relationship to existing tools

This machine already runs claude-mem (session observations, timeline) and context-mode (FTS5 knowledge base). Memory Intel is **independent and tool-agnostic** — no dependency on either. The overlap is incidental to this environment; Memory Intel's differentiator is a structured, file-based store that works identically across Claude Code, Cursor, Codex, Gemini CLI, opencode, and pi.

## 2. Architecture overview

One Node/TS CLI package (`memoryintel`) owns the entire `.memoryintel/` file format and all reads/writes. It contains **zero LLM calls and zero "understanding" logic** — all reasoning (what changed, whether it matters, which files it affects, what to write) happens in the calling agent's own context, guided by `instructions.md`. Per-tool "adapters" are wiring only, not duplicated logic.

```
memoryintel (CLI, one codebase)
 ├── init             → scaffolds .memoryintel/ from templates
 ├── load             → resolves+prints context per loading strategy
 ├── update           → applies an agent-authored update-plan, dedupes, logs event
 ├── status           → human-debug: index/mental-model/last-event summary
 ├── dashboard enable  → flips global dashboardEnabled = true
 ├── dashboard disable → flips global dashboardEnabled = false, stops daemon if running
 └── daemon start      → starts the local web dashboard daemon (usually auto-invoked)

Claude Code / pi  → settings.json hooks call `load` (SessionStart) and nudge `update` (Stop)
Cursor / Codex / Gemini / opencode → instructions.md linked from that tool's native context file
```

## 3. Components → CLI commands

Mapping the PRD's six components onto the CLI:

- **Memory Discovery Engine** = `load`'s first step: walk up from cwd looking for `.memoryintel/` (like git finds `.git`). Not found → exit quietly, agent proceeds with no memory context.
- **Memory Loader** = the rest of `load`: always reads `currentMentalModel.md` + `activeContext.md`; conditionally reads the technical/business/research trio per the PRD's loading-strategy table, selected via `--domain <technical|business|research>` (a cheap one-time judgment call by the agent, not a separate classifier). Output is concatenated to stdout with `--- FILE: path ---` separators, plus the current heading list per file (see §4).
- **Change Analyzer + Classification Engine + Update Planner** = *not CLI code* — pure agent reasoning at session end, steered by `instructions.md`, producing the update-plan the PRD already specifies.
- **Memory Writer** = `update <plan>`: for each plan entry, apply `append`/`replace`/`create-section` (§4) to the named section, skip near-duplicate content, append one line to `memory-events.jsonl`, update `memory-index.json`.

`init` scaffolds the entire tree from the PRD, including `intelligence/*.json` as empty stubs — untouched by `update` until V3 (out of MVP scope).

### Data serialization

- **LLM ↔ CLI boundary** (update-plan in, `load`/`status` structured output out): **TOON** — token-efficient for the uniform arrays of objects both directions produce.
- **On-disk durable storage** (`memory-config.json`, `memory-index.json`, `memory-events.jsonl`, global `registry.json`/`settings.json`): **JSON/JSONL** — no LLM tokenizes these directly; standard tooling (`jq`, git diff) works better with plain JSON.
- **Context files** (`context/*.md`, etc.): plain prose markdown.

## 4. Deterministic section addressing (Memory Writer internals)

Context/technical/business/research files are flat lists of `## Heading` sections. The Writer addresses them by **heading-name match** — no LLM parsing needed.

- `action` is one of **`append`, `replace`, `create-section`**. Only `create-section` may add a brand-new heading. `append`/`replace` require an exact (normalized: trimmed, case-folded, whitespace-collapsed) match to an *existing* heading — no match → the entry is **rejected**, not silently turned into a new near-duplicate heading.
- On rejection, the CLI runs a cheap string-similarity check against the file's existing headings and returns a suggestion (`"did you mean '## Auth'?"`) — the agent gets one corrected retry.
- Boundary detection only treats `##` as a section boundary; deeper heading levels (`###`+) are content within a block, never split it.
- Duplicate heading names within one file are a Writer error, surfaced rather than silently resolved.
- A near-duplicate content check (normalized substring match) skips writes that don't add new information, logging `"skipped-duplicate"` instead.
- `create-section` targeting an already-existing (normalized) heading silently degrades to `append` — never causes duplication.
- `init` seeds each technical/business/research file with a small fixed starter vocabulary of headings (e.g. `architecture.md` → Overview, Components, Data Flow, Integrations) so the agent has real target vocabulary from day one.
- `currentMentalModel.md` is a special case: every update **fully overwrites** it from a `content` field (no section addressing) — it represents current understanding, not accreted history.
- `load`/`status` always echo the current heading list per file, so the agent sees ground truth every time rather than recalling it from `instructions.md`.

Net effect: drift requires an agent to ignore the heading list it was handed, ignore a fuzzy-match rejection, *and* still explicitly choose `create-section` — three deliberate steps instead of one silent miss.

## 5. Session lifecycle

**Start** (hook or agent-invoked): `memoryintel load [--domain X]` → CLI finds `.memoryintel/`, reads always-load + domain files, prints markdown + heading manifest to stdout.

**End** (Stop-hook nudge, or `instructions.md`-driven elsewhere): agent reviews its own session (files touched, git diff, conversation) → decides if anything is memory-worthy (PRD Rule 1/2) → if yes, drafts a TOON update-plan → pipes to `memoryintel update` → Writer applies it per §4, logs the event, bumps the index → agent separately overwrites `currentMentalModel.md` via the same call. No meaningful change → no `update` call at all, silent no-op.

## 6. Per-tool adapters

- **Claude Code & pi** (real hooks, wired by `init`): `SessionStart` hook runs `memoryintel load`; also writes a transient session marker (session id, timestamp, git HEAD). `Stop` hook runs `memoryintel check-stop` — a deterministic (non-semantic) check: working tree changed since the marker AND `update` not called since then → block the stop once with a nudge message; allow it if the agent stops again anyway (no infinite loop).
- **Cursor**: `init` writes/updates `.cursor/rules/memoryintel.mdc` (`alwaysApply: true`) pointing at `instructions.md`. Best-effort, no enforcement.
- **Codex / Gemini CLI / opencode**: `init` detects which native auto-loaded file already exists (`AGENTS.md`, `GEMINI.md`, etc.) and appends the same pointer block to each; creates `AGENTS.md` if none exist. Best-effort, no enforcement.

All adapters point at the same `instructions.md` — no duplicated logic.

## 7. Error handling & edge cases

- **Missing `.memoryintel/`**: `load` no-ops silently, exit 0.
- **Corrupt JSON**: CLI errors clearly to stderr, exits non-zero; hook wrapper treats this as "no context" and lets the session continue.
- **Atomic `update`**: whole plan validates (schema + §4 rules) before any file is touched; any invalid entry rejects the entire call — no partial-applied state. Implemented via temp-write + rename.
- **Concurrent sessions**: `update` takes a file lock (`.memoryintel/.lock`) with short retry/backoff. `load` is read-only, needs no lock.
- **Path safety**: update-plan `file` values are validated against the fixed known set of `.memoryintel/**` paths; anything else is rejected.
- **Git merge conflicts**: not special-cased — ordinary conflict markers in markdown, resolved like any other file; `instructions.md` tells the agent to resolve conflicts before calling `update` again.
- **Stop-hook nudge loop**: nudges once per session, never blocks indefinitely.
- **Re-running `init`**: idempotent — never overwrites existing content, only fills in files missing from an older init. Adapter pointer blocks are wrapped in a marker comment to avoid duplication on re-run.
- **`memory-events.jsonl` growth**: accepted MVP limitation, no rotation — plain append log, git-diffable.

## 8. Web dashboard

**Scope**: read-only observability. No write path from the UI — matches PRD Principle 1 ("agents manage memory, not users"). If a user wants a correction, they tell the agent, same as today.

**Runtime**: single global daemon (`memoryintel daemon start`), not one per project — matches "one dashboard for all project views." Listens on a fixed local port, auto-picks the next free one if taken (default search starts above docmanager's 4389), records port + pid in `~/.memoryintel/daemon.json`.

**Lazy self-start (not init-only)**: `load` and `update` — not just `init` — each check for a live daemon (port + pid from `daemon.json`, verifying the pid is actually alive) before their real work; if absent, they spawn it detached and continue without blocking. Covers reboots, daemon crashes, and first-ever CLI use on this machine for a project that was `init`'d elsewhere (since `.memoryintel/` is git-committed, a teammate's clone never ran `init` locally).

**Registry**: `~/.memoryintel/registry.json` — global, one entry per project: `{path, initializedAt, lastSessionAt, toolsWired}`. Upserted by `init`, `load`, and `update` alike (not `init`-only), for the same clone-without-init reason above. `toolsWired` is computed, not asserted: each upsert re-checks for the presence of each adapter's artifact in the project (Claude Code/pi hook entries in `.claude/settings.json`, `.cursor/rules/memoryintel.mdc`, the pointer block in `AGENTS.md`/`GEMINI.md`) and records which ones currently exist — so the dashboard's automation-status panel always reflects the real filesystem state, not a cached assumption from `init` time.

**Global enable/disable**: `~/.memoryintel/settings.json` → `{ "dashboardEnabled": true }` (default true).
- `memoryintel dashboard disable` — flips the flag **and actively stops the daemon** if running (via its recorded pid). A real off-switch, not just "stop auto-starting."
- `memoryintel dashboard enable` — flips the flag back; doesn't force-start immediately, next `load`/`update` anywhere lazily restarts it.
- `load`/`update`'s self-healing daemon check reads this flag first; if disabled, skip all daemon contact, everywhere.
- Taught via `instructions.md`: if the user asks to turn off the dashboard, run `memoryintel dashboard disable`, **and tell the user this affects the shared dashboard for all Memory Intel projects on this machine**, not just the current one — the blast radius is bigger than a per-project setting would suggest.

**Rendering**: server-rendered HTML on each request, reading directly off each project's `.memoryintel/*` files (no separate DB/cache — files are small and local). Deliberately not a client-side SPA; read-only scope doesn't need it, and it keeps the build far simpler than claude-mem's bundled-React approach. Staleness/health computed on the fly from file mtimes vs. `memory-index.json` timestamps.

**Views**:
1. Registry landing page — every known project, health at a glance, click to open.
2. Project view — mental-model hero panel; context/technical/business/research file browsers; event timeline (`memory-events.jsonl`, filterable by type); per-tool automation-status panel (which of Claude Code/pi/Cursor/Codex/Gemini/opencode are actually wired for this project).

**Design quality bar**: this is a real product surface, not a debug page — implementation must invoke the `frontend-design` skill when building the actual views (typography, layout, hierarchy, color), independent of the server-rendered (non-SPA) architecture choice above.

**Error handling additions**: registry entry whose path no longer exists → shown as "missing," not a crash. Port conflict → auto-picks next free port. Dashboard reading mid-`update` → safe, since §7's atomic temp-write+rename means it never observes a half-written file.

## 9. Testing strategy

**CLI (unit + integration testable)**:
- Unit: heading-match/normalize logic, block-boundary detection, dedup heuristic, fuzzy-suggestion on rejected sections, TOON encode/decode of update-plans, path-safety validation, atomic-write-or-nothing behavior.
- Integration: `init` → `load` → `update` → `load` round trip against a fixture project; the §7 edge cases directly (corrupt JSON, lock contention, malformed plan, idempotent re-init, duplicate-heading rejection).
- Adapter wiring: `init` writes correct hook entries into a fixture `settings.json` and correct pointer blocks into fixture `AGENTS.md`/`.cursor/rules`, without executing real Claude Code/Cursor.
- Dashboard: integration tests spin the daemon against fixture projects, hit its HTTP endpoints, assert rendered output contains expected mental-model/events/staleness content. No full browser/e2e needed for read-only server-rendered pages.

**Agent reasoning (classification/planning — not code)**:
- No automated test for "was this classified correctly" — that's judgment, owned by the agent per the PRD.
- Quality control is scenario-based manual/eval review: scripted sessions (e.g. "add JWT refresh," "fix a typo," "rename a variable") run against real `instructions.md`, checking the resulting update-plans match expected trigger/no-trigger and correct file/section targeting. This is how `instructions.md` gets refined — like a prompt, not like code.

## 10. Out of scope for this spec

Semantic retrieval, knowledge graph, MCP server — dropped from the PRD's
roadmap entirely (not deferred; not needed for this tool's purpose). The one
real next-phase item is self-compression of `.memoryintel/` content as it
grows, designed separately (see `docs/superpowers/specs/` for the
self-compression design once written).
