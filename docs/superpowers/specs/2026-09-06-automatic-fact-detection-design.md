# Automatic Stack/Integration Fact Detection — Design

## 0. Why

Surfaced by dogfooding memoryintel on a real project (a Next.js portfolio site
using Sanity CMS, deployed on Vercel) across a long working session: despite
touching all of these technologies repeatedly, `technical/techContext.md`'s
Stack section, `technical/integrations.md`, and `technical/infrastructure.md`
stayed empty the entire session. Two distinct causes:

1. **No baseline detection exists for these files at all.** `memoryintel
   scan` already calls `detectStack()` and extracts `package.json`
   dependencies (`next`, `@sanity/client`, etc.), but only prints them to
   stdout for one-time human orientation — nothing ever writes them into
   `techContext.md`/`integrations.md`. The data was one function call away
   the whole time; nothing consumed it into memory.
2. **`check-stop`'s diff-signature check is domain-blind.** It only asks "is
   there an uncommitted git diff," never "does this diff touch a domain the
   session's update-plans never addressed." An agent can write a narrow
   1-file update-plan, satisfy the block, and never revisit
   `techContext.md`/`integrations.md`/`infrastructure.md` even when a
   session's diff obviously touched them (new dependency in `package.json`,
   new CMS config file, etc.).

The user's own framing: memory-intel "should automatically detect and
should... update any or all files that are relevant... It should not come
from the user or wait for the user to direct it." This spec is scoped to
exactly what can honestly satisfy that for *mechanically verifiable* facts —
a dependency exists, a config file exists — without violating this project's
existing, deliberate design boundary that real *understanding* (architecture,
decisions, why something was built a certain way) must stay agent-authored,
never mechanically fabricated. See `context/decisions.md` in this repo for
that boundary's original rationale; this spec does not revisit or weaken it.

**A concrete finding that shaped this design:** the same real-world project
that surfaced this gap has zero repo-level trace of its Vercel deployment —
no `vercel.json`, no `.vercel/`, no `vercel` dependency anywhere. No
scanner, however capable, can mechanically prove a fact that exists nowhere
in the repo. Infrastructure/hosting detection is explicitly designed as
**best-effort**, not guaranteed — see §2.3.

## 1. Scope

**In scope:**
- A curated, extensible mapping from manifest dependencies to human-readable
  facts, targeting three existing starter files: `technical/techContext.md`
  (Stack), `technical/integrations.md` (External Services),
  `technical/infrastructure.md` (Deployment).
- A best-effort, signal-based infrastructure/hosting detector (config file
  presence only — no dependency signal exists for "where is this deployed").
- Automatic invocation from both `load` (SessionStart) and `check-stop`
  (Stop, gated on the diff touching a manifest file) — no new user action,
  no new agent action.
- A `check-stop` message enhancement: when the diff touches a manifest file
  and the corresponding domain file's detected-block is unchanged this
  session, name that file specifically in the block reason, so the agent's
  own judgment-driven follow-up (a real update-plan entry, if warranted) is
  prompted with a concrete lead rather than a generic nudge.
- Event-log tagging so auto-written facts are distinguishable from
  agent-authored ones in `status`/the dashboard.
- A manual `memoryintel sync` command as a debugging/escape-hatch entry
  point to the same detection, independent of the hooks.

**Explicitly out of scope:**
- Any inference beyond "this dependency/config file is present" — no version
  compatibility analysis, no reading a framework's own config for *how* it's
  used, no architecture inference.
- Interactive prompting for facts the repo doesn't evidence (the "ask the
  agent to ask the user" option was considered and explicitly rejected in
  favor of best-effort-only for infrastructure facts — see decisions.md
  entry this spec adds).
- Extending detection to `context/`, `business/`, or `research/` domain
  files — those are inherently non-mechanical (product context, roadmap,
  stakeholders) and out of this spec's boundary entirely.
- Removing or weakening the existing `scan`/`import` philosophy that real
  architectural understanding stays agent-authored.

## 2. Mechanism 1: mechanical auto-detection

### 2.1 Detected-block markers

Each of the three target files gets a new managed sub-block, distinct from
the existing `<!-- memoryintel:managed:start/end -->` block (that one is
reserved for the `AGENTS.md`/pointer-file mechanism and lives in different
files entirely — no collision, but reusing the identical marker name across
two different meanings would be confusing):

```markdown
## Stack

<!-- memoryintel:detected:start -->
- Next.js (React framework) — via `next` in package.json
- TypeScript — via `typescript` in package.json
<!-- memoryintel:detected:end -->

Agent-authored notes about *why* this stack was chosen go here, below the
detected block, same section.
```

The detector fully regenerates the content between its own markers on every
run and never touches anything outside them — an insert-or-replace-block
operation, not a section-level `update()` action. This means it's additive
to (never competing with) whatever an agent writes elsewhere in the same
heading. If the markers don't exist yet in a file (e.g. a project
initialized before this feature shipped), the first sync inserts the block
immediately under the target heading, same placement `doctor` already uses
for its own inserted content elsewhere in this codebase.

If detection currently finds nothing for a given file (e.g. no package
manifest at all), the block still gets written, with a single line making
that explicit — `_No stack manifest found._` — so a human or agent glancing
at the file can tell detection *ran and found nothing*, not that it never
ran. This mirrors the infrastructure "no deployment signal found" case in
§2.3.

### 2.2 The mapping table

New file, `src/core/knownFacts.ts`:

```typescript
export interface KnownFact {
  match: string | string[]; // dependency name(s) that trigger this fact
  fact: string;              // human-readable line written to the block
  target: 'techContext' | 'integrations';
}

export const KNOWN_FACTS: KnownFact[] = [
  { match: 'next', fact: 'Next.js (React framework)', target: 'techContext' },
  { match: 'react', fact: 'React', target: 'techContext' },
  { match: 'typescript', fact: 'TypeScript', target: 'techContext' },
  { match: 'vue', fact: 'Vue', target: 'techContext' },
  { match: ['@sanity/client', 'sanity'], fact: 'Sanity (headless CMS)', target: 'integrations' },
  { match: 'stripe', fact: 'Stripe (payments)', target: 'integrations' },
  { match: '@supabase/supabase-js', fact: 'Supabase', target: 'integrations' },
  { match: 'firebase', fact: 'Firebase', target: 'integrations' },
  { match: 'prisma', fact: 'Prisma (ORM)', target: 'techContext' },
  { match: 'mongoose', fact: 'MongoDB (via Mongoose)', target: 'techContext' },
  // ...~30-40 entries covering common frameworks/CMS/DB/payment/auth libs at ship time
];
```

`match` is checked against the same `dependencies` set `detectStack()`
already produces (dependencies + devDependencies, deduplicated) — no new
manifest-parsing logic needed, this table is purely a lookup layer on top of
existing `core/repoScan.ts` output. Community additions land as normal PRs
to this one file; no plugin system needed at this scale.

Each written fact line includes its evidence (`— via `next` in
package.json`) so the block is self-documenting about *why* memoryintel
believes this — consistent with never asserting something without a
traceable source, the same principle `import`'s docstring already states for
document ingestion.

### 2.3 Infrastructure: best-effort signal detection

No dependency-based signal exists for "where is this deployed" — confirmed
by the zero-trace-Vercel finding in §0. Detection instead checks, in order,
for the presence of:

`vercel.json`, `.vercel/`, `netlify.toml`, `Dockerfile`,
`docker-compose.yml`, `fly.toml`, `render.yaml`, `wrangler.toml`,
`Procfile`, and `.github/workflows/*.yml` grepped for known deploy-action
names (`vercel`, `netlify`, `fly.io`, `render`, `aws-actions`,
`google-github-actions`).

Each match writes a corresponding fact line (`Netlify — via netlify.toml`).
If nothing matches, the block states `_No deployment signal found in
repo._` — explicit absence, not silence. This is the block most likely to
stay a "no signal" stub on real projects (matching the Vercel-via-dashboard
case that motivated this spec) — that's accepted, not a bug to chase
further; the user explicitly chose best-effort over building an interactive
fallback for this class of fact.

### 2.4 When it runs

Both entry points call the same `syncDetectedFacts(memoryRoot): SyncResult`:

- **`load` (SessionStart):** runs before printing context. Silent unless it
  actually changed something, in which case `load`'s own manifest output
  shows the affected file(s) with their normal `status`/`lastUpdated`,
  indistinguishable in that listing from an agent-driven update except for
  the event-log tag (§4). Catches drift between sessions — e.g. the user
  ran `npm install some-integration` by hand outside any agent session.
- **`check-stop` (Stop):** runs only when the current diff touches a
  manifest file (`package.json`, `requirements.txt`, `pyproject.toml`,
  `go.mod`, `Cargo.toml` — the same set `detectStack()` already recognizes).
  Catches additions made mid-session before the next `load`.
- **`memoryintel sync`:** new CLI command, same underlying function, for
  manual invocation/debugging. Not part of the automatic hook path — purely
  an escape hatch, per this project's existing pattern of every automatic
  mechanism also being independently runnable by hand (`update`,
  `check-stop`, `doctor` all follow this already).

`syncDetectedFacts` only writes a file if the newly-computed block content
differs from what's currently between the markers — a no-op on the common
case where nothing changed, so this never generates event-log noise or
touches file mtimes on a stack that hasn't moved.

## 3. Mechanism 2: `check-stop`'s domain-aware nudge

`check-stop` already computes a diff signature and decides block/allow (see
`src/adapters/claudeCode.ts`, fixed for its own JSON-schema bug earlier this
project — unrelated to this spec). This spec adds one more piece of
information to that same decision, without changing its allow/block
semantics:

When the diff includes a manifest file, and `syncDetectedFacts` (§2.4) just
found and wrote something new, the block `reason` names it specifically:

> "Working tree has changes memory hasn't accounted for... Also:
> package.json changed — detected a new dependency (@sanity/client → Sanity
> CMS), now recorded in technical/integrations.md. Worth a note elsewhere
> (e.g. why it was added) if that's not just incidental."

This is deliberately *informational*, not a second gate — the block/allow
decision is unchanged from today (still purely the existing diff-signature
logic), only the *reason text* gains a pointer to what was just
auto-detected, so the agent drafting its update-plan has a concrete,
specific lead instead of only "something changed, go figure out what."

## 4. Transparency: event-log source tagging

`memory-events.jsonl` entries gain a `source` field: `'agent'` (existing
behavior, via `update`) or `'auto-detect'` (new, via `syncDetectedFacts`).
`status` and the dashboard's timeline view render these distinguishably (a
small icon/label difference is enough) so a human glancing at either can
always tell what memoryintel itself asserted from repo evidence versus what
an agent wrote from its own judgment. This matters most exactly when the two
disagree — e.g. an agent's prose says "we use MongoDB" while detection found
no matching dependency, which is now a visible, checkable discrepancy
instead of two silently-merged, unattributable sentences.

## 5. Testing

- `knownFacts.ts` mapping: unit tests per fact entry, feeding a synthetic
  `dependencies` array and asserting the correct `fact`/`target` pairing —
  no filesystem needed.
- `syncDetectedFacts`: integration tests against a temp directory with a
  crafted `package.json` (and, separately, deploy-config files), asserting
  exact block content written, idempotency (second call is a no-op), and
  that content outside the markers survives untouched.
- `check-stop` nudge: extend the existing `tests/adapters/claudeCode.test.ts`
  suite with a case where the diff includes `package.json` with a new known
  dependency, asserting the reason text names the target file.
- Infrastructure best-effort detection: one test per signal file
  (`vercel.json` present → correct fact; nothing present → the explicit
  "no signal" line).

## 6. Non-goals / explicitly deferred

- A plugin/extension mechanism for the facts table beyond "edit the file and
  PR it" — premature until the built-in table proves too narrow in practice.
- Detecting facts from lockfiles (`package-lock.json`, `yarn.lock`) for
  transitive-dependency signals — manifest-declared dependencies only,
  matching `detectStack()`'s existing scope exactly.
- Any UI/dashboard redesign beyond the source-tag distinction in §4.
