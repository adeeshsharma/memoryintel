# Check-Stop Live-Diff Nudge — Design Spec

Status: approved for planning
Supersedes: the `check-stop` / `.session-marker.json` mechanism described in `docs/superpowers/specs/2026-08-20-memory-intel-design.md` §6, which was built in Plan A's Task 13 but never actually wired to anything — no code path ever wrote `.session-marker.json`, so `runCheckStop` always fail-opened to `allow`. That gap was tracked as a deferred, load-bearing finding from Plan A's final review.

## 1. Problem

The Claude Code Stop-hook nudge exists to catch "the working tree changed and the agent never even considered calling `update`." The original design assumed a session-start marker (written by `load`) recording `hasChanges`/`updatedSinceMarker`/`nudged` as precomputed booleans. Nothing ever computed or wrote those booleans, so the mechanism was permanently inert.

Separately, Claude Code's `Stop` hook fires after **every agent turn**, not once at the end of a whole continuous session — so a "nudge once per session, then go quiet forever" design (even if wired up) would under-catch: real changes made in turn 5 of a long session would never get flagged if the one-shot nudge already fired back in turn 1.

## 2. Design

`check-stop` computes the answer itself, live, on every call — no precomputed marker needed from `load`.

- **Signature**: run `git status --porcelain` in the project root (the parent of `.memoryintel/`). Sort and join the changed-file lines into a single string — this is the diff's "signature." No git repository present → fail open (`allow`), same as any other check-stop error path.
- **State**: `.memoryintel/.session-marker.json` holds exactly one field: `{ "lastFlaggedDiffSignature": string | null }`. Missing file is treated as `{ lastFlaggedDiffSignature: null }`.
- **Decision**, each `check-stop` call:
  - Current signature is empty (clean tree) → `allow`; also reset `lastFlaggedDiffSignature` to `null` (nothing pending).
  - Current signature equals the stored `lastFlaggedDiffSignature` → `allow` (the agent already saw this exact diff and chose not to act on it — respect that judgment, don't nag on an unchanged situation).
  - Current signature differs from the stored value (first time, or the diff grew/changed since the last flag) → `block` once, write the new signature as `lastFlaggedDiffSignature`.
- **Resolution**: `update()`, on a successful apply, clears `lastFlaggedDiffSignature` to `null` — a successful update resolves whatever was pending, regardless of whether it addressed every changed file (the mechanism is a coarse nudge, not a precise audit).
- `load` is no longer involved in this mechanism at all — it doesn't need to write anything for `check-stop` to work.

This satisfies both terms the human partner set:
- Fires after every turn (Stop fires per-turn already; no new hook wiring needed).
- Nudges once per *distinct* unresolved diff, not once ever and not on every subsequent turn for the same unresolved diff.

## 3. Non-goals

- No semantic judgment of whether a diff is "meaningful" — this is a mechanical git-diff check, same limitation as the original design. The agent still owns the decision of *whether* to call `update`; this only catches "did you forget to even consider it."
- No change to `load`'s behavior, `update`'s signature, or the CLI's command surface beyond internal logic in `runCheckStop` and one added line in `runUpdate`.
- No change to pi's hook adapter scope (still generic-pointer, per the original design's deferred decision).

## 4. Error handling

- No git binary / not a git repository / `git status` fails for any reason → fail open (`allow`), matching `check-stop`'s existing "errors should never block a stop" posture.
- Corrupt or unparseable `.session-marker.json` → treat as `{ lastFlaggedDiffSignature: null }` (same posture as a missing file), don't crash the Stop hook.
