# Memory Intel Skill + README — Design Spec

Status: approved for planning
Supersedes: `docs/superpowers/specs/2026-08-21-init-slash-command-design.md` and the `plugin/` directory it produced. That design used a Claude-Code-plugin-only slash command (`/memory-intel:init`, narrow to `init`). Investigation of how this user's other tools (docmanager, lavish, reactive-editor) are actually packaged surfaced a more complete, consistent convention — this spec adopts that convention instead.

## 1. The real pattern (found by inspecting docmanager-axi, lavish-axi, reactive-axi)

One package = CLI + `skills/<name>/SKILL.md` + `.claude-plugin/plugin.json`, all at the package root, all listed in `package.json`'s `"files"`. The skill is:
- **Generated, not hand-written.** A `src/skill.ts` exports `createSkillMarkdown()`, built from the same command-reference string the CLI's own `--help`/no-args output uses (no drift between "what the tool does" and "what the skill says it does"). `scripts/build-skill.js` writes the generated file; a `--check` mode compares against the committed file so CI can catch staleness without silently overwriting local edits.
- **Distributed independently of the CLI itself**, via `npx skills add <owner>/<repo> --skill <name>` — this only needs the skill file, not a working CLI install first. The skill's own instructions default to `npx -y <pkg> <command>` so the agent never assumes a global install.
- **Scoped to the whole tool**, not one subcommand — it teaches an agent what the tool is, when to bootstrap it, and where to find the authoritative per-project detail afterward.

## 2. Decisions (confirmed with the human partner)

- **Skill scope: whole workflow.** One skill, covering `init`, the session-start/session-end model, and the dashboard toggle — not narrowed to just `init`.
- **Hooks stay combined.** `memoryintel init` keeps doing both scaffolding and hook-wiring in one call, unlike the reference tools' separate `setup hooks` command. Not changing already-tested `init.ts` behavior just to match a convention with no functional benefit here.

## 3. Design

### File layout (package root)

```
.claude-plugin/plugin.json     — minimal manifest (name, description, version)
skills/memory-intel/SKILL.md   — generated, committed
src/skill.ts                   — createSkillMarkdown(): string — the source of truth
scripts/build-skill.js         — writes (or --check verifies) skills/memory-intel/SKILL.md
README.md                      — new; Quick Start + install alternatives + brief usage
```

The previous `plugin/` directory (from the superseded spec) is removed entirely — its one command (`init`) is now covered by the whole-workflow skill instead.

### `src/skill.ts`

Exports `createSkillMarkdown(): string`. Imports `USAGE` from `src/cli.ts` (exported for this purpose) and embeds it verbatim as the "Command reference" section — this is the literal mechanism that keeps the skill from drifting out of sync with the CLI's own command list.

Content sections: what Memory Intel is (one paragraph); first-time-in-a-project guidance (`npx -y memoryintel init`, what it does); already-initialized guidance (read `.memoryintel/instructions.md` as the per-project authority; summarize session-start/session-end in a few lines, without duplicating instructions.md's full detail); the embedded command reference; a sandboxed-environment fallback note (`node "$(npm root -g)/memoryintel/dist/cli.js" <command>` if `npx`/a global `memoryintel` aren't runnable).

Frontmatter: `name: memory-intel`, and a `description` written for auto-triggering — mentions both "the user asks to set up persistent project memory" and "the project contains a `.memoryintel/` directory" as trigger conditions, matching how e.g. graphify's skill triggers on `graphify-out/` existing.

### `scripts/build-skill.js`

Plain ESM JS (not compiled) run via `node scripts/build-skill.js`, importing from the **compiled** `dist/cli.js`/`dist/skill.js` (so it must run after `tsc`, never before). Two modes:
- Default: write `skills/memory-intel/SKILL.md`.
- `--check`: compare generated content against the committed file; exit non-zero with a message if they differ, without writing.

### `package.json`

- `"build"` becomes `"tsc -p tsconfig.json && node scripts/build-skill.js"`.
- New scripts: `"build:skill"` (regenerate only), `"build:skill:check"` (CI drift check).
- New `"files"` field: `["dist", "skills", ".claude-plugin"]` — this is also the fix for a previously-deferred gap (no `files` field meant `npm pack` would have shipped an empty package despite the `bin` entry).

### `.claude-plugin/plugin.json`

```json
{ "name": "memory-intel", "description": "...", "version": "0.1.0" }
```

No hooks bundled here — hook-wiring stays per-project via `memoryintel init` (decision above), not plugin-level. This manifest exists so the package is also a valid, marketplace-free Claude Code plugin (an npm install alone makes it one) — consistent with the reference tools, even though nothing currently depends on that path.

### `README.md`

First one this repo has had. Structure, mirroring the reference tools:
1. One-paragraph description of what Memory Intel is and the problem it solves (drawn from the PRD's own framing).
2. **Quick Start**: `npx skills add <owner>/<repo> --skill memory-intel` as the headline install (owner/repo left as a placeholder the human partner fills in once this is pushed somewhere — this repo has no remote configured yet).
3. Alternate install paths: global npm install (`npm install -g memoryintel` — once published) and from-source (`git clone`, `npm install`, `npm run build`, `npm link`).
4. Usage overview: one-time `memoryintel init`, then automatic behavior — no other commands to remember.
5. A short "How it works" pointer to the design docs (`docs/superpowers/specs/`) for anyone wanting the full architecture, rather than duplicating it in the README.

## 4. Non-goals

- Not publishing to npm or registering a marketplace entry — this spec only produces the files; actually publishing is a separate, later decision.
- Not adding a `setup hooks` command (decision above).
- Not changing `wireClaudeCodeHooks`, `installPointerAdapters`, or any other already-shipped CLI behavior.

## 5. Verification

No new runtime logic beyond `createSkillMarkdown()` (a pure string-building function — one unit test covering its shape: frontmatter present, embeds the real `USAGE` string, mentions `init`). Everything else (`build-skill.js`, `README.md`, `plugin.json`) is verified by direct inspection plus the existing CLI test suite remaining green (this spec doesn't touch CLI behavior).
