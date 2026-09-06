# check-stop: skip trivial diffs

**Status:** Approved, ready for implementation plan.

## Problem

`runCheckStop` (`src/adapters/claudeCode.ts`) blocks the Stop hook on *any*
uncommitted diff not yet flagged, with zero sensitivity to how substantial the
change is. A one-line CSS tweak or a single dead-icon removal triggers the
same block-then-explain-then-finish-again round-trip as a genuinely
architectural change. In real use (this session, on the gen-portfolio
project) this produced enough repeated blocks on trivial changes that the
signal-to-noise ratio of the hook degraded — every block starts to look like
routine friction rather than a real prompt to update memory.

The hook's actual purpose (see the existing comments in `claudeCode.ts` and
its test suite) is to catch the case where an agent's own judgment fails
silently — a real project (distilled-docs) shipped substantial unaccounted
work with `.session-marker.json` never once recording a flagged diff. Any fix
here must reduce *noise*, not the hook's ability to catch that failure mode.

Out of scope: the literal wording "Stop hook blocking error from command:
..." shown around the block is compiled into Claude Code's own CLI binary
(confirmed via `strings` on the binary), not something this plugin's JSON
payload can rename. The only lever memoryintel has is *how often* a block
happens at all — this design is that lever.

## Design

### Part 1: triviality decision tree

An ordered, explainable rule chain — not a weighted score — evaluated only at
the point `runCheckStop` would otherwise produce a block (signature differs
from the marker, tree is dirty, not the fresh-project baseline case). Each
rule either returns a verdict or falls through to the next:

1. **Manifest file touched → never trivial.** If any changed path is in the
   existing `MANIFEST_FILES` set (`package.json`, `requirements.txt`,
   `pyproject.toml`, `go.mod`, `Cargo.toml` — currently a local `const` in
   `claudeCode.ts`), the diff is not trivial, full stop. This is a hard veto:
   it runs before anything else and short-circuits the rest of the chain.
   Manifest changes are exactly what the fact-detection feature (`sync`,
   PR #18) watches for, so they must always reach a real block.
2. **Every changed file is a lockfile → trivial.** Recognizes
   `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`,
   `Cargo.lock`, `go.sum`, `poetry.lock`, `Pipfile.lock`, `composer.lock`,
   `Gemfile.lock`. If the changed-file set is non-empty and every file in it
   is in this list, trivial. (A lockfile alongside a non-lockfile file falls
   through to rule 3/4 — the lockfile just doesn't add to the line count in
   a meaningful way for those rules, see below.)
3. **Whitespace-only diff → trivial, unconditionally.** For each *tracked,
   modified* changed file (not new/untracked, not deleted), run
   `git diff HEAD -w -- <file>`. If every such file produces empty output,
   the diff is trivial regardless of the line-count ceiling in rule 4 — a
   pure reformat is definitionally not memory-worthy no matter how many lines
   it touches. This rule only applies when there's at least one *tracked
   modified* file to check; a diff that's purely new/untracked or purely
   deleted files skips this rule and falls to rule 4 (a new or deleted file
   is never "whitespace-only").
4. **Line-count fallback.** Total non-whitespace changed lines across the
   diff, compared against a configurable ceiling (default 20). Computed as:
   - Tracked modified/renamed files: `git diff HEAD --numstat -w -- <file>`,
     sum of added + deleted columns (already whitespace-insensitive, so a
     file that's mostly reformatting with a couple of real edits only counts
     the real edits).
   - Untracked (new) files: total line count of the file's current content
     (every line counts as added — there's no baseline to diff against).
   - Deleted files: line count of the file's content at HEAD (every line
     counts as removed).
   - Lockfiles are excluded from this sum entirely (rule 2 already granted
     them a pass; counting their often-large diffs here would make an
     otherwise-trivial lockfile-plus-one-real-line change look non-trivial
     for the wrong reason).

   Trivial if the total is `<= ceiling`, non-trivial otherwise.

**Fail-closed on uncertainty.** If any git command used above fails (not to
be confused with "this isn't a git repo at all", which `computeDiffSignature`
already handles upstream by allowing unconditionally), the whole triviality
check reports "not trivial" — an unclassifiable diff falls back to the
existing block behavior rather than silently passing. The hook has always
failed *open* only at the "no git repo" boundary; once a diff is known to
exist, ambiguity must not suppress the safety net.

### Part 2: what happens when a diff is judged trivial

- `runCheckStop` returns `{}` immediately — no block at all, not just a
  faster self-resolution on retry. This is the actual friction reduction.
- The signature is still written to `.session-marker.json` as
  `lastFlaggedDiffSignature`, exactly as a real block would, so the *next*
  check-stop call doesn't re-evaluate the same already-seen diff.
- `.session-marker.json` gains a `consecutiveTrivialSkips` counter (missing
  on old marker files reads as `0`, for backward compatibility with markers
  written before this feature). Each trivial-skip allow increments it.
- **Consecutive-skip cap (backstop):** when incrementing would bring the
  counter to its cap (default 3), the hook does **not** allow — it forces a
  real block instead (using the existing reason text), and resets the
  counter to 0. This directly guards the failure mode the hook was built to
  catch: many small, individually-trivial diffs accumulating unnoticed
  across a long session. The cap is a count of consecutive *skips*, not of
  check-stop calls in general — a real block or a real `update()` in between
  resets it.
- `resolveCheckStopMarker` (called after a successful `update()`) resets
  `consecutiveTrivialSkips` to 0 unconditionally, alongside its existing
  baseline-signature behavior — a real memory update is exactly the event
  the cap exists to force, so it always clears the counter.
- The manifest-touch "auto-detected facts" reason-text enhancement
  (PR #18) is unaffected: rule 1 above vetoes triviality for any manifest
  touch, so that code path and this one are mutually exclusive by
  construction — a manifest change can never take the trivial-skip branch.

### Configuration

Both numbers are configurable via `memory-config.json`'s existing
project-config file, following the exact pattern `compressionConfig.ts`
already uses for `defaultCeilingChars` (missing file, missing key, or
corrupt JSON all fall back to defaults silently — this is a read-time
convenience, never something that throws):

```json
{
  "trivialDiff": {
    "lineCeiling": 20,
    "consecutiveSkipCap": 3
  }
}
```

Ships **on by default** for every memoryintel install, no opt-in flag and no
enable/disable toggle — this is the user's explicit choice (they are
currently the tool's only real user and can set their own package's
default). If a future need for an off-switch shows up, that's a separate,
later request.

### Where this lives

- New module `src/core/trivialDiff.ts`: owns the decision tree
  (`isTrivialDiff`), the lockfile-name set, and the config reader. It also
  becomes the new home for `MANIFEST_FILES` — currently a local `const` in
  `claudeCode.ts` — since the manifest veto is now conceptually part of "is
  this diff trivial", and centralizing it removes what would otherwise be a
  second, separately-drifting copy of that list. `claudeCode.ts` imports
  `MANIFEST_FILES` from `trivialDiff.ts` for its existing manifest-touch
  "auto-detected facts" reason-text check instead of defining it locally.
- `src/adapters/claudeCode.ts`: `runCheckStop` calls `isTrivialDiff` at the
  point it would otherwise write the marker and block; `SessionMarker`
  gains `consecutiveTrivialSkips`; `resolveCheckStopMarker` resets it.

## Testing requirements

- Manifest touch always blocks, even with a 1-line change and even alongside
  otherwise-trivial files.
- All-lockfiles diff is trivial; a lockfile alongside one real-file line
  change is judged by that real file's line count alone (lockfile excluded
  from the sum).
- Whitespace-only diff (re-indent, trailing-space cleanup) on a tracked file
  is trivial regardless of line count / ceiling.
- Under-ceiling real change is trivial; at/over-ceiling is not.
- New (untracked) file line count and deleted-file line count both feed the
  ceiling fallback correctly.
- Third consecutive trivial-skip forces a real block and resets the counter;
  a real `update()` call in between also resets it (verified via
  `resolveCheckStopMarker`).
- A marker file written before this feature (no `consecutiveTrivialSkips`
  key) is read as if the counter were 0.
- `lineCeiling` and `consecutiveSkipCap` overrides from `memory-config.json`
  are honored; missing/corrupt config falls back to defaults (20 and 3).
- A git command failure during triviality classification (simulated) results
  in "not trivial" (existing block behavior), not a silent allow.

## Non-goals

- No semantic/AST-aware diff analysis — line counts and whitespace-only
  detection are the whole signal, deliberately simple and auditable.
- No per-project or per-user enable/disable toggle for the feature as a
  whole — only the two numeric knobs above are configurable.
- No change to the block reason text or wording — Claude Code's own hook
  block message is outside this plugin's control (see Problem section); this
  design's only lever is reducing how often a block happens.
