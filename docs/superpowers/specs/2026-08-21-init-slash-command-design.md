# Memory Intel Init Slash Command — Design Spec

Status: approved for planning

## 1. Problem

The PRD's stated UX is a slash command: "A user initializes Memory Intel once within a project using: `/memory-intel init`." What exists today is a `memoryintel init` CLI binary, invoked from a terminal — there is no slash command a user can type inside Claude Code.

## 2. Constraint discovered during design

Claude Code plugin commands are always namespaced `plugin-name:command-name`. There is no mechanism to register a bare, space-separated `/memory-intel init` as a single literal invocation. The closest achievable UX is **`/memory-intel:init`** — a real slash command, just not byte-identical to the PRD's illustrative wording. This spec treats the PRD's phrasing as describing the *intended UX* (a one-time slash-command bootstrap), not a literal invocation string to match exactly.

## 3. Design

A new, separate distributable: a Claude Code plugin, added as a new top-level `plugin/` directory in this repo — distinct from `src/`/`tests/` (the CLI package), untouched by this change.

```
plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── init/
        └── SKILL.md
```

- **`plugin.json`**: minimal manifest — `name`, `description`, `version`. No hooks, no other commands. `name` must be `memory-intel` (this is what fixes the `:init` namespace prefix).
- **`skills/init/SKILL.md`**: the command itself.
  - Frontmatter: `description` (so Claude can explain what it does), `allowed-tools: Bash(memoryintel init:*)` to pre-approve exactly the CLI invocation this command needs, avoiding a permission prompt for the one thing it's meant to do.
  - Body: instructs Claude to run `memoryintel init` via Bash in the current project root, then briefly summarize what was created (the `.memoryintel/` directory, and which per-tool adapters got wired) — not to narrate implementation internals.
- The command performs **no work itself** beyond instructing Claude to invoke the CLI. All actual logic (scaffolding, idempotency, adapter wiring) is the CLI's, already built and tested. This command is a thin discovery/UX layer only.

## 4. Explicitly out of scope

- **Hook wiring is untouched.** Plugins can also bundle `hooks/hooks.json` for globally-applied hooks (no per-project `.claude/settings.json` edits needed) — this could eventually simplify or replace `wireClaudeCodeHooks`'s current per-project-file-write approach. That's a real, separate architectural question (does moving to plugin-level hooks change behavior for projects the user has open without `.memoryintel/`? how does plugin install/uninstall interact with already-wired per-project settings?) deserving its own design pass. Not building it now — the current per-project mechanism (Task 13, already shipped and tested) stays exactly as-is.
- **No publishing/marketplace listing.** This spec only covers the plugin's file structure existing in this repo, locally loadable — not registering it anywhere for others to install.
- **No other commands** (`load`, `update`, `status` as slash commands) — only `init`, since that's the one PRD explicitly frames as the user-facing entry point. The others are meant to be agent-invoked automatically, not typed by a user.

## 5. Verification

No TypeScript/test suite applies — this is static markdown/JSON. Verification is: `plugin.json` is valid JSON with the required `name` field; `SKILL.md`'s frontmatter parses as valid YAML; the underlying `memoryintel init` command it delegates to is already covered by the CLI's own test suite (unchanged by this spec).
