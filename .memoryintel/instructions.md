# Memory Intel Instructions

This project uses Memory Intel. Read this file at the start of every session.

## First session on an existing project
If `.memoryintel/` was just initialized on a project that already has real history (not a fresh
scaffold), run both before anything else - neither tries to reverse-engineer architecture, so
neither is a substitute for the other:

1. `memoryintel import` walks the whole repo for real documentation (any `.md`/`.html` file,
   not a fixed list of known filenames) and mechanically copies each one's content verbatim into
   the `.memoryintel/` section its filename/title best matches. Deterministic, no judgment. Its
   output is raw and unfiled by design; treat it as source material to read and properly re-file
   yourself, not as finished memory.
2. `memoryintel scan` never writes anything - it prints detected stack and a one-level-deep
   directory listing, nothing more. Enough to answer "how do I run this", not an attempt at
   understanding the codebase's architecture.

Real understanding - architecture, patterns, why things are built the way they are - is not
something either command can honestly derive. It builds the same way it already does on a
greenfield project: through your own judgment as you actually work here, one real `update` at a
time. Both commands are safe to run more than once - `import`'s already-imported content is
skipped, not duplicated, and `scan` never writes anything at all.

## Session start
Run `memoryintel load` (no arguments — the hook does this automatically) and treat its output as
project context. Its manifest reports each loaded file's `lines`, `ceiling`, and `status`
(`over`/`under`) — see "Compaction" below for what to do about a file marked `over`.

`load` with no `--domain` automatically carries forward whichever domain the most recent
`update` actually touched, so continuing yesterday's technical work loads `technical/*` again
without you having to ask for it. The one case this doesn't cover is deliberately switching to a
domain nothing was just written to — check the "Other memory available" list at the bottom of
`load`'s output and, if the task is about a topic listed there, run
`memoryintel load --domain <domain>` yourself before continuing.

## Session end
If your work changed project understanding (new architecture, feature, decision, integration, or
roadmap item — not formatting/typos/comments), draft an update-plan (TOON table: file, action,
section, content, reason), write it to a file, and run `memoryintel update <plan-file>` — e.g.
`memoryintel update /tmp/plan.toon`. Running `memoryintel update` with no plan-file argument and
nothing piped to stdin fails (there is no plan to apply). Reuse exact existing heading names from
the manifest `load` gave you. If nothing meaningful changed, do nothing — do not call `update`.

**The exact TOON format `update` expects** - this is the one place a malformed plan fails
outright rather than degrading gracefully, so match it exactly rather than improvising:

    items[2]{file,action,section,content,reason}:
      "path/to/file.md","append","Section Heading","New paragraph to add.","Why this changed"
      "path/to/other.md","create-section","New Heading","Content, comma and all.","Why"

- The header line is literal: `items[`, the row count, `]{`, the field names in this exact
  order and spelling (`file,action,section,content,reason` - add `,kind` only for a compaction
  row, see "Compaction" below), `}:`. The row count MUST equal the number of rows that follow, or
  `update` rejects the whole plan with nothing applied.
- `action` is exactly one of three values: `append` (add to the end of an existing section's
  content), `replace` (overwrite the section's entire content), or `create-section` (add a new
  `##` heading if it doesn't already exist - degrades to a plain `append` if it does).
- Each row is comma-separated fields in that same header order, indented two spaces.
- **Quote a field in double quotes whenever its content contains a comma, a double quote, a
  newline, or starts with whitespace** - leave every other field unquoted. Double any literal
  `"` inside a quoted field (`"` becomes `""`). A quoted field may span multiple physical lines.
  Example: content `He said "hi", then left` must be written as `"He said ""hi"", then left"`.
- `context/currentMentalModel.md` is the one exception to `action`: its row's `content` replaces
  the file's entire content verbatim, regardless of what `action`/`section` say.

**`update` also accepts a plain JSON array of the same rows instead of TOON**, auto-detected by
whether the file/stdin content starts with `[` or `{` after trimming - if you'd rather
`JSON.stringify` a plan than hand-write TOON's quoting rule above, this is the safer default:
`[{"file": "path/to/file.md", "action": "append", "section": "Section Heading", "content": "New
paragraph to add.", "reason": "Why this changed"}]`. Same fields, same required order doesn't
matter (JSON is keyed, not positional), same `context/currentMentalModel.md` exception. Neither
format is preferred - use whichever you're less likely to get wrong.

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

## Committing `.memoryintel/` itself
`.memoryintel/` is a normal, git-committed part of the project — `memoryintel update` only writes
files to disk, it never runs git for you. After a successful `update`, commit `.memoryintel/`'s
changes yourself, ideally in the same commit as (or immediately after) whatever code change
prompted the update, so it travels with the same commit/PR automatically instead of being left
behind as an uncommitted diff.

This matters most in a git worktree, a container, or any other isolated checkout: an uncommitted
`.memoryintel/` change only exists in that one working directory. Merging a feature branch's PR and
pulling the primary checkout up to date only brings memory updates along if they were actually
committed first, the same as any other file — there is nothing worktree-specific about the
mechanism itself, only that a worktree's own uncommitted state is easier to lose track of, since it
is invisible everywhere else once the session ends and that directory stops being looked at. Found
on a real project: a full feature built end-to-end in a worktree, with real, meaningful
architecture changes throughout, reached a merged PR with `.memoryintel/` never once updated or
committed — not because updating was hard, but because nothing in the session ever came back to it
before the worktree's job was considered done.

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
(`defaultCeilingChars`, and optional `domainOverrides` keyed by domain, e.g. `"technical": 20000`)
— the built-in default is 12000 chars if unset. `update` also flags a file that crosses the
ceiling right after the write that pushed it over, in the same turn — don't wait for the next
`load` to notice.

## Dashboard
If the user asks to turn off the dashboard/web UI, run `memoryintel dashboard disable`. This is a
single shared dashboard for every Memory Intel project on this machine — tell the user it affects
all of their projects, not just this one. `memoryintel dashboard enable` turns it back on.
