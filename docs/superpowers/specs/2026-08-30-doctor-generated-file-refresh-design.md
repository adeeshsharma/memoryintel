# `memoryintel doctor` — Generated-File Refresh — Design

## 0. Why

`memoryintel init` writes two kinds of things into a project: real project
memory (`context/`, `business/`, `technical/`, `memory-index.json`,
`memory-events.jsonl`) that an agent owns and edits over the project's
lifetime, and a small set of files `memoryintel` itself authors and expects
to own — `instructions.md`, and the pointer block it inserts into
`AGENTS.md`/`GEMINI.md`/`.cursor/rules/memoryintel.mdc`. `init` only ever
creates a file if it's missing (`ensureFile()`); once written, nothing ever
touches those machine-owned files again, even when the bundled template
they came from is later fixed or improved.

This is a real, present-tense gap, not a hypothetical: `instructions.md`'s
"Session end" section named the TOON update-plan's fields but never its
exact header syntax, its three valid `action` values, or its quoting rule —
an agent working on a real project had to go read this repo's own source
(`core/toon.ts`, `commands/update.ts`) to build a working plan file, which a
real end user of the published package can never do. That gap is fixed
upstream (this repo, separate PR), but every project initialized before the
fix ships is stuck with the old wording forever, with no way to notice or
pull in the fix short of a human manually diffing files by hand.

This spec designs `memoryintel doctor`: a command that detects and, where
safe, refreshes these specific machine-owned files on an already-initialized
project — without ever risking real project memory or a genuine user
customization.

## 1. Scope: exactly two file classes, nothing else

**In scope:**
- `instructions.md`
- The fenced pointer block inside `AGENTS.md` / `GEMINI.md` /
  `.cursor/rules/memoryintel.mdc` (between `<!-- memoryintel:managed:start
  -->` and `<!-- memoryintel:managed:end -->`)

**Explicitly out of scope, never read for decisions, never written:**
- Everything under `context/`, `business/`, `technical/`, `research/` —
  real, agent-authored project memory.
- `memory-index.json`, `memory-events.jsonl`, `.session-marker.json` —
  derived/bookkeeping state with its own existing write paths.
- A pointer block that's missing its markers entirely (removed on purpose,
  or a file that was never adapted in the first place) — `doctor` only
  refreshes a block it already finds. It never installs one from scratch;
  that's `init`'s job, and choosing not to have the block is a legitimate
  project decision `doctor` has no business overriding.

## 2. `instructions.md`: hash-gated refresh

### 2.1 New state: `memory-config.json`'s `generatedFileHashes`

```json
{
  "initializedAt": "...",
  "version": "0.1.0",
  "generatedFileHashes": {
    "instructions.md": "<sha256 hex of exactly what was last written by memoryintel>"
  }
}
```

A small, extensible map keyed by relative path — `instructions.md` is the
only key populated by this spec, but the shape doesn't need to change if a
future generated file needs the same treatment.

`init.ts` starts populating this the moment it *actually writes*
`instructions.md` fresh (not when `ensureFile` skips because the file
already exists). This requires `init.ts` to know whether it just wrote the
file, not only that the file now exists — a one-line change from
`ensureFile()`'s current void return to reporting whether it wrote, or an
explicit `existsSync` check before calling it. `memory-config.json` may
already exist at that point (e.g. the "creates missing files on re-run"
upgrade path, where `instructions.md` was deleted but the config wasn't) —
this is a read-merge-write, not a blind `ensureFile()`.

Every *new* project is therefore doctor-ready from the moment it's
initialized. An *existing* project (every project as of this spec,
including this repo's own consumers) simply has no key here yet — see 2.3
for why that needs no special-casing.

### 2.2 The comparison `doctor` runs

Three values, every run:
- `templateHash` — sha256 of the current, bundled `INSTRUCTIONS_TEMPLATE`
  string (whatever this exact installed version of `memoryintel` ships).
- `diskHash` — sha256 of `instructions.md` as it actually sits on disk
  right now.
- `recordedHash` — `generatedFileHashes["instructions.md"]` from
  `memory-config.json`, or absent.

### 2.3 Outcomes

| `diskHash` vs `templateHash` | `diskHash` vs `recordedHash` | Outcome |
|---|---|---|
| equal | — | Up to date. No-op. |
| not equal | equal | **Safe refresh**: disk matches exactly what we last wrote and nothing newer has touched it since — overwrite with the current template, update `recordedHash` to `templateHash`. |
| not equal | not equal, or `recordedHash` absent | **Refuse.** Whether this is a genuine hand-edit or a project that predates hash-tracking, `doctor` cannot tell the difference, and both cases mean "don't know this is safe" — so both get the identical, conservative treatment. See 2.4 for what "refuse" actually does. |

This means an existing project with no `generatedFileHashes` entry at all
(the common case right now) always lands in the same refuse-and-report path
as a genuinely hand-edited file — one code path, no bootstrapping logic, no
guessing.

### 2.4 What "refuse" looks like, given zero runtime dependencies

`memoryintel` has no dependencies at all (confirmed: no `dependencies` key
in `package.json`), so this doesn't reach for a diff library. Instead,
`doctor` writes the current template out to a sibling file,
`.memoryintel/instructions.md.new`, and reports:

```
instructions.md: differs from the current template and its last-known-safe
state can't be confirmed (either hand-edited, or from before doctor existed).
Wrote the current template to .memoryintel/instructions.md.new for comparison
(e.g. `diff .memoryintel/instructions.md .memoryintel/instructions.md.new`).
Run `memoryintel doctor --force` to adopt it anyway - this overwrites
instructions.md and removes the .new file.
```

`--force` applies the overwrite unconditionally for `instructions.md`
regardless of the table above, and records the new hash — the same
end-state as a "safe refresh", just skipping the safety check on the user's
explicit say-so. This is the same shape as `docmanager-axi`'s own
`--confirm`/`--acknowledge-privacy` flags: a flag re-run, not a blocking
interactive prompt, matching this CLI's non-interactive, agent-drivable
design throughout.

## 3. Pointer block: unconditional resync

No hash tracking needed here — the `START_MARKER`/`END_MARKER` fencing
already proves everything between them is machine-owned, regardless of
whatever real content surrounds it in `AGENTS.md`/`GEMINI.md`. For each of
the three adapter files, if both markers are present, `doctor` replaces
everything between them (markers inclusive) with the current
`POINTER_BLOCK` — every run, no `--force`, no state to track. If the
resulting content is byte-identical to what was already there, that's
simply a no-op write (still safe, still simple - not worth special-casing
to avoid a redundant write).

If the markers are absent, `doctor` does nothing to that file - it never
inserts a block that isn't already there.

This also fixes a real, present-tense bug in `genericPointer.ts`'s
`upsertPointerBlock()`: it currently returns immediately once it finds
`START_MARKER` in a file, meaning a pointer block, once installed, never
picks up a later wording fix either (this exact class of gap this whole
spec exists to close, already live in the one piece of generated content
that happens to be trivially safe to fix). `doctor`'s pointer-block pass
supersedes that early-return for the refresh case; `init`'s own
install-if-missing behavior via `upsertPointerBlock()` is unchanged.

## 4. CLI shape

```
memoryintel doctor [--force]
```

Behavior:
- Runs both checks (instructions.md, pointer block × 3 adapter files) every
  time; auto-applies whatever is provably safe (pointer block always,
  `instructions.md` only when hash-verified untouched); never writes
  anything uncertain without `--force`.
- `--force` affects only the `instructions.md` refusal case (2.4) - it has
  no effect on the pointer block, which never refuses in the first place,
  and no effect when `instructions.md` is already up to date or already
  safely refreshable.
- Output is plain text, one line per file checked, mirroring `status`'s
  existing human-readable style (this CLI has no established JSON-output
  convention for any command to be consistent with instead).
- Idempotent: a second consecutive run reports "up to date" everywhere and
  writes nothing, whether or not `--force` was used on the first run.
- Missing `.memoryintel/` entirely is the same hard error every other
  command already gives (`findMemoryIntelRoot`'s existing behavior) - no
  new error path.

Added to `USAGE` in `cli.ts` alongside the other commands.

## 5. Testing plan

New `tests/commands/doctor.test.ts`, mirroring `init.test.ts`'s style
(isolated temp dir per test via `mkdtempSync`/`rmSync`):

- Fresh `init` then immediate `doctor` → both files report up to date, no
  writes (hash was seeded correctly at init time).
- Simulate "template moved on" by hand-writing an older/different
  `instructions.md` content AND a matching `recordedHash` in
  `memory-config.json` → `doctor` overwrites to the current template and
  updates the recorded hash.
- Hand-edit `instructions.md` to differ from both the template and the
  recorded hash → `doctor` refuses, writes `instructions.md.new`, does not
  touch `instructions.md`.
- Same hand-edited state, run `doctor --force` → overwrites, removes
  `instructions.md.new`, records the new hash.
- Project with no `generatedFileHashes` key at all (simulating every
  pre-existing project) and an `instructions.md` that already happens to
  equal the current template byte-for-byte → reports up to date (the
  `diskHash === templateHash` branch fires before the recorded-hash check
  ever matters) — confirms a pristine-but-unstamped project doesn't get
  needlessly flagged.
- Same "no key at all" state, but content genuinely differs → refuses,
  same as the hand-edited case (confirms 2.3's "one path covers both
  cases" claim).
- Pointer block: install via `init`, hand-edit the fenced content between
  the markers, run `doctor` → content between markers is restored to the
  current `POINTER_BLOCK`; content *outside* the markers in the same file
  is untouched.
- Pointer block markers entirely removed from `AGENTS.md` → `doctor`
  leaves the file untouched (does not reinsert the block).
- Full idempotency: running `doctor` twice in a row (with or without
  `--force` on the first run) produces no writes on the second run.

## 6. Out of scope for this spec

- Any refresh mechanism for `context/`/`business/`/`technical/` starter
  headings, or `memory-index.json`/`memory-events.jsonl` schema changes —
  none of this spec's mechanism applies to agent-owned content.
- An auto-merge or partial-apply mode for a diverged `instructions.md`
  (considered and rejected during brainstorming - real diff/merge risk for
  marginal convenience over the always-safe refuse-and-report path).
- A `--dry-run`/check-only mode that reports staleness without applying
  the safe fixes. Worth considering later for CI-style usage, but the
  current design already never writes anything uncertain, so the main
  value of a dry-run (avoiding surprise writes) is already covered for the
  case that matters most.
