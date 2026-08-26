# Memory Intel Instructions

This project uses Memory Intel. Read this file at the start of every session.

## Session start
Run `memoryintel load [--domain technical|business|research]` and treat its output as project context.
Its manifest reports each loaded file's `lines`, `ceiling`, and `status` (`over`/`under`) — see
"Compaction" below for what to do about a file marked `over`.

## Session end
If your work changed project understanding (new architecture, feature, decision, integration, or
roadmap item — not formatting/typos/comments), draft an update-plan (TOON table: file, action,
section, content, reason) and run `memoryintel update`. Reuse exact existing heading names from
the manifest `load` gave you. If nothing meaningful changed, do nothing — do not call `update`.

Also include a row for `context/currentMentalModel.md` whenever the update is more than a small,
localized fact — anything that shifts what the project *is* or where it currently stands (not
every single decision/progress entry needs one). Unlike every other file, it is a **whole-file
replace**: rewrite the entire current-understanding narrative from scratch each time, in plain
prose, not another append-only log. This is the file the dashboard's "Current understanding"
section renders directly — a stale or never-written one is the single most common way this
project's memory looks broken to a human glancing at the dashboard, even when every other file is
being updated correctly.

Before adding a new `context/decisions.md` entry, skim the existing log for one your change
supersedes or resolves (e.g. a decision your new work reverses, or a "known limitation" it just
fixed). `decisions.md` is append-only by design — there is no mechanism to edit an old entry in
place — so note the resolution explicitly in the new entry ("supersedes the earlier decision to
X — see git history for why") rather than leaving the old one standing as if still current. Found
on a real project: a "known limitation, deliberately left unfixed" entry was still sitting in
`decisions.md` well after a later change fixed exactly that limitation — correctly recorded in
`currentMentalModel.md`, but never reconciled against the older, now-wrong decisions entry right
next to it.

## Compaction
A file marked `status: over` in `load`'s manifest has grown past its configured line ceiling.
This is a signal, not a command — compact it only when it's a sensible moment to (the same
judgment you already apply to whether to update at all), by adding a row to your update-plan with
one extra field, `kind: compress`, and `action: replace` against the section that's grown large.
`update` will only apply that row if the target file is currently git-clean — if it isn't, the row
is rejected and the file is left untouched; commit the current state first, then retry. Aim to
compact to comfortably under the ceiling, not exactly at it.

git is the archive: nothing is duplicated into a second file. What you cut is still fully
recoverable from git history — it just won't be loaded by default anymore. Because of that:

- **Keep verbatim, never compress away:** architecture decisions and their rationale, unresolved
  open questions, anything a future session would need to avoid repeating a mistake or
  re-deriving a conclusion already reached.
- **Safe to compress:** resolved narrative ("we tried X, it didn't work, we did Y instead"
  collapses to "Y (not X — see git history for why)"), routine progress entries fully superseded
  by a later one, verbose detail a terser statement of the current state already covers.
- **Rule of thumb:** if a future session would reasonably ask "why is it built this way?" and
  your summary can't answer, you compressed too much — keep more.

The ceiling itself is configurable in `memory-config.json` under a `compression` key
(`defaultCeilingLines`, and optional `domainOverrides` keyed by domain, e.g. `"technical": 500`)
— the built-in default is 300 lines if unset.

## Dashboard
If the user asks to turn off the dashboard/web UI, run `memoryintel dashboard disable`. This is a
single shared dashboard for every Memory Intel project on this machine — tell the user it affects
all of their projects, not just this one. `memoryintel dashboard enable` turns it back on.
