## External Services

None. No network calls anywhere in the CLI — everything is local filesystem + local git.

## Internal Dependencies

`git` (a real dependency at runtime — the Stop-hook nudge and self-compression's safety gate both
shell out to `git status --porcelain` via `src/core/gitPorcelain.ts`; both fail open/safe if git
isn't available or the project isn't a repo). Otherwise just Node's `fs`/`child_process`
built-ins — no third-party runtime packages at all.
