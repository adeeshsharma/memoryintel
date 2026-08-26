# Memory Self-Compression — Design

## 0. Why

The PRD's V2/V3/V4 roadmap (semantic retrieval, knowledge graph, MCP server)
has been dropped — not deferred, dropped — because none of it is needed for
this tool's actual purpose: agents not restarting from scratch each session.
That purpose is already solved by the load/update loop.

The one real scaling problem that loop *can* hit: `.memoryintel/` content
files grow over a project's lifetime, and `load()` reads them wholesale into
every session's context. Past a point, that's wasted token cost. This spec
designs self-compression — the agent periodically compacting its own memory
files — to keep that cost bounded without discarding context that still
matters.

## 1. Mechanism: reuse `update()`, no new writer primitive

Compression is expressed as an ordinary update-plan row, routed through the
existing `update()` → sectionWriter → atomic-write path — the same lock, the
same TOON boundary, the same validate-then-write two-phase commit already
built. A compaction plan uses `action: replace` against the section that has
grown large, with the drafted replacement being a compact summary rather
than new content. No new file-writing code is introduced by this feature.

## 2. Scope: only files `load()` actually reads back

The size ceiling applies to exactly the files `load()` injects into agent
context:

- `context/currentMentalModel.md`
- `context/activeContext.md`
- the domain trio: `technical/*.md`, `business/*.md`, `research/*.md`

`memory-events.jsonl`, `memory-index.json`, and `.session-marker.json` are
explicitly out of scope. They are write-only bookkeeping — `load()` never
reads them back into context — so compressing them would not save any
tokens; it would just be busywork with no purpose under this feature's own
goal.

## 3. Where the check runs, and what the agent sees

`load()` already reads every file it returns. It additionally computes each
file's line count against a configurable per-file-type ceiling
(`memory-config.json`, e.g. `compressionCeilingLines: 300`, with a single
global default and optional per-domain overrides) and adds one line to that
file's entry in the TOON manifest it already emits:

```
lines: 342, ceiling: 300, status: over
```

This is a signal, not a command. The agent sees it every session, in the
same place it already sees freshness information, and decides — using the
same "was this a meaningful checkpoint" judgment `update()` already asks of
it — whether this session is a sensible moment to also draft a compaction.
Nothing forces compression to happen on any particular session; a file can
sit `over` for a while with no ill effect beyond the token cost the feature
exists to eventually reduce.

**Target after compaction:** comfortably under the ceiling (~60% of it), not
exactly at the line count — so a compacted file doesn't immediately re-trip
`over` on the very next normal update.

## 4. Safety gate: git-clean precondition on the target file

Git is the archive. Nothing is deliberately duplicated into a second
in-repo location — compressed-away detail is only ever "not loaded by
default," never "gone," and the guarantee that makes that true is that the
pre-compression version already exists as a real commit before it's
rewritten.

The TOON update-plan schema gains one new optional field on a row: `kind`
(default: absent/normal; or `compress`). When `update()` processes a row
with `kind: compress`, before writing it checks git status on that row's
target file (scoped to `.memoryintel/`, using the same `git status
--porcelain` mechanism `check-stop` already has):

- **Clean:** proceed — write the compacted content, same as any other
  `replace` row.
- **Dirty:** reject that row with reason `"<file> has uncommitted changes —
  commit the current state before compressing it, then retry."` The rest of
  the plan (any non-compress rows) is applied normally; only compress rows
  targeting a dirty file are affected.

This reuses `computeDiffSignature`'s git-porcelain approach from
`src/adapters/claudeCode.ts` rather than introducing a second way to shell
out to git.

## 5. `instructions.md`: the compaction judgment itself

Add a section teaching what "important historic context" means in practice
— this is the part that actually prevents information loss, since the
mechanism above is just plumbing:

**Keep verbatim, never compress away:**
- Architecture decisions and their rationale.
- Unresolved open questions.
- Anything a future session would need to avoid repeating a mistake or
  re-deriving a conclusion already reached.

**Safe to compress:**
- Resolved narrative — "we tried X, it didn't work, we did Y instead"
  collapses to "Y (not X — see git history for why)."
- Routine progress entries fully superseded by a later entry.
- Verbose blow-by-blow where a terser statement of the current end state
  already covers what matters.

**Rule of thumb:** if a future session would reasonably ask "why is it
built this way?" and the compacted summary can't answer, it compressed too
much — keep more.

## 6. Dashboard

Add `lines/ceiling` to each file's existing display, sourced from the same
computation `load()` already performs (no new computation introduced) — a
human glancing at the dashboard sees bloat coming the same session the
agent does, not after it's already a problem.

## 7. Testing strategy

Same split the rest of the system already uses: the compaction *judgment*
(what to keep vs. cut) is agent reasoning, not testable as code — reviewed
the same scenario-based way `instructions.md`'s classification guidance
already is (§9 of the main design spec). What's testable as code:

- Line-count computation against `memory-config.json` ceilings (global
  default, per-domain override), and the manifest field `load()` emits for
  each of over/under status.
- The `kind: compress` git-clean precondition in `update()`: rejects with
  the correct reason on a dirty target file, proceeds normally on a clean
  one, leaves non-compress rows in the same plan unaffected either way.
- Dashboard rendering of the new `lines/ceiling` figures per file.
- Integration: a fixture file seeded over ceiling → `load()` flags it
  `status: over` → a `kind: compress` plan through `update()` → resulting
  file is under ceiling and the git-dirty rejection path is exercised
  explicitly (dirty file rejected; same file after a commit succeeds).

## 8. Out of scope for this spec

- A dedicated archive file inside `.memoryintel/` for compressed-away
  content — rejected in favor of git being the sole archive (§4).
- Compressing `memory-events.jsonl`/`memory-index.json`/`.session-marker.json`
  — out of scope per §2, since they're never loaded back into context.
- Any automatic/forced compression — the agent always decides whether to
  act on an `over` signal; this spec builds the signal and the safe
  mechanism, not a policy that compresses without being asked.
