## Learnings

- **`process.exit()` truncates piped stdout at 64KB.** The `SessionStart` hook's output must
  survive `process.exitCode = n; return;`, never a forced `process.exit(n)` — writes to a pipe
  are asynchronous and a forced exit tears the process down before they flush.

- **`git status --porcelain` lines must be sliced at a fixed offset (position 3), never
  `.trim()`ed first.** Trimming shifts that offset inconsistently depending on whether the status
  code itself starts with a space.

- **A memory file's own existence/writes must be excluded from the diff signature the Stop-hook
  computes**, or the nudge re-blocks forever on its own bookkeeping (`.memoryintel/` writing to
  itself looks like "a new diff" otherwise).

- **Clearing the check-stop marker to `null` after `update()` causes an immediate re-block.**
  `update()` never touches the actual source diff that triggered the nudge, so a freshly-nulled
  marker makes that still-present diff look "new" again on the very next check. Capture the
  *current* diff signature as the new baseline instead of clearing to null.

- **Tests that don't set `MEMORYINTEL_GLOBAL_DIR` spawn a real detached daemon** and pollute the
  real `~/.memoryintel/registry.json` on the developer's machine. A global `setupFiles` safety
  net (`tests/testEnvSafety.ts`) exists specifically to prevent this, ordering-independent of any
  individual test file remembering to set the env var itself.

- **TOON's decoder must scan the whole table body character-by-character** for quoted fields that
  legitimately span multiple physical lines — splitting on `\n` before parsing quotes silently
  truncates a multi-line field.

- **`npx -y memoryintel <command>` resolves to a local `npm link`ed install before ever touching
  the network** — this is what makes the plugin's hardcoded hook commands work against a
  from-source checkout with no npm-registry publish at all. See README.md's local setup section.
