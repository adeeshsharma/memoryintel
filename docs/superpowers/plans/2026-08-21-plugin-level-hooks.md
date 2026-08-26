# Plugin-Level Claude Code Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (small, approved for direct/no-worktree execution).

**Goal:** Eliminate all per-project `.claude/settings.json` mutation by moving Claude Code hook registration to a plugin-level `hooks/hooks.json`, and fix the `npx -y memoryintel` vs bare-`memoryintel` inconsistency between the hooks and the skill in the same change.

**Architecture:** New static `hooks/hooks.json` at package root. `wireClaudeCodeHooks` (and its now-dead `hasCommand`/`readSettings` helpers and dedicated tests) is deleted from `src/adapters/claudeCode.ts` and `tests/adapters/claudeCode.test.ts`. `runInit` drops its call to it. `runCheckStop`/`resolveCheckStopMarker` are untouched.

**Spec:** `docs/superpowers/specs/2026-08-21-plugin-level-hooks-design.md`

## Global Constraints

- `hooks/hooks.json` commands use `npx -y memoryintel <command>`, matching the skill's own invocation style exactly — no bare `memoryintel` anywhere in this change.
- `runCheckStop`/`resolveCheckStopMarker` behavior is unchanged — only their registration mechanism (hooks.json vs. per-project settings.json) changes.

---

### Task 1: Add plugin-level hooks, remove per-project wiring

**Files:**
- Create: `hooks/hooks.json`
- Modify: `src/adapters/claudeCode.ts` (remove `wireClaudeCodeHooks`, `hasCommand`, `readSettings`, their imports)
- Modify: `tests/adapters/claudeCode.test.ts` (remove the `describe('wireClaudeCodeHooks', ...)` block and its imports/helpers used only there)
- Modify: `src/commands/init.ts` (remove the `wireClaudeCodeHooks` import and call)
- Modify: `tests/commands/init.test.ts` (drop the `.claude/settings.json` assertion from "installs all adapters..."; remove the malformed-settings resilience test entirely)
- Modify: `package.json` (add `"hooks"` to `"files"`)
- Modify: `src/skill.ts` (wording: no longer claims `init` wires Claude Code hooks)
- Modify: `README.md` (mention the plugin provides global Claude Code hooks)

- [ ] **Step 1: Write `hooks/hooks.json`**

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

Verify: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json', 'utf-8')); console.log('OK')"` prints `OK`.

- [ ] **Step 2: Remove `wireClaudeCodeHooks` from `src/adapters/claudeCode.ts`**

Delete the `readSettings` function, the `HookEntry`/`ClaudeSettings` interfaces, `hasCommand`, and `wireClaudeCodeHooks` itself. Keep every other export (`SessionMarker`, `readMarker`, `writeMarker`, `computeDiffSignature`, `runCheckStop`, `resolveCheckStopMarker`) exactly as they are. Remove the now-unused `mkdirSync` import if nothing else in the file needs it (check first — `writeMarker` uses `writeFileSync`, not `mkdirSync`).

- [ ] **Step 3: Remove the `wireClaudeCodeHooks` describe block from `tests/adapters/claudeCode.test.ts`**

Delete the entire `describe('wireClaudeCodeHooks', () => { ... })` block (3 tests). Remove the `wireClaudeCodeHooks` name from the import line at the top, keeping `runCheckStop`, `resolveCheckStopMarker`. Check whether `mkdirSync`/`writeFileSync` imports are still used elsewhere in the file (they are — by `beforeEach` and the git-repo helper tests) before removing anything from the fs import line.

- [ ] **Step 4: Remove the call from `src/commands/init.ts`**

Delete the `import { wireClaudeCodeHooks } from '../adapters/claudeCode.js';` line and the `runAdapter('wire Claude Code hooks', () => wireClaudeCodeHooks(targetDir));` call. Keep the `installPointerAdapters` call and its own `runAdapter` wrapper.

- [ ] **Step 5: Update `tests/commands/init.test.ts`**

In "installs all adapters when they are healthy", remove the line `expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);` — keep the `AGENTS.md`/`.cursor/rules` assertions.

Delete the entire "still completes init when .claude/settings.json is malformed" test — there is no longer a Claude-Code-specific adapter in `init` for a malformed foreign file to break.

- [ ] **Step 6: Update `package.json`**

Add `"hooks"` to the `"files"` array: `["dist", "skills", ".claude-plugin", "hooks"]`.

- [ ] **Step 7: Update `src/skill.ts`**

Change the "First time in this project?" paragraph from claiming `init` "wires automatic Claude Code hooks" to accurately describing the split: scaffolds `.memoryintel/` and installs pointer files for tools without native hook support; Claude Code automation comes from the memory-intel plugin itself (its bundled `hooks/hooks.json`), active globally once the plugin is installed, not from `init`.

- [ ] **Step 8: Regenerate the skill and update the README**

Run: `npm run build` (regenerates `skills/memory-intel/SKILL.md` from the updated `src/skill.ts`).

Add a short note to `README.md`'s "How it works" section: the plugin also provides global Claude Code hooks (`hooks/hooks.json`) — no per-project `.claude/settings.json` is ever written.

- [ ] **Step 9: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — fewer tests than before (the two removed init tests, three removed claudeCode tests), everything else green.

- [ ] **Step 10: Commit**

```bash
git add hooks/ src/adapters/claudeCode.ts tests/adapters/claudeCode.test.ts src/commands/init.ts tests/commands/init.test.ts package.json src/skill.ts skills/memory-intel/SKILL.md README.md
git commit -m "feat: move Claude Code hooks to plugin-level hooks.json, eliminate per-project settings.json mutation"
```

---

## Self-Review Notes

**Spec coverage:** §2's `hooks/hooks.json` content and removal of `wireClaudeCodeHooks` → Task 1 Steps 1-4. §3's trade-off is documentation-only (no task needed — it's an accepted consequence, not a behavior to implement). §5's test-suite impact → Step 5, 9.

**No placeholders found** on final read-through.
