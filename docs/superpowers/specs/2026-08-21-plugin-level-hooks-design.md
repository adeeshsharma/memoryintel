# Plugin-Level Claude Code Hooks — Design Spec

Status: approved for planning
Supersedes: the per-project hook-wiring described in the original design spec (§6) and built in Plan A Task 13 (`wireClaudeCodeHooks`).

## 1. Problem

`memoryintel init` currently mutates a foreign file it doesn't own — it writes `SessionStart`/`Stop` hook entries directly into the calling project's `.claude/settings.json`. This is more invasive than necessary: `runLoad`/`runCheckStop` already no-op safely in any project without `.memoryintel/`, so the same hook commands could just as well be registered *once, globally*, via the plugin itself, and rely on that existing self-gating — exactly matching how `superpowers`' own `hooks/hooks.json` works (verified by inspecting its actual repo).

A second, concrete bug surfaced alongside this: `wireClaudeCodeHooks` writes bare `memoryintel load`/`memoryintel check-stop` into the hook entries, assuming a global CLI install — but the skill this repo now ships explicitly prefers `npx -y memoryintel <command>` and makes no such assumption. Anyone who only installs the skill (not a global CLI) gets hooks that silently fail. Moving to plugin-level hooks fixes both problems in one change, by using the same `npx -y memoryintel <command>` invocation everywhere.

## 2. Design

Add `hooks/hooks.json` at the package root (alongside `.claude-plugin/plugin.json` and `skills/`):

```json
{
  "description": "Load and maintain persistent project memory automatically",
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "npx -y memoryintel load" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "npx -y memoryintel check-stop" }] }
    ]
  }
}
```

No `matcher` on `SessionStart` — it fires on every session-start reason (startup, resume, clear, compact), which is correct: any of those is a legitimate moment to reload project memory, unlike superpowers' narrower bootstrap-only use case.

Once this plugin is installed (`/plugin install memory-intel@<marketplace>`, once distribution exists — not part of this spec), these two hooks apply to **every project**, with zero per-project file writes. In projects without `.memoryintel/`, both commands already no-op cleanly (`findMemoryIntelRoot` returns null → empty output / `{decision:'allow'}`), so there is nothing extra to gate on.

**`runInit` no longer wires Claude Code hooks at all.** The `wireClaudeCodeHooks` function, its `hasCommand`/`readSettings` helpers, and its dedicated test suite are removed — not left as dead/unused code. `init`'s remaining adapter work is just `installPointerAdapters` (AGENTS.md/GEMINI.md/Cursor rule files for tools with no plugin-hook equivalent).

`runCheckStop`/`resolveCheckStopMarker` (the live-diff nudge logic) are unaffected — they stay in `src/adapters/claudeCode.ts`, still called the same way from `src/cli.ts`'s `check-stop` case and from `runUpdate`. Only the hook-*registration* mechanism changes, not the check-stop logic itself.

## 3. Trade-off (explicit, not hidden)

Automatic Claude Code behavior now depends on the **plugin** being installed, not just the CLI. A user who installs only the `memoryintel` npm package (global or via npx) and never installs the plugin gets zero automatic SessionStart/Stop behavior in Claude Code — they'd need to run `memoryintel load`/`memoryintel update` themselves, or rely on the skill noticing and doing it for them turn-by-turn. This is the accepted cost of eliminating all per-project file mutation, per explicit request.

## 4. Non-goals

- Not publishing the plugin to any marketplace — this spec only adds the `hooks/hooks.json` file; distribution is unchanged from the existing skill/README work.
- Not changing pi's scope (still generic-pointer-only, unrelated to this change).
- Not changing `installPointerAdapters` or its target tool list.

## 5. Verification

No new runtime TypeScript logic — `hooks/hooks.json` is static, validated by JSON.parse. `runInit`'s test suite loses the two tests that exercised `wireClaudeCodeHooks`'s behavior (adapter-installed check, malformed-settings-resilience check) since that code path no longer exists; the remaining adapter (`installPointerAdapters`) keeps its own existing test coverage in `tests/adapters/genericPointer.test.ts`, untouched.
