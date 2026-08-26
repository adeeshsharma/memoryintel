# Memory Intel

[![CI](https://github.com/adeeshsharma/memoryintel/actions/workflows/ci.yml/badge.svg)](https://github.com/adeeshsharma/memoryintel/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/memoryintel.svg)](https://www.npmjs.com/package/memoryintel)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Persistent, cross-session project memory for AI coding agents. Set it up once per project; after
that, agents automatically load and update project understanding — architecture, decisions,
progress, a running "mental model" — across new chats, new sessions, and even across tools
(Claude Code, Cursor, Codex, Gemini CLI).

This repository is itself running Memory Intel on itself — see `.memoryintel/` for the tool's own
current state, decisions, and open todo items. Any agent with the skill below active will read it
automatically.

## Quick Start

```bash
npx skills add adeeshsharma/memoryintel --skill memoryintel   # teaches an agent the shape of it
npm install -g memoryintel                                      # the CLI those instructions call
```

Then, in any project, ask an agent to "set up persistent memory here" once. From then on, `load`/
`update` fire automatically via Claude Code's `SessionStart`/`Stop` hooks (see "Point Claude Code
at the plugin" below) — nothing else to remember. See `.memoryintel/instructions.md` in a given
project for its own specific guidance once initialized.

## Install

**The CLI** is on the npm registry:

```bash
npm install -g memoryintel
# or run it without installing:
npx memoryintel status
```

**The Claude Code plugin** — this is what actually wires up automatic `SessionStart`/`Stop`
hooks, not just agent-readable instructions. This repo is its own marketplace
(`.claude-plugin/marketplace.json`), so no separate hosting or git clone is needed:

```bash
claude plugin marketplace add adeeshsharma/memoryintel
claude plugin install memoryintel@memoryintel
```

That's a one-time install — restart Claude Code and the hooks are active for every session from
then on, in every project. See "Skill vs. plugin" below if it's not obvious why this is a plugin
and not just a skill.

**Just the skill, no automation** — if you want the agent-facing instructions (what `memoryintel
init`/`load`/`update` are and when to use them) without the automatic hooks, install it standalone:

```bash
npx skills add adeeshsharma/memoryintel --skill memoryintel
```

<details>
<summary>Developing/testing this plugin locally, without the marketplace</summary>

```bash
claude --plugin-dir "$(npm root -g)/memoryintel"   # or any local checkout
```

`--plugin-dir` is Claude Code's own documented flag for loading a plugin from a specific
directory for one session, bypassing marketplaces entirely (see
[Create plugins](https://code.claude.com/docs/en/plugins)). Needs to be passed every launch; a
shell alias avoids retyping it:

```bash
alias claude-mi='claude --plugin-dir "$(npm root -g)/memoryintel"'
```

</details>

### Skill vs. plugin

A **skill** is just instructions loaded into an agent's context — it teaches an agent *what to
do*, and the agent decides on its own judgment *whether* to act on it. A **plugin** is a bundle
that can include a skill *and* hooks — commands Claude Code itself runs automatically at fixed
lifecycle moments (`SessionStart`, `Stop`), no agent judgment involved. Memory Intel's plugin
bundles both: the skill (`skills/memoryintel/SKILL.md`) plus `hooks/hooks.json`, which runs
`memoryintel load` at the start of every session and `memoryintel check-stop` at the end of every
one — the latter can even block finishing until memory's been updated. The standalone skill
install above gives an agent the knowledge; only the plugin gives you the automation that doesn't
depend on the agent noticing anything.

### If you don't want to touch Claude Code's plugin system at all

The CLI works standalone, with no plugin/skill/hook involved — useful for scripting, for other
tools, or just to try it out:

```bash
memoryintel init      # once per project — scaffolds .memoryintel/, installs pointer files
                       # for tools without native hooks (Cursor, Codex, Gemini CLI, opencode)
memoryintel load       # print resolved context to stdout
memoryintel update plan.toon   # apply an update-plan
```

`memoryintel init` never touches a project's own `.claude/settings.json` — Claude Code automation
comes entirely from the plugin's own `hooks/hooks.json` in this repo, active once the plugin
itself is active. From then on, agents load and update project memory on their own, per that
project's own `.memoryintel/instructions.md`.

If a shared local dashboard is running (a read-only view of every initialized project on this
machine), turn it off any time with `memoryintel dashboard disable` — or back on with
`memoryintel dashboard enable`.

## Prerequisites

Node.js ≥18 — actually verified as the real floor (CI runs the full suite on Node 18), not an
assumed default.

## How it works

Full design docs live in `docs/superpowers/specs/`; a diagram-heavy architecture reference lives
in `docs/architecture/memory-intel-architecture.html`. In short: `.memoryintel/` is a structured,
git-committed set of markdown/JSON files an agent reads at session start and selectively updates
when something meaningful changes — never a changelog, always a maintained understanding of the
project as it currently is. See `.memoryintel/context/decisions.md` in this very repository for
the specific design decisions behind that, with rationale.

## Benchmarks: with vs. without

Measured on a real second project ([distilled-docs](https://github.com/adeeshsharma/distilled-docs),
an 8-phase, single-day build), not a synthetic one. Methodology: real file sizes from that
project's actual `.memoryintel/` state, tokens estimated at ~4 chars/token (a standard, slightly
conservative approximation — not measured API telemetry, since neither path logs real token
counts from the model provider).

**Per-session context bootstrap:**

| | Chars | Tokens (est.) |
|---|---|---|
| `memoryintel load` (curated: mental model + active context + technical domain) | 9,223 | ~2,300 |
| No memory, conservative (skim one architecture doc) | 6,126 | ~1,500 |
| No memory, realistic (doc + git log + a handful of source files) | ~28,000 | ~7,000 |
| No memory, worst case (re-derive from the full source tree, 49 files) | 113,652 | ~28,400 |

That's **67–92% fewer tokens per session bootstrap**, depending on how much of the codebase an
agent would otherwise need to re-read to reach equivalent situational awareness — and that range
brackets the same order of magnitude as published numbers from purpose-built memory systems for
chat agents ([Mem0](https://arxiv.org/pdf/2504.19413): ~90% vs. full context; Letta/MemGPT-class
systems: 85–93%), despite solving a different problem (durable project state, not conversation
history).

**Why the gap widens over time, not just per-call:** `.memoryintel/` content is self-compressing,
capped at ~300 lines per file by default — load cost stays roughly flat as a project grows. The
no-memory alternative doesn't; it scales with total codebase size. A project one day old and one
a year old cost about the same to bootstrap with Memory Intel. Without it, the older project costs
more, every single session.

**Not just tokens:** `context/decisions.md` and `context/learnings.md` hold things a memory-less
agent would otherwise silently redo or get wrong twice — a real example from that same build: a
subtle bundler bug (a literal-string dynamic `import()` statically resolved by esbuild instead of
treated as a runtime URL) got fixed once and recorded, not re-debugged on the next session that
touched that code path.

These numbers are reproducible for your own project: every `memoryintel load` call logs a
`session-load` event (domain, files, character/line counts) to `memory-events.jsonl`, visible in
the dashboard's "Session activity" section or queryable directly from the event log.

## Development

Working on this repo itself, rather than just using the published package:

```bash
git clone https://github.com/adeeshsharma/memoryintel.git
cd memoryintel
npm install
npm run build                # compiles dist/, regenerates skills/memoryintel/SKILL.md from src/skill.ts
npm link                     # makes `memoryintel` resolve to this exact checkout instead of the published one
npm test                     # 207 tests, vitest
npm run build:skill:check    # fails if skills/memoryintel/SKILL.md has drifted from src/skill.ts
```

CI (`.github/workflows/ci.yml`) runs the full suite on Ubuntu, Windows, and macOS on every
push/PR to `master`, and is required via branch protection.

## Releasing

Automated with [release-please](https://github.com/googleapis/release-please) and npm [Trusted
Publishing](https://docs.npmjs.com/trusted-publishers/) — see [RELEASING.md](RELEASING.md).
`CHANGELOG.md` is generated automatically starting with the first automated release.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
